import { recordSmsOptOut } from "./sms-opt-out";
import { recordSmsUsage } from "./sms-usage";
import { confirmSmsSend } from "./sms-delivery";
import { Prisma, type Database } from "@agentinfra/db";
import { verifyTelnyxWebhook, type TelnyxEvent } from "@agentinfra/providers";
import { AppError, assert } from "./errors";
import type { Environment } from "./index";
export async function ingestTelnyx(
  db: Database,
  env: Environment,
  request: Request,
) {
  assert(
    env.TELNYX_PUBLIC_KEY,
    503,
    "not_configured",
    "Telnyx webhook public key is not configured",
  );
  const payload = await request.text();
  assert(
    new TextEncoder().encode(payload).length <= 256000,
    413,
    "payload_too_large",
    "Webhook body too large",
  );
  let event: TelnyxEvent;
  try {
    event = await verifyTelnyxWebhook(
      payload,
      request.headers,
      env.TELNYX_PUBLIC_KEY,
    );
  } catch {
    throw new AppError(
      400,
      "invalid_signature",
      "Invalid Telnyx signature or payload",
    );
  }
  await db.providerEvent.upsert({
    where: { id: "telnyx:" + event.data.id },
    create: {
      id: "telnyx:" + event.data.id,
      provider: "telnyx",
      type: event.data.event_type,
      payload: event as Prisma.InputJsonValue,
    },
    update: {},
  });
  return { received: true };
}
export async function processTelnyxEvents(db: Database, limit = 10) {
  const events = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "ProviderEvent" WHERE provider='telnyx' AND ((status='pending' AND "availableAt" <= now()) OR (status='processing' AND "lockedAt" < now()-interval '5 minutes')) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
    if (!claimed.length) return [];
    await tx.providerEvent.updateMany({
      where: { id: { in: claimed.map((e) => e.id) } },
      data: {
        status: "processing",
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return tx.providerEvent.findMany({
      where: { id: { in: claimed.map((e) => e.id) } },
    });
  });
  for (const item of events) {
    try {
      const event = (item.payload as unknown as TelnyxEvent).data;
      const payload = event.payload;
      await db.$transaction(async (tx) => {
        if (
          event.event_type === "message.received" &&
          payload.direction === "inbound" &&
          payload.type === "SMS"
        ) {
          for (const recipient of payload.to) {
            const number = await tx.phoneNumber.findFirst({
              where: {
                phoneNumber: recipient.phone_number,
                messagingProfileId: payload.messaging_profile_id,
                status: "active",
              },
            });
            if (!number) continue;
            await recordSmsOptOut(
              tx,
              number.messagingProfileId,
              payload.from.phone_number,
              payload.autoresponse_type,
              new Date(event.occurred_at),
              event.id,
            );
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${number.id + ":" + payload.id}))`;
            const existing = await tx.smsMessage.findUnique({
              where: {
                phoneNumberId_providerId: {
                  phoneNumberId: number.id,
                  providerId: payload.id,
                },
              },
            });
            if (existing) {
              await recordSmsUsage(
                tx,
                existing.id,
                payload,
                new Date(event.occurred_at),
                true,
              );
              continue;
            }
            const message = await tx.smsMessage.create({
              data: {
                organizationId: number.organizationId,
                phoneNumberId: number.id,
                providerId: payload.id,
                direction: "inbound",
                status: "received",
                from: payload.from.phone_number,
                to: recipient.phone_number,
                text: payload.text ?? "",
                providerOccurredAt: new Date(event.occurred_at),
              },
            });
            await recordSmsUsage(
              tx,
              message.id,
              payload,
              new Date(event.occurred_at),
              true,
            );
            await tx.event.create({
              data: {
                organizationId: number.organizationId,
                agentId: number.agentId,
                type: "sms.received",
                resourceId: message.id,
              },
            });
          }
        } else if (
          ["message.sent", "message.finalized"].includes(event.event_type) &&
          payload.direction === "outbound"
        ) {
          if (payload.type === "SMS" && payload.webhook_url) {
            const operationId = new URL(payload.webhook_url).searchParams.get(
              "papers_operation",
            );
            if (operationId)
              await confirmSmsSend(tx, operationId, payload.id, {
                webhookUrl: payload.webhook_url,
                from: payload.from.phone_number,
                to: payload.to.map((to) => to.phone_number),
                text: payload.text,
                messagingProfileId: payload.messaging_profile_id,
              });
          }
          const messages = await tx.smsMessage.findMany({
            where: {
              providerId: payload.id,
              direction: "outbound",
              phoneNumber: {
                phoneNumber: payload.from.phone_number,
                messagingProfileId: payload.messaging_profile_id,
              },
            },
            include: { phoneNumber: true },
          });
          if (
            !messages.length &&
            (await tx.phoneNumber.count({
              where: {
                phoneNumber: payload.from.phone_number,
                messagingProfileId: payload.messaging_profile_id,
              },
            }))
          ) {
            throw new Error("Outbound message is not correlated yet");
          }
          for (const message of messages) {
            const recipient = payload.to.find(
              (to) => to.phone_number === message.to,
            );
            if (!recipient?.status) continue;
            await recordSmsUsage(
              tx,
              message.id,
              payload,
              new Date(event.occurred_at),
              event.event_type === "message.finalized",
            );

            const occurredAt = new Date(event.occurred_at);
            const changed = await tx.smsMessage.updateMany({
              where: {
                id: message.id,
                OR: [
                  { providerOccurredAt: null },
                  { providerOccurredAt: { lt: occurredAt } },
                ],
                ...(event.event_type === "message.sent"
                  ? {
                      status: {
                        notIn: [
                          "delivered",
                          "delivery_failed",
                          "sending_failed",
                          "delivery_unconfirmed",
                          "failed",
                          "gw_timeout",
                          "dlr_timeout",
                        ],
                      },
                    }
                  : {}),
              },
              data: {
                status: recipient.status,
                providerOccurredAt: occurredAt,
              },
            });
            if (changed.count)
              await tx.event.create({
                data: {
                  organizationId: message.organizationId,
                  agentId: message.phoneNumber.agentId,
                  type: "sms." + recipient.status,
                  resourceId: message.id,
                },
              });
          }
        }
        await tx.providerEvent.update({
          where: { id: item.id },
          data: {
            status: "completed",
            payload: { message_id: payload.id },
            error: null,
          },
        });
      });
    } catch {
      await db.providerEvent.update({
        where: { id: item.id },
        data: {
          status: item.attempts >= 8 ? "dead_letter" : "pending",
          error: "processing_failed",
          availableAt: new Date(
            Date.now() + Math.min(3600000, 2 ** item.attempts * 1000),
          ),
        },
      });
    }
  }
  return { processed: events.length };
}
