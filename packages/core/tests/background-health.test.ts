import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { getBackgroundHealth } from "../src/background-health";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "ProviderSmsOptOutSync" CASCADE',
  );
});
afterAll(() => db.$disconnect());
it("reports empty queues without exposing or modifying records", async () => {
  const result = await getBackgroundHealth(db);
  expect(result.needsAttention).toBe(false);
  expect(result.metrics).toHaveLength(12);
  expect(
    result.metrics.every(
      (metric) => metric.count === 0 && metric.oldestAgeSeconds === null,
    ),
  ).toBe(true);
});
it("distinguishes due backlog, scheduled retries, expired leases, and dead letters", async () => {
  const old = new Date(Date.now() - 3600000);
  const future = new Date(Date.now() + 3600000);
  for (const [id, status, availableAt, lockedAt] of [
    ["overdue", "pending", old, null],
    ["future", "pending", future, null],
    ["dead", "dead_letter", old, null],
    ["stuck", "processing", old, old],
    ["in-progress", "processing", old, new Date()],
    ["done", "completed", old, null],
  ] as const) {
    await db.providerEvent.create({
      data: {
        id,
        provider: "telnyx",
        type: "message.received",
        status,
        availableAt,
        lockedAt,
        payload: { private: "DO_NOT_EXPOSE" },
      },
    });
  }
  await db.operation.create({
    data: {
      id: "unknown",
      organizationId: "diagnostic-only",
      principalId: "private-principal",
      key: "private-idempotency",
      route: "sms.send:private-number",
      requestHash: "private-hash",
      status: "unknown",
      createdAt: old,
      result: { private: "DO_NOT_EXPOSE" },
    },
  });
  const before = await db.providerEvent.findMany({ orderBy: { id: "asc" } });
  const result = await getBackgroundHealth(db);
  for (const category of [
    "provider_pending",
    "provider_expired_lease",
    "provider_dead_letter",
    "unknown_operations",
  ]) {
    expect(
      result.metrics.find((metric) => metric.category === category),
    ).toMatchObject({ count: 1, needsAttention: 1 });
  }
  expect(result.needsAttention).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /DO_NOT_EXPOSE|private-|message.received/,
  );
  expect(await db.providerEvent.findMany({ orderBy: { id: "asc" } })).toEqual(
    before,
  );
});
it("reports exhausted attachments and webhook failures separately from normal retries", async () => {
  await db.organization.create({
    data: {
      id: "health-org",
      name: "Health",
      slug: "health",
      createdAt: new Date(),
    },
  });
  await db.inbox.create({
    data: {
      id: "health-inbox",
      organizationId: "health-org",
      name: "Health",
      address: "private@example.invalid",
    },
  });
  await db.emailMessage.create({
    data: {
      id: "health-email",
      organizationId: "health-org",
      inboxId: "health-inbox",
      direction: "inbound",
      status: "received",
      from: "private@example.invalid",
      to: ["private@example.invalid"],
      threadId: "private-thread",
      subject: "DO_NOT_EXPOSE",
    },
  });
  await db.attachment.create({
    data: {
      messageId: "health-email",
      providerId: "private-provider",
      filename: "private-file",
      contentType: "text/plain",
      size: 1,
      storageAttempts: 8,
      storageError: "DO_NOT_EXPOSE",
    },
  });
  await db.webhookEndpoint.create({
    data: {
      id: "health-hook",
      organizationId: "health-org",
      name: "Health",
      url: "https://example.invalid/private-url",
      eventTypes: [],
      secretCiphertext: "DO_NOT_EXPOSE",
    },
  });
  await db.webhookDelivery.create({
    data: {
      endpointId: "health-hook",
      eventId: "private-event",
      url: "https://example.invalid/private-url",
      body: "DO_NOT_EXPOSE",
      status: "failed",
    },
  });
  const result = await getBackgroundHealth(db);
  expect(
    result.metrics.find((m) => m.category === "attachment_failed")
      ?.needsAttention,
  ).toBe(1);
  expect(
    result.metrics.find((m) => m.category === "webhook_failed")?.needsAttention,
  ).toBe(1);
  expect(JSON.stringify(result)).not.toMatch(/DO_NOT_EXPOSE|private-/);
});
it("rejects invalid thresholds before opening a transaction", async () => {
  await expect(getBackgroundHealth(db, 0)).rejects.toThrow("threshold");
  await expect(getBackgroundHealth(db, NaN)).rejects.toThrow("threshold");
});
