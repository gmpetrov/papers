import { confirmEmailSend } from "./email-delivery";
import { Prisma, type Database } from "@agentinfra/db";
import {
  verifyResendWebhook,
  resendClient,
  type ResendEvent,
} from "@agentinfra/providers";
import type { Environment } from "./index";
import { AppError, assert } from "./errors";
export async function ingestResend(
  db: Database,
  env: Environment,
  request: Request,
) {
  assert(
    env.RESEND_WEBHOOK_SECRET,
    503,
    "not_configured",
    "Webhook not configured",
  );
  const text = await request.text();
  assert(
    new TextEncoder().encode(text).length <= 256_000,
    413,
    "payload_too_large",
    "Webhook body too large",
  );
  let event: ResendEvent;
  try {
    event = verifyResendWebhook(
      text,
      request.headers,
      env.RESEND_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "resend_webhook_rejected",
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
    throw new AppError(
      400,
      "invalid_signature",
      "Invalid webhook signature or payload",
    );
  }
  const id = request.headers.get("svix-id")!;
  await db.providerEvent.upsert({
    where: { id },
    create: {
      id,
      provider: "resend",
      type: event.type,
      payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
    },
    update: {},
  });
  return { received: true };
}
export async function processProviderEvents(
  db: Database,
  env: Environment,
  limit = 10,
) {
  const events = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "ProviderEvent" WHERE provider='resend' AND ((status='pending' AND "availableAt" <= now()) OR (status='processing' AND "lockedAt" < now()-interval '5 minutes')) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
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
      const event = item.payload as unknown as ResendEvent;
      if (
        [
          "email.sent",
          "email.delivered",
          "email.bounced",
          "email.complained",
          "email.failed",
          "email.suppressed",
        ].includes(event.type) &&
        event.data.tags?.papers_operation &&
        event.data.from
      ) {
        await confirmEmailSend(
          db,
          event.data.tags.papers_operation,
          event.data.email_id,
          event.data.message_id,
          event.data.from,
        );
      }
      if (event.type === "email.received") {
        const routed =
          event.data.received_for?.map((x) => x.trim().toLowerCase()) ?? [];
        if (!routed.length) throw new Error("missing_envelope_recipients");
        if (
          !(await db.inbox.count({
            where: { address: { in: routed }, status: "active" },
          }))
        ) {
          await db.providerEvent.update({
            where: { id: item.id },
            data: {
              status: "completed",
              payload: { email_id: event.data.email_id },
              error: null,
            },
          });
          continue;
        }
        const result = await resendClient(
          env.RESEND_API_KEY,
        ).emails.receiving.get(event.data.email_id);
        if (result.error || !result.data)
          throw new Error("receiving_fetch_failed");
        const mail = result.data;
        // received_for is the SMTP envelope recipients; visible To/Cc headers are not a routing authority.
        const recipients =
          mail.received_for?.map((x) => x.trim().toLowerCase()) ?? [];
        if (!recipients.length) throw new Error("missing_envelope_recipients");
        const inboxes = await db.inbox.findMany({
          where: { address: { in: recipients }, status: "active" },
        });
        for (const inbox of inboxes)
          await db.$transaction(async (tx) => {
            if (
              await tx.emailMessage.findUnique({
                where: {
                  inboxId_providerId: {
                    inboxId: inbox.id,
                    providerId: mail.id,
                  },
                },
              })
            )
              return;
            const headers = Object.fromEntries(
              Object.entries(mail.headers ?? {}).map(([k, v]) => [
                k.toLowerCase(),
                v,
              ]),
            );
            const references = (
              headers.references?.match(/<[^<>\s]+>/g) ?? []
            ).slice(-20);
            const parent = headers["in-reply-to"] ?? references.at(-1);
            const previous = parent
              ? await tx.emailMessage.findFirst({
                  where: { inboxId: inbox.id, messageId: parent },
                })
              : null;
            const message = await tx.emailMessage.create({
              data: {
                organizationId: inbox.organizationId,
                inboxId: inbox.id,
                providerId: mail.id,
                messageId: mail.message_id,
                threadId: previous?.threadId ?? crypto.randomUUID(),
                inReplyTo: parent,
                references,
                replyTo: mail.reply_to ?? [],
                direction: "inbound",
                status: "received",
                from: mail.from,
                to: [inbox.address],
                subject: mail.subject,
                text: mail.text ?? "",
                html: mail.html,
                createdAt: new Date(mail.created_at),
                attachments: {
                  create: mail.attachments.map((a) => ({
                    providerId: a.id,
                    filename: a.filename ?? "attachment",
                    contentType: a.content_type,
                    size: a.size,
                  })),
                },
              },
            });
            await tx.event.create({
              data: {
                organizationId: inbox.organizationId,
                agentId: inbox.agentId,
                type: "email.received",
                resourceId: message.id,
              },
            });
          });
      } else if (event.type === "email.sent") {
        if (event.data.message_id)
          await db.emailMessage.updateMany({
            where: { providerId: event.data.email_id, direction: "outbound" },
            data: { messageId: event.data.message_id },
          });
      } else if (
        [
          "email.delivered",
          "email.bounced",
          "email.complained",
          "email.failed",
          "email.suppressed",
        ].includes(event.type)
      ) {
        const messages = await db.emailMessage.findMany({
          where: { providerId: event.data.email_id, direction: "outbound" },
          include: { inbox: true },
        });
        for (const message of messages)
          await db.$transaction(async (tx) => {
            const next = event.type.split(".")[1]!;
            // Check the current row atomically; workers may process events concurrently.
            const protectedStatuses =
              next === "delivered"
                ? ["bounced", "complained", "failed", "suppressed"]
                : next === "complained"
                  ? []
                  : ["complained"];
            const changed = await tx.emailMessage.updateMany({
              where: {
                id: message.id,
                status: { notIn: [next, ...protectedStatuses] },
              },
              data: { status: next },
            });
            if (!changed.count) return;
            await tx.event.create({
              data: {
                organizationId: message.organizationId,
                agentId: message.inbox.agentId,
                type: event.type,
                resourceId: message.id,
              },
            });
          });
      }
      await db.providerEvent.update({
        where: { id: item.id },
        data: {
          status: "completed",
          payload: { email_id: event.data.email_id },
          error: null,
        },
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
