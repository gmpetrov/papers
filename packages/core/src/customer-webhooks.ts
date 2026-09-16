import type { Database, Prisma } from "@agentinfra/db";
import type { Principal } from "./principal";
import { assert } from "./errors";
import {
  listInput,
  webhookEndpointInput,
  webhookEndpointUpdateInput,
} from "@agentinfra/contracts";
import { createWebhookSecret, decryptWebhookSecret } from "./webhook-secrets";

const publicFields = {
  id: true,
  name: true,
  url: true,
  eventTypes: true,
  enabled: true,
  secretVersion: true,
  previousSecretExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
function administer(p: Principal) {
  assert(
    p.credential?.kind === "session" &&
      ["owner", "admin"].includes(p.role) &&
      !p.impersonatedBy,
    403,
    "forbidden",
    "Use an owner or admin session outside impersonation to manage webhooks",
  );
}
const audit = (
  tx: Prisma.TransactionClient,
  p: Principal,
  action: string,
  id: string,
) =>
  tx.auditEvent.create({
    data: {
      organizationId: p.organizationId,
      actorId: p.userId,
      action,
      resourceId: id,
    },
  });
export async function listWebhookEndpoints(
  db: Database,
  p: Principal,
  encryptionKey?: string,
) {
  administer(p);
  return {
    canEnable: !!encryptionKey && /^[A-Za-z0-9_-]{43}$/.test(encryptionKey),
    data: await db.webhookEndpoint.findMany({
      where: { organizationId: p.organizationId },
      select: publicFields,
      orderBy: { createdAt: "desc" },
    }),
  };
}
export async function createWebhookEndpoint(
  db: Database,
  p: Principal,
  input: unknown,
  encryptionKey?: string,
) {
  administer(p);
  const fields = webhookEndpointInput.parse(input);
  const id = crypto.randomUUID();
  const secret = await createWebhookSecret(encryptionKey, id, 1);
  const endpoint = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.organizationId + ":webhook-endpoints"}))`;
    assert(
      (await tx.webhookEndpoint.count({
        where: { organizationId: p.organizationId },
      })) < 20,
      429,
      "webhook_limit_reached",
      "Workspace webhook endpoint limit reached",
    );
    const saved = await tx.webhookEndpoint.create({
      data: {
        id,
        organizationId: p.organizationId,
        ...fields,
        secretCiphertext: secret.ciphertext,
      },
      select: publicFields,
    });
    await audit(tx, p, "webhook.created", id);
    return saved;
  });
  return { ...endpoint, signingSecret: secret.secret };
}
export async function updateWebhookEndpoint(
  db: Database,
  p: Principal,
  id: string,
  input: unknown,
  encryptionKey?: string,
) {
  administer(p);
  const fields = webhookEndpointUpdateInput.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"webhook:" + id}))`;
    const row = await tx.webhookEndpoint.findFirst({
      where: { id, organizationId: p.organizationId },
    });
    assert(row, 404, "not_found", "Webhook endpoint not found");
    if (fields.enabled === true) {
      await decryptWebhookSecret(
        encryptionKey,
        id,
        row.secretVersion,
        row.secretCiphertext,
      );
    }
    const result = await tx.webhookEndpoint.update({
      where: { id },
      data: fields,
      select: publicFields,
    });
    // The endpoint row lock serializes with the event outbox trigger.
    // An in-flight HTTP request cannot be recalled; its late DB result is fenced.
    if (fields.enabled === false || (fields.url && fields.url !== row.url)) {
      await tx.webhookDelivery.updateMany({
        where: { endpointId: id, status: { in: ["pending", "processing"] } },
        data: {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: "endpoint_changed_or_disabled",
        },
      });
      await tx.webhookDeliveryAttempt.updateMany({
        where: {
          delivery: { endpointId: id, status: "cancelled" },
          finishedAt: null,
        },
        data: { finishedAt: new Date(), error: "endpoint_changed_or_disabled" },
      });
    }
    await audit(tx, p, "webhook.updated", id);
    return result;
  });
}
export async function deleteWebhookEndpoint(
  db: Database,
  p: Principal,
  id: string,
) {
  administer(p);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"webhook:" + id}))`;
    const removed = await tx.webhookEndpoint.deleteMany({
      where: { id, organizationId: p.organizationId },
    });
    assert(removed.count, 404, "not_found", "Webhook endpoint not found");
    await audit(tx, p, "webhook.deleted", id);
    return { deleted: true };
  });
}
export async function rotateWebhookSecret(
  db: Database,
  p: Principal,
  id: string,
  encryptionKey?: string,
) {
  administer(p);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"webhook:" + id}))`;
    const row = await tx.webhookEndpoint.findFirst({
      where: { id, organizationId: p.organizationId },
    });
    assert(row, 404, "not_found", "Webhook endpoint not found");
    // Do not silently invalidate the still-valid prior key during a second rotation.
    assert(
      !row.previousSecretExpiresAt || row.previousSecretExpiresAt <= new Date(),
      409,
      "rotation_in_progress",
      "Wait for the previous signing secret to expire before rotating again",
    );
    const secret = await createWebhookSecret(
      encryptionKey,
      id,
      row.secretVersion + 1,
    );
    const endpoint = await tx.webhookEndpoint.update({
      where: { id },
      data: {
        secretCiphertext: secret.ciphertext,
        secretVersion: { increment: 1 },
        previousSecretCiphertext: row.secretCiphertext,
        previousSecretExpiresAt: new Date(Date.now() + 3600000),
      },
      select: publicFields,
    });
    await audit(tx, p, "webhook.secret_rotated", id);
    return { ...endpoint, signingSecret: secret.secret };
  });
}

const deliveryFields = {
  id: true,
  eventId: true,
  status: true,
  attempts: true,
  availableAt: true,
  lastStatusCode: true,
  lastError: true,
  createdAt: true,
  deliveredAt: true,
} as const;

export async function listWebhookDeliveries(
  db: Database,
  p: Principal,
  endpointId: string,
  query: unknown,
) {
  administer(p);
  const { cursor, limit } = listInput.parse(query);
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId: p.organizationId },
    select: { id: true },
  });
  assert(endpoint, 404, "not_found", "Webhook endpoint not found");
  const after = cursor
    ? await db.webhookDelivery.findFirst({
        where: {
          id: cursor,
          endpointId,
          endpoint: { organizationId: p.organizationId },
        },
        select: { id: true, createdAt: true },
      })
    : null;
  assert(!cursor || after, 400, "invalid_cursor", "Invalid delivery cursor");
  const rows = await db.webhookDelivery.findMany({
    where: {
      endpointId,
      endpoint: { organizationId: p.organizationId },
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    select: deliveryFields,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const data = rows.slice(0, limit);
  return { data, nextCursor: rows.length > limit ? data.at(-1)!.id : null };
}

export async function getWebhookDelivery(
  db: Database,
  p: Principal,
  endpointId: string,
  deliveryId: string,
) {
  administer(p);
  const row = await db.webhookDelivery.findFirst({
    where: {
      id: deliveryId,
      endpointId,
      endpoint: { organizationId: p.organizationId },
    },
    select: {
      ...deliveryFields,
      logs: {
        select: {
          attempt: true,
          startedAt: true,
          finishedAt: true,
          statusCode: true,
          error: true,
        },
        orderBy: { attempt: "asc" },
        take: 8,
      },
    },
  });
  assert(row, 404, "not_found", "Webhook delivery not found");
  return row;
}
