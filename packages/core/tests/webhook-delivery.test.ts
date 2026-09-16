import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { createWebhookSecret } from "../src/webhook-secrets";
import { processWebhookDeliveries } from "../src/webhook-delivery";
import { verifyWebhook } from "../../sdk-typescript/src/webhooks";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const key = Buffer.alloc(32, 16).toString("base64url");
let secret: string;
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: { id: "org", name: "Org", slug: "org", createdAt: new Date() },
  });
  const generated = await createWebhookSecret(key, "endpoint", 1);
  secret = generated.secret;
  await db.webhookEndpoint.create({
    data: {
      id: "endpoint",
      organizationId: "org",
      name: "Hook",
      url: "https://hooks.customer.com/events",
      eventTypes: ["sms.received"],
      enabled: true,
      secretCiphertext: generated.ciphertext,
    },
  });
});
afterAll(() => db.$disconnect());
const event = (id = "event") =>
  db.event.create({
    data: {
      id,
      organizationId: "org",
      type: "sms.received",
      resourceId: "sms",
    },
  });

it("atomically snapshots subscriptions and rolls back outbox rows with the event", async () => {
  await expect(
    db.$transaction(async (tx) => {
      await tx.event.create({
        data: {
          id: "rolled-back",
          organizationId: "org",
          type: "sms.received",
          resourceId: "sms",
        },
      });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await db.webhookDelivery.count()).toBe(0);
  await db.event.create({
    data: {
      organizationId: "org",
      type: "email.received",
      resourceId: "email",
    },
  });
  expect(await db.webhookDelivery.count()).toBe(0);
  await event();
  const row = await db.webhookDelivery.findFirstOrThrow();
  expect(JSON.parse(row.body)).toMatchObject({
    id: "event",
    type: "sms.received",
    resourceId: "sms",
    contentTrust: "untrusted",
  });
  await db.webhookEndpoint.update({
    where: { id: "endpoint" },
    data: { enabled: false },
  });
  await event("later");
  expect(await db.webhookDelivery.count()).toBe(1);
});

it("claims once across concurrent workers, signs delivery, and logs success without response data", async () => {
  await event();
  const transport = vi.fn(async (request) => {
    expect(verifyWebhook(request.body, request.headers, secret)).toMatchObject({
      id: "event",
    });
    return 204;
  });
  await Promise.all([
    processWebhookDeliveries(db, key, transport),
    processWebhookDeliveries(db, key, transport),
  ]);
  expect(transport).toHaveBeenCalledTimes(1);
  const row = await db.webhookDelivery.findFirstOrThrow({
    include: { logs: true },
  });
  expect(row.status).toBe("delivered");
  expect(row.logs).toHaveLength(1);
  expect(row.logs[0]).toMatchObject({
    attempt: 1,
    statusCode: 204,
    error: null,
  });
});

it("retries with stable ID and bytes, backs off failures, and exhausts eight attempts", async () => {
  await event();
  const transport = vi.fn(async () => 503);
  for (let i = 1; i <= 8; i++) {
    await processWebhookDeliveries(db, key, transport);
    const row = await db.webhookDelivery.findFirstOrThrow();
    expect(row.attempts).toBe(i);
    expect(row.status).toBe(i === 8 ? "failed" : "pending");
    expect(+row.availableAt).toBeGreaterThan(Date.now() + 29000);
    await processWebhookDeliveries(db, key, transport);
    expect(transport).toHaveBeenCalledTimes(i);
    await db.webhookDelivery.update({
      where: { id: row.id },
      data: { availableAt: new Date(0) },
    });
  }
  const requests = transport.mock.calls as unknown as [
    { body: string; headers: Record<string, string> },
  ][];
  expect(new Set(requests.map(([r]) => r.body)).size).toBe(1);
  expect(new Set(requests.map(([r]) => r.headers["webhook-id"])).size).toBe(1);
  expect(await db.webhookDeliveryAttempt.count()).toBe(8);
});

it("cancels disabled or changed destinations and does not leak arbitrary failures", async () => {
  await event();
  await db.webhookEndpoint.update({
    where: { id: "endpoint" },
    data: { url: "https://different.customer.com/events" },
  });
  const transport = vi.fn(async () => {
    throw new Error("sensitive response secret");
  });
  await processWebhookDeliveries(db, key, transport);
  expect(transport).not.toHaveBeenCalled();
  expect((await db.webhookDelivery.findFirstOrThrow()).status).toBe(
    "cancelled",
  );
  await event("new");
  await processWebhookDeliveries(db, key, transport);
  const row = await db.webhookDelivery.findFirstOrThrow({
    where: { eventId: "new" },
    include: { logs: true },
  });
  expect(row.lastError).toBe("delivery_failed");
  expect(JSON.stringify(row)).not.toContain("sensitive");
});

it("recovers a crashed lease and fences an older worker's late completion", async () => {
  await event();
  let release!: (status: number) => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const first = processWebhookDeliveries(
    db,
    key,
    async () => {
      started();
      return new Promise<number>((r) => {
        release = r;
      });
    },
    1,
  );
  await ready;
  const row = await db.webhookDelivery.findFirstOrThrow();
  await db.webhookDelivery.update({
    where: { id: row.id },
    data: { leaseExpiresAt: new Date(0) },
  });
  await processWebhookDeliveries(db, key, async () => 204, 1);
  release(500);
  await first;
  const saved = await db.webhookDelivery.findUniqueOrThrow({
    where: { id: row.id },
    include: { logs: { orderBy: { attempt: "asc" } } },
  });
  expect(saved.status).toBe("delivered");
  expect(saved.attempts).toBe(2);
  expect(saved.logs[0]?.error).toBe("lease_expired");
  expect(saved.logs[1]?.statusCode).toBe(204);
});
