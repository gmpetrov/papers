import { smsDetailSchema, smsPageSchema } from "../../contracts/src/responses";
import { beforeAll, afterAll, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createDatabase } from "@agentinfra/db";
import { ingestTelnyx, processTelnyxEvents } from "../src/telnyx-webhooks";
import { processProviderEvents } from "../src/webhooks";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const env = {
  TELNYX_PUBLIC_KEY: Buffer.from(
    publicKey.export({ format: "jwk" }).x!,
    "base64url",
  ).toString("base64"),
};
let numberId = "";
function event(id: string, overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id,
      event_type: "message.received",
      occurred_at: new Date().toISOString(),
      payload: {
        id: "sms-provider",
        type: "SMS",
        direction: "inbound",
        messaging_profile_id: "profile",
        from: { phone_number: "+12025550100" },
        to: [{ phone_number: "+12025550101" }],
        text: "Hello",
        ...overrides,
      },
    },
  };
}
function request(
  body: unknown,
  timestamp = String(Math.floor(Date.now() / 1000)),
  tamper = false,
) {
  const payload = JSON.stringify(body);
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${payload}`),
    privateKey,
  ).toString("base64");
  return new Request("https://example.test/api/webhooks/telnyx", {
    method: "POST",
    headers: {
      "telnyx-timestamp": timestamp,
      "telnyx-signature-ed25519": signature,
    },
    body: tamper ? payload + " " : payload,
  });
}
async function processDueEvents() {
  await db.providerEvent.updateMany({
    where: { provider: "telnyx", status: "pending", attempts: 0 },
    data: { availableAt: new Date(0) },
  });
  return processTelnyxEvents(db);
}
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: { id: "sms-org", name: "SMS", slug: "sms", createdAt: new Date() },
  });
  const project = await db.project.create({
    data: { organizationId: "sms-org" },
  });
  const agent = await db.agent.create({
    data: { organizationId: "sms-org", projectId: project.id, name: "SMS" },
  });
  const number = await db.phoneNumber.create({
    data: {
      organizationId: "sms-org",
      agentId: agent.id,
      phoneNumber: "+12025550101",
      messagingProfileId: "profile",
      status: "active",
    },
  });
  numberId = number.id;
});
afterAll(() => db.$disconnect());
it("rejects unsigned, modified, and stale requests before storing events", async () => {
  await expect(
    ingestTelnyx(
      db,
      env,
      new Request("https://example.test", { method: "POST", body: "{}" }),
    ),
  ).rejects.toThrow("Invalid Telnyx");
  await expect(
    ingestTelnyx(db, env, request(event("stale"), "1")),
  ).rejects.toThrow("Invalid Telnyx");
  await expect(
    ingestTelnyx(db, env, request(event("modified"), undefined, true)),
  ).rejects.toThrow("Invalid Telnyx");
  expect(await db.providerEvent.count()).toBe(0);
});
it("deduplicates webhook ingress and routes SMS to its assigned profile and number", async () => {
  await ingestTelnyx(db, env, request(event("one")));
  await ingestTelnyx(db, env, request(event("one")));
  await db.providerEvent.updateMany({
    where: { provider: "telnyx" },
    data: { availableAt: new Date(0) },
  });
  expect(await db.providerEvent.count()).toBe(1);
  expect((await processProviderEvents(db, {})).processed).toBe(0);
  await processDueEvents();
  expect(await db.smsMessage.findFirst()).toMatchObject({
    organizationId: "sms-org",
    phoneNumberId: numberId,
    text: "Hello",
    direction: "inbound",
  });
  await ingestTelnyx(db, env, request(event("duplicate-message")));
  await processDueEvents();
  expect(await db.smsMessage.count()).toBe(1);
  expect(await db.event.count({ where: { type: "sms.received" } })).toBe(1);
});
it("ignores mismatched profiles and unallocated recipients", async () => {
  await ingestTelnyx(
    db,
    env,
    request(
      event("wrong-profile", {
        id: "other",
        messaging_profile_id: "other-profile",
      }),
    ),
  );
  await ingestTelnyx(
    db,
    env,
    request(
      event("wrong-number", {
        id: "other-two",
        to: [{ phone_number: "+12025550199" }],
      }),
    ),
  );
  await processDueEvents();
  expect(await db.smsMessage.count()).toBe(1);
});
it("keeps final delivery state when an older sent event arrives later", async () => {
  const message = await db.smsMessage.create({
    data: {
      organizationId: "sms-org",
      phoneNumberId: numberId,
      providerId: "outbound",
      direction: "outbound",
      status: "pending",
      from: "+12025550101",
      to: "+12025550100",
      text: "Reply",
      unread: false,
    },
  });
  const final = event("final", {
    id: "outbound",
    direction: "outbound",
    from: { phone_number: "+12025550101" },
    to: [{ phone_number: "+12025550100", status: "delivered" }],
  });
  final.data.event_type = "message.finalized";
  await ingestTelnyx(db, env, request(final));
  await processDueEvents();
  const sent = structuredClone(final);
  sent.data.id = "late-sent";
  sent.data.event_type = "message.sent";
  sent.data.occurred_at = new Date(Date.now() - 60000).toISOString();
  (sent.data.payload.to as { status: string }[])[0]!.status = "sent";
  await ingestTelnyx(db, env, request(sent));
  await processDueEvents();
  expect(
    (await db.smsMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .status,
  ).toBe("delivered");
  expect(await db.event.count({ where: { resourceId: message.id } })).toBe(1);
});

it("isolates SMS reads by agent and requires a separate content scope", async () => {
  const { createAuth } = await import("@agentinfra/auth");
  const { createApi } = await import("../src/index");
  const { hash } = await import("../src/errors");
  const number = await db.phoneNumber.findUniqueOrThrow({
    where: { id: numberId },
    include: { agent: true },
  });
  await db.user.create({
    data: {
      id: "sms-owner",
      name: "Owner",
      email: "sms-owner@example.test",
      emailVerified: true,
    },
  });
  await db.member.create({
    data: {
      id: "sms-owner-member",
      organizationId: "sms-org",
      userId: "sms-owner",
      role: "owner",
      createdAt: new Date(),
    },
  });
  for (const [token, scopes] of [
    ["sms-reader", ["sms:read", "numbers:read"]],
    ["numbers-only", ["numbers:read"]],
  ] as const) {
    await db.apiKey.create({
      data: {
        organizationId: "sms-org",
        agentId: number.agentId,
        createdBy: "sms-owner",
        name: token,
        prefix: token,
        hash: await hash(token),
        scopes: [...scopes],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  }
  const otherAgent = await db.agent.create({
    data: {
      organizationId: "sms-org",
      projectId: number.agent.projectId,
      name: "Other",
    },
  });
  const otherNumber = await db.phoneNumber.create({
    data: {
      organizationId: "sms-org",
      agentId: otherAgent.id,
      phoneNumber: "+12025550102",
      messagingProfileId: "profile",
      status: "active",
    },
  });
  const otherMessage = await db.smsMessage.create({
    data: {
      organizationId: "sms-org",
      phoneNumberId: otherNumber.id,
      direction: "inbound",
      status: "received",
      from: "+12025550100",
      to: otherNumber.phoneNumber,
      text: "Private",
    },
  });
  const auth = createAuth(db, {
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "sms-test-secret-long-enough-for-auth",
  });
  const api = createApi(db, auth, {});
  const get = (path: string, token = "sms-reader") =>
    api.request("http://localhost:3000/v1" + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
  expect(
    (await (await get("/phone-numbers")).json()).data.map(
      (n: { id: string }) => n.id,
    ),
  ).toEqual([numberId]);
  expect((await get(`/phone-numbers/${otherNumber.id}`)).status).toBe(404);
  expect((await get(`/phone-numbers/${otherNumber.id}/messages`)).status).toBe(
    404,
  );
  expect((await get(`/sms/${otherMessage.id}`)).status).toBe(404);
  expect(
    (await get(`/phone-numbers/${numberId}/messages`, "numbers-only")).status,
  ).toBe(403);
  const page = await (
    await get(`/phone-numbers/${numberId}/messages?limit=1`)
  ).json();
  expect(smsPageSchema.safeParse(page).success).toBe(true);
  expect(page.data).toHaveLength(1);
  expect(page.data[0].text).toBeUndefined();
  expect(page.nextCursor).toBeTruthy();
  const message = await (await get(`/sms/${page.data[0].id}`)).json();
  expect(smsDetailSchema.safeParse(message).success).toBe(true);
  expect(message.contentTrust).toBe("untrusted");
  expect(message.recipientOptOut).toEqual({
    status: "unknown",
    observedAt: null,
  });
  expect(message.phoneNumber).toBeUndefined();
  expect(message.messagingProfileId).toBeUndefined();

  expect(typeof message.text).toBe("string");
  expect(
    await db.auditEvent.count({
      where: { action: "sms.read", resourceId: message.id },
    }),
  ).toBe(1);
  const recipient = message.direction === "inbound" ? message.from : message.to;
  const where = {
    messagingProfileId_recipient: { messagingProfileId: "profile", recipient },
  };
  try {
    await db.providerSmsOptOut.create({
      data: {
        messagingProfileId: "profile",
        recipient,
        optedOut: true,
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        eventId: "private-provider-event",
      },
    });
    const blocked = await (await get(`/sms/${message.id}`)).json();
    expect(blocked.recipientOptOut).toEqual({
      status: "blocked",
      observedAt: "2026-09-16T12:00:00.000Z",
    });
    expect(JSON.stringify(blocked)).not.toContain("private-provider-event");
    expect((await get(`/sms/${message.id}`, "numbers-only")).status).toBe(403);
    expect((await get(`/sms/${otherMessage.id}`)).status).toBe(404);
    await db.providerSmsOptOut.update({ where, data: { optedOut: false } });
    expect(
      (await (await get(`/sms/${message.id}`)).json()).recipientOptOut.status,
    ).toBe("not_blocked");
  } finally {
    await db.providerSmsOptOut.deleteMany({
      where: { messagingProfileId: "profile", recipient },
    });
  }
});

it("records exact SMS segments/cost from signed finalized events without regression or double counting", async () => {
  const sms = await db.smsMessage.create({
    data: {
      organizationId: "sms-org",
      phoneNumberId: numberId,
      providerId: "usage-outbound",
      direction: "outbound",
      status: "queued",
      from: "+12025550101",
      to: "+12025550100",
      text: "Usage test",
    },
  });
  const deliver = async (
    id: string,
    timestamp: string,
    data: Record<string, unknown>,
    type = "message.finalized",
  ) => {
    const payload = event(id, {
      id: "usage-outbound",
      direction: "outbound",
      from: { phone_number: "+12025550101" },
      to: [{ phone_number: "+12025550100", status: "delivered" }],
      ...data,
    });
    payload.data.event_type = type;
    payload.data.occurred_at = timestamp;
    await ingestTelnyx(db, env, request(payload));
    await db.providerEvent.update({
      where: { id: "telnyx:" + id },
      data: { availableAt: new Date(0) },
    });
    await processDueEvents();
  };
  await deliver(
    "usage-sent",
    "2026-09-16T10:00:00Z",
    { parts: 2, cost: { amount: "999", currency: "USD" } },
    "message.sent",
  );
  expect(
    (await db.smsMessage.findUniqueOrThrow({ where: { id: sms.id } }))
      .costAmount,
  ).toBeNull();
  await deliver("usage-final", "2026-09-16T10:01:00Z", {
    parts: 3,
    cost: { amount: "0.0153000001", currency: "USD" },
  });
  await deliver("usage-final", "2026-09-16T10:01:00Z", {
    parts: 3,
    cost: { amount: "0.0153000001", currency: "USD" },
  });
  await deliver("usage-old", "2026-09-16T10:00:30Z", {
    parts: 1,
    cost: { amount: "0.0051", currency: "USD" },
  });
  await deliver("usage-missing", "2026-09-16T10:02:00Z", { cost: null });
  const saved = await db.smsMessage.findUniqueOrThrow({
    where: { id: sms.id },
  });
  expect(saved.segments).toBe(3);
  expect(saved.costAmount?.toString()).toBe("0.0153000001");
  expect(saved.costCurrency).toBe("USD");
  expect(
    await db.smsMessage.count({ where: { providerId: "usage-outbound" } }),
  ).toBe(1);
  await deliver("usage-zero", "2026-09-16T10:03:00Z", {
    cost: { amount: "0", currency: "USD" },
  });
  expect(
    (
      await db.smsMessage.findUniqueOrThrow({ where: { id: sms.id } })
    ).costAmount?.toString(),
  ).toBe("0");
});

it("accounts for an in-flight incoming SMS after billing suspension", async () => {
  await db.phoneNumber.update({
    where: { id: numberId },
    data: { status: "billing_suspended" },
  });
  try {
    await ingestTelnyx(
      db,
      env,
      request(
        event("suspended-inbound-event", {
          id: "suspended-inbound-message",
          cost: { amount: "0.004", currency: "USD" },
        }),
      ),
    );
    await processDueEvents();
    const message = await db.smsMessage.findFirstOrThrow({
      where: { providerId: "suspended-inbound-message" },
    });
    expect(message.costAmount?.toString()).toBe("0.004");
  } finally {
    await db.phoneNumber.update({
      where: { id: numberId },
      data: { status: "active" },
    });
  }
});

it("enriches duplicate inbound messages with cost while preserving one message and one received event", async () => {
  await ingestTelnyx(
    db,
    env,
    request(event("usage-initial", { id: "usage-inbound", parts: 2 })),
  );
  await db.providerEvent.update({
    where: { id: "telnyx:usage-initial" },
    data: { availableAt: new Date(0) },
  });
  expect((await processTelnyxEvents(db)).processed).toBe(1);
  await ingestTelnyx(
    db,
    env,
    request(
      event("usage-enriched", {
        id: "usage-inbound",
        parts: 2,
        cost: { amount: "0.004", currency: "USD" },
      }),
    ),
  );
  // Queue eligibility is independent of receipt. Avoid relying on the host and
  // database clocks agreeing within the same millisecond after ingestion.
  await db.providerEvent.update({
    where: { id: "telnyx:usage-enriched" },
    data: { availableAt: new Date(Date.now() + 60000) },
  });
  expect((await processTelnyxEvents(db)).processed).toBe(0);
  expect(
    (
      await db.smsMessage.findFirstOrThrow({
        where: { providerId: "usage-inbound" },
      })
    ).costAmount,
  ).toBeNull();
  await db.providerEvent.update({
    where: { id: "telnyx:usage-enriched" },
    data: { availableAt: new Date(0) },
  });
  expect((await processTelnyxEvents(db)).processed).toBe(1);
  const message = await db.smsMessage.findFirstOrThrow({
    where: { providerId: "usage-inbound" },
  });
  expect(message.segments).toBe(2);
  const enrichment = await db.providerEvent.findUniqueOrThrow({
    where: { id: "telnyx:usage-enriched" },
    select: { status: true, attempts: true, error: true },
  });
  expect(enrichment).toEqual({ status: "completed", attempts: 1, error: null });
  expect(message.costAmount?.toString()).toBe("0.004");
  expect(
    await db.event.count({
      where: { resourceId: message.id, type: "sms.received" },
    }),
  ).toBe(1);
});
