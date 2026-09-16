import type { Database } from "@agentinfra/db";
import { signWebhookDelivery } from "./webhook-signing";

/** Runtime adapter must reject private destinations at connection time, reject
 * redirects, honor AbortSignal, and return only an HTTP status (never a body).
 * There is intentionally no fallback to unrestricted global fetch in Node.
 */
export type WebhookTransport = (request: {
  url: string;
  body: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}) => Promise<number>;

const maxAttempts = 8;
const leaseMs = 60_000;
async function claim(db: Database) {
  return db.$transaction(async (tx) => {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "WebhookDelivery"
      WHERE ("status" = 'pending' AND "availableAt" <= NOW())
        OR ("status" = 'processing' AND "leaseExpiresAt" <= NOW())
      ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!ids[0]) return null;
    const row = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: ids[0].id },
      include: { endpoint: true },
    });
    const now = new Date();
    if (row.status === "processing") {
      await tx.webhookDeliveryAttempt.updateMany({
        where: { deliveryId: row.id, attempt: row.attempts, finishedAt: null },
        data: { finishedAt: now, error: "lease_expired" },
      });
    }
    if (
      !row.endpoint.enabled ||
      row.url !== row.endpoint.url ||
      row.attempts >= maxAttempts
    ) {
      await tx.webhookDelivery.update({
        where: { id: row.id },
        data: {
          status: row.attempts >= maxAttempts ? "failed" : "cancelled",
          lastError:
            row.attempts >= maxAttempts
              ? "attempts_exhausted"
              : "endpoint_changed_or_disabled",
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      return { skipped: true } as const;
    }
    const leaseToken = crypto.randomUUID();
    const saved = await tx.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(+now + leaseMs),
      },
      include: { endpoint: true },
    });
    await tx.webhookDeliveryAttempt.create({
      data: { deliveryId: row.id, attempt: saved.attempts },
    });
    return { skipped: false, row: saved } as const;
  });
}

export async function processWebhookDeliveries(
  db: Database,
  encryptionKey: string | undefined,
  transport: WebhookTransport,
  limit = 10,
) {
  let processed = 0;
  for (let index = 0; index < limit; index++) {
    const work = await claim(db);
    if (!work) break;
    if (work.skipped) continue;
    const { row } = work;
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const headers = await signWebhookDelivery(
        row.endpoint,
        encryptionKey,
        row.id,
        row.body,
      );
      statusCode = await transport({
        url: row.url,
        body: row.body,
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (
        !Number.isInteger(statusCode) ||
        statusCode < 100 ||
        statusCode > 599
      ) {
        statusCode = null;
        error = "invalid_transport_response";
      } else if (statusCode < 200 || statusCode >= 300) error = "http_error";
    } catch {
      // Never persist receiver bodies, URLs, secrets, or arbitrary exception text.
      error = "delivery_failed";
    }
    const now = new Date();
    const delivered = error === null;
    await db.$transaction(async (tx) => {
      const saved = await tx.webhookDelivery.updateMany({
        where: { id: row.id, status: "processing", leaseToken: row.leaseToken },
        data: {
          status: delivered
            ? "delivered"
            : row.attempts >= maxAttempts
              ? "failed"
              : "pending",
          lastStatusCode: statusCode,
          lastError: error,
          deliveredAt: delivered ? now : null,
          availableAt: new Date(
            +now + Math.min(3600000, 30000 * 2 ** (row.attempts - 1)),
          ),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (saved.count)
        await tx.webhookDeliveryAttempt.update({
          where: {
            deliveryId_attempt: { deliveryId: row.id, attempt: row.attempts },
          },
          data: { finishedAt: now, statusCode, error },
        });
    });
    processed++;
  }
  return { processed };
}
