import { beforeEach, afterAll, it, expect } from "vitest";
import { createDatabase } from "@agentinfra/db";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  listWebhookDeliveries,
  getWebhookDelivery,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  rotateWebhookSecret,
} from "../src/customer-webhooks";
import {
  createWebhookSecret,
  decryptWebhookSecret,
} from "../src/webhook-secrets";
import type { Principal } from "../src/principal";

const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const encryptionKey = Buffer.alloc(32, 42).toString("base64url");
const owner: Principal = {
  id: "owner",
  userId: "owner",
  organizationId: "one",
  role: "owner",
  scopes: [],
  credential: { kind: "session", id: "session" },
};
const fields = {
  name: "Automation",
  url: "https://hooks.customer.com/events",
  eventTypes: ["email.received", "sms.received", "email.received"],
};
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  for (const id of ["one", "two"])
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
});
afterAll(() => db.$disconnect());

it("keeps signing secrets encrypted, returns them only once, and serializes rotation", async () => {
  const created = await createWebhookEndpoint(db, owner, fields, encryptionKey);
  expect(created.enabled).toBe(false);
  expect(created.eventTypes).toEqual(["email.received", "sms.received"]);
  expect(created.signingSecret).toMatch(/^whsec_/);
  const stored = await db.webhookEndpoint.findUniqueOrThrow({
    where: { id: created.id },
  });
  expect(JSON.stringify(stored)).not.toContain(created.signingSecret);
  expect(
    await decryptWebhookSecret(
      encryptionKey,
      created.id,
      1,
      stored.secretCiphertext,
    ),
  ).toBe(created.signingSecret);
  const list = await listWebhookEndpoints(db, owner);
  expect(list.data[0]).not.toHaveProperty("secretCiphertext");
  expect(JSON.stringify(list)).not.toContain(created.signingSecret);
  const rotations = await Promise.allSettled([
    rotateWebhookSecret(db, owner, created.id, encryptionKey),
    rotateWebhookSecret(db, owner, created.id, encryptionKey),
  ]);
  expect(
    rotations.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = rotations.find((result) => result.status === "rejected");
  expect(
    rejected && rejected.status === "rejected" && rejected.reason.code,
  ).toBe("rotation_in_progress");
  const rotated = await db.webhookEndpoint.findUniqueOrThrow({
    where: { id: created.id },
  });
  expect(rotated.secretVersion).toBe(2);
  expect(
    await decryptWebhookSecret(
      encryptionKey,
      created.id,
      1,
      rotated.previousSecretCiphertext!,
    ),
  ).toBe(created.signingSecret);
  expect(
    await decryptWebhookSecret(
      encryptionKey,
      created.id,
      2,
      rotated.secretCiphertext,
    ),
  ).not.toBe(created.signingSecret);
  expect(rotated.previousSecretExpiresAt!.getTime()).toBeGreaterThan(
    Date.now() + 3500000,
  );
  expect(
    await db.auditEvent.count({ where: { action: "webhook.secret_rotated" } }),
  ).toBe(1);
  const updated = await updateWebhookEndpoint(db, owner, created.id, {
    name: "Renamed",
  });
  expect(updated.name).toBe("Renamed");
  expect(updated).not.toHaveProperty("signingSecret");
  await deleteWebhookEndpoint(db, owner, created.id);
  expect((await listWebhookEndpoints(db, owner)).data).toHaveLength(0);
});

it("denies other workspaces, members, impersonation, API keys, and OAuth administration", async () => {
  const created = await createWebhookEndpoint(db, owner, fields, encryptionKey);
  const other = { ...owner, organizationId: "two" };
  expect((await listWebhookEndpoints(db, other)).data).toEqual([]);
  for (const action of [
    () => updateWebhookEndpoint(db, other, created.id, { name: "Stolen" }),
    () => deleteWebhookEndpoint(db, other, created.id),
    () => rotateWebhookSecret(db, other, created.id, encryptionKey),
  ])
    await expect(action()).rejects.toMatchObject({ status: 404 });
  for (const principal of [
    { ...owner, role: "member" },
    { ...owner, impersonatedBy: "support" },
    { ...owner, credential: { kind: "key" as const, id: "key" } },
    { ...owner, credential: { kind: "oauth" as const, id: "token" } },
  ]) {
    await expect(
      createWebhookEndpoint(db, principal, fields, encryptionKey),
    ).rejects.toMatchObject({ status: 403 });
    await expect(listWebhookEndpoints(db, principal)).rejects.toMatchObject({
      status: 403,
    });
  }
});

it("rejects unsafe URL syntax and unsupported enablement without network requests", async () => {
  for (const url of [
    "bad url",
    "http://hooks.customer.com",
    "https://localhost",
    "https://internal.local",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://user:pass@hooks.customer.com",
    "https://hooks.customer.com:444",
    "https://hooks.customer.com/#fragment",
  ]) {
    await expect(
      createWebhookEndpoint(db, owner, { ...fields, url }, encryptionKey),
    ).rejects.toHaveProperty("name", "ZodError");
  }
  await expect(
    createWebhookEndpoint(
      db,
      owner,
      { ...fields, enabled: true },
      encryptionKey,
    ),
  ).rejects.toHaveProperty("name", "ZodError");
  expect(await db.webhookEndpoint.count()).toBe(0);
  await expect(createWebhookEndpoint(db, owner, fields)).rejects.toMatchObject({
    status: 503,
  });
});

it("binds encrypted secrets to the endpoint, version, and encryption key", async () => {
  const saved = await createWebhookSecret(encryptionKey, "endpoint", 1);
  for (const [key, id, version] of [
    [encryptionKey, "other", 1],
    [encryptionKey, "endpoint", 2],
    [Buffer.alloc(32, 43).toString("base64url"), "endpoint", 1],
  ] as const) {
    await expect(
      decryptWebhookSecret(key, id, version, saved.ciphertext),
    ).rejects.toMatchObject({ code: "webhook_secret_unavailable" });
  }
});

it("scopes delivery history and cursors to an endpoint, with stable pagination and redacted attempt details", async () => {
  const created = await createWebhookEndpoint(db, owner, fields, encryptionKey);
  const other = await createWebhookEndpoint(
    db,
    { ...owner, organizationId: "two" },
    fields,
    encryptionKey,
  );
  const date = new Date("2026-09-01T00:00:00Z");
  for (const [id, endpointId] of [
    ["a", created.id],
    ["b", created.id],
    ["c", created.id],
    ["foreign", other.id],
  ]) {
    await db.webhookDelivery.create({
      data: {
        id: id!,
        endpointId: endpointId!,
        eventId: id!,
        url: "https://hooks.customer.com/private?token=hidden",
        body: '{"private":"message body"}',
        createdAt: date,
        leaseToken: "private-lease",
      },
    });
  }
  await db.webhookDeliveryAttempt.create({
    data: {
      deliveryId: "c",
      attempt: 1,
      statusCode: 503,
      error: "http_error",
      finishedAt: new Date(),
    },
  });
  const first = await listWebhookDeliveries(db, owner, created.id, {
    limit: "2",
  });
  expect(first.data.map((row) => row.id)).toEqual(["c", "b"]);
  expect(first.nextCursor).toBe("b");
  const second = await listWebhookDeliveries(db, owner, created.id, {
    limit: 2,
    cursor: first.nextCursor,
  });
  expect(second.data.map((row) => row.id)).toEqual(["a"]);
  expect(second.nextCursor).toBeNull();
  const details = await getWebhookDelivery(db, owner, created.id, "c");
  expect(details.logs).toHaveLength(1);
  expect(details.logs[0]).toMatchObject({
    attempt: 1,
    statusCode: 503,
    error: "http_error",
  });
  for (const data of [first, second, details]) {
    expect(JSON.stringify(data)).not.toMatch(
      /private|ciphertext|signingSecret|https:/,
    );
  }
  await expect(
    listWebhookDeliveries(db, owner, created.id, { cursor: "foreign" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    listWebhookDeliveries(db, owner, other.id, {}),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    getWebhookDelivery(db, owner, created.id, "foreign"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    listWebhookDeliveries(db, owner, created.id, { limit: 101 }),
  ).rejects.toThrow();
  for (const principal of [
    { ...owner, role: "member" },
    { ...owner, impersonatedBy: "support" },
    { ...owner, credential: { kind: "key", id: "key" } },
    { ...owner, credential: { kind: "oauth", id: "token" } },
  ] as Principal[]) {
    await expect(
      listWebhookDeliveries(db, principal, created.id, {}),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getWebhookDelivery(db, principal, created.id, "c"),
    ).rejects.toMatchObject({ status: 403 });
  }
});

it("enables new events only and cancels queued retries permanently when disabled", async () => {
  const endpoint = await createWebhookEndpoint(
    db,
    owner,
    fields,
    encryptionKey,
  );
  const emit = () =>
    db.event.create({
      data: {
        organizationId: "one",
        type: "email.received",
        resourceId: "message",
      },
    });
  await emit();
  expect(await db.webhookDelivery.count()).toBe(0);
  await expect(
    updateWebhookEndpoint(db, owner, endpoint.id, { enabled: true }),
  ).rejects.toMatchObject({ status: 503 });
  await updateWebhookEndpoint(
    db,
    owner,
    endpoint.id,
    { enabled: true },
    encryptionKey,
  );
  await emit();
  const pending = await db.webhookDelivery.findFirstOrThrow();
  expect(pending.status).toBe("pending");
  await updateWebhookEndpoint(
    db,
    owner,
    endpoint.id,
    { enabled: false },
    encryptionKey,
  );
  expect(
    (await db.webhookDelivery.findUniqueOrThrow({ where: { id: pending.id } }))
      .status,
  ).toBe("cancelled");
  await updateWebhookEndpoint(
    db,
    owner,
    endpoint.id,
    { enabled: true },
    encryptionKey,
  );
  await emit();
  expect(await db.webhookDelivery.count({ where: { status: "pending" } })).toBe(
    1,
  );
  await updateWebhookEndpoint(
    db,
    owner,
    endpoint.id,
    { url: "https://new.customer.com/events" },
    encryptionKey,
  );
  expect(await db.webhookDelivery.count({ where: { status: "pending" } })).toBe(
    0,
  );
});
