import { sendSms } from "../src/sms";
import { reserveCredentialUsage } from "../src/key-usage";
import { getCredentialLimits } from "../src/send-limits";
import {
  approvalPageSchema,
  errorResponseSchema,
  emailOperationSchema,
  operationSchema,
  inboxSchema,
} from "../../contracts/src/responses";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { createAuth } from "@agentinfra/auth";
import { createApi } from "../src/index";
import { decideApproval } from "../src/approvals";
import { hash } from "../src/errors";
import type { Principal } from "../src/principal";
const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@agentinfra/providers", async (original) => ({
  ...(await original<object>()),
  resendClient: () => ({ emails: { send: mock.send } }),
}));
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const auth = createAuth(db, {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "email-approval-tests-long-enough-secret",
});
const api = createApi(db, auth, {
  RESEND_API_KEY: "fixture",
  EMAIL_DOMAIN: "example.test",
});
const owner: Principal = {
  id: "owner",
  userId: "owner",
  organizationId: "org",
  role: "owner",
  scopes: [],
  credential: { kind: "session", id: "fixture" },
};
const send = (
  path = "/v1/inboxes/inbox/messages",
  body: unknown = {
    to: ["to@example.test"],
    subject: "Review subject",
    text: "<img src=x onerror=alert(1)>",
  },
  key = "send",
) =>
  api.request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation" CASCADE',
  );
  await db.user.create({
    data: {
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    },
  });
  await db.organization.create({
    data: {
      id: "org",
      name: "Org",
      slug: "org",
      createdAt: new Date(),
      requireEmailApproval: true,
    },
  });
  await db.member.create({
    data: {
      id: "member",
      userId: "owner",
      organizationId: "org",
      role: "owner",
      createdAt: new Date(),
    },
  });
  await db.apiKey.create({
    data: {
      organizationId: "org",
      createdBy: "owner",
      name: "fixture",
      prefix: "fixture",
      hash: await hash("fixture"),
      scopes: ["email:send"],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.inbox.create({
    data: {
      id: "inbox",
      organizationId: "org",
      name: "Inbox",
      address: "from@example.test",
      status: "active",
    },
  });
  mock.send
    .mockReset()
    .mockResolvedValue({ data: { id: "provider-message" }, error: null });
});
afterAll(() => db.$disconnect());
it("requires review of exact email, consumes once, and permits listing with email-only credentials", async () => {
  const blocked = await send();
  expect(blocked.status).toBe(409);
  const errorBody = await blocked.json();
  expect(errorResponseSchema.safeParse(errorBody).success).toBe(true);
  const { error } = errorBody;
  expect(error.code).toBe("approval_required");
  const id = error.details.approvalId;
  expect(mock.send).not.toHaveBeenCalled();
  expect(await db.emailMessage.count()).toBe(0);
  expect(await db.workspaceEmailUsage.count()).toBe(0);
  const listing = await api.request("http://localhost:3000/v1/approvals", {
    headers: { Authorization: "Bearer fixture" },
  });
  expect(listing.status).toBe(200);
  const approvalPage = await listing.json();
  expect(approvalPageSchema.safeParse(approvalPage).success).toBe(true);
  expect(approvalPage.data[0]).toMatchObject({
    id,
    parameters: {
      from: "from@example.test",
      to: ["to@example.test"],
      subject: "Review subject",
    },
  });
  await decideApproval(db, owner, id, "approved");
  const changed = await send(undefined, {
    to: ["other@example.test"],
    subject: "Review subject",
    text: "Changed",
  });
  expect((await changed.json()).error.code).toBe("idempotency_conflict");
  const results = await Promise.all([send(), send()]);
  expect(results.every((r) => r.ok)).toBe(true);
  const bodies = await Promise.all(results.map((r) => r.json()));
  expect(
    bodies.every((body) => emailOperationSchema.safeParse(body).success),
  ).toBe(true);
  expect(bodies[0].id).toBe(bodies[1].id);
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect((await db.approval.findUniqueOrThrow({ where: { id } })).status).toBe(
    "consumed",
  );
});
it("reviews resolved reply recipients and retains approval when a hard limit blocks execution", async () => {
  await db.emailMessage.create({
    data: {
      id: "parent",
      threadId: "thread",
      organizationId: "org",
      inboxId: "inbox",
      direction: "inbound",
      status: "received",
      from: "sender@example.test",
      to: ["from@example.test"],
      replyTo: ["reply@example.test"],
      subject: "Original",
      text: "Untrusted",
    },
  });
  const path = "/v1/messages/parent/reply";
  const pending = await (await send(path, { text: "Reply" })).json();
  const id = pending.error.details.approvalId;
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id } })).parameters,
  ).toMatchObject({
    to: ["reply@example.test"],
    subject: "Re: Original",
    text: "Reply",
  });
  await decideApproval(db, owner, id, "approved");
  await db.organization.update({
    where: { id: "org" },
    data: { dailyEmailLimit: 0 },
  });
  expect((await send(path, { text: "Reply" })).status).toBe(429);
  expect((await db.approval.findUniqueOrThrow({ where: { id } })).status).toBe(
    "approved",
  );
  expect(mock.send).not.toHaveBeenCalled();
  await db.organization.update({
    where: { id: "org" },
    data: { dailyEmailLimit: 10 },
  });
  expect((await send(path, { text: "Reply" })).ok).toBe(true);
  expect(mock.send.mock.calls[0][0]).toMatchObject({
    to: ["reply@example.test"],
    subject: "Re: Original",
    text: "Reply",
  });
});

it("creates an approved inbox once without requiring an agent", async () => {
  await db.organization.update({
    where: { id: "org" },
    data: { requireProvisioningApproval: true },
  });
  await db.apiKey.updateMany({ data: { scopes: ["inboxes:write"] } });
  const input = { name: "Review inbox", localPart: "reviewed" };
  const pending = await send("/v1/inboxes", input, "inbox");
  expect(pending.status).toBe(409);
  const id = (await pending.json()).error.details.approvalId;
  expect(await db.inbox.count()).toBe(1);
  expect(await db.operation.count()).toBe(0);
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id } })).parameters,
  ).toMatchObject({ address: "reviewed@example.test", name: input.name });
  const list = await api.request("http://localhost:3000/v1/approvals", {
    headers: { Authorization: "Bearer fixture" },
  });
  expect(list.status).toBe(200);
  await decideApproval(db, owner, id, "approved");
  const created = await Promise.all([
    send("/v1/inboxes", input, "inbox"),
    send("/v1/inboxes", input, "inbox"),
  ]);
  expect(created.map((r) => r.status)).toEqual([201, 201]);
  const results = await Promise.all(created.map((r) => r.json()));
  expect(results.every((body) => inboxSchema.safeParse(body).success)).toBe(
    true,
  );
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].agentId).toBeNull();
  expect(await db.inbox.count()).toBe(2);
  expect((await db.approval.findUniqueOrThrow({ where: { id } })).status).toBe(
    "consumed",
  );
  expect(mock.send).not.toHaveBeenCalled();
});

it("returns a terminal failed email replay with HTTP 200 and a typed operation without resending", async () => {
  await db.organization.update({
    where: { id: "org" },
    data: { requireEmailApproval: false },
  });
  mock.send.mockResolvedValueOnce({
    data: null,
    error: { statusCode: 422, name: "validation_error" },
  });
  expect((await send()).status).toBe(502);
  const replay = await send();
  expect(replay.status).toBe(200);
  const body = emailOperationSchema.parse(await replay.json());
  expect(body.status).toBe("failed");
  const read = await api.request(`http://localhost:3000${body.statusUrl}`, {
    headers: { Authorization: "Bearer fixture" },
  });
  expect(operationSchema.parse(await read.json()).status).toBe("failed");
  expect(mock.send).toHaveBeenCalledTimes(1);
});

it("enforces the key's email limit across concurrent sends without charging replays", async () => {
  await db.organization.update({
    where: { id: "org" },
    data: { requireEmailApproval: false },
  });
  await db.apiKey.updateMany({ data: { dailyEmailLimit: 1 } });
  const responses = await Promise.all([
    send(undefined, undefined, "key-one"),
    send(undefined, undefined, "key-two"),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
  const successfulKey = responses[0]!.status === 201 ? "key-one" : "key-two";
  expect((await send(undefined, undefined, successfulKey)).status).toBe(200);
  expect(mock.send).toHaveBeenCalledTimes(1);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).emailSends).toBe(1);
  expect((await db.workspaceEmailUsage.findFirstOrThrow()).sends).toBe(1);
});

it("rolls back key usage when workspace quota fails and reserves nothing before approval", async () => {
  await db.apiKey.updateMany({ data: { dailyEmailLimit: 1 } });
  expect((await send()).status).toBe(409);
  expect(await db.apiKeyDailyUsage.count()).toBe(0);
  await db.organization.update({
    where: { id: "org" },
    data: { requireEmailApproval: false, dailyEmailLimit: 0 },
  });
  expect((await send()).status).toBe(429);
  expect(await db.apiKeyDailyUsage.count()).toBe(0);
  expect(await db.operation.count()).toBe(0);
  expect(mock.send).not.toHaveBeenCalled();
});

it("blocks new email when the key has a zero allowance", async () => {
  await db.organization.update({
    where: { id: "org" },
    data: { requireEmailApproval: false },
  });
  await db.apiKey.updateMany({ data: { dailyEmailLimit: 0 } });
  const response = await send();
  expect(response.status).toBe(429);
  expect((await response.json()).error.message).toBe(
    "API key daily email limit reached",
  );
  expect(mock.send).not.toHaveBeenCalled();
});

it("reserves independent SMS limits atomically and preserves retries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { id: "sms-provider" } }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const key = await db.apiKey.findFirstOrThrow();
    await db.apiKey.update({
      where: { id: key.id },
      data: { dailySmsLimit: 1, dailyEmailLimit: 0 },
    });
    await db.phoneNumber.create({
      data: {
        id: "number",
        organizationId: "org",
        phoneNumber: "+12025550101",
        messagingProfileId: "fixture",
        status: "active",
      },
    });
    const principal: Principal = {
      ...owner,
      id: key.id,
      role: "agent",
      scopes: ["sms:send"],
      credential: { kind: "key", id: key.id },
    };
    const env = { TELNYX_API_KEY: "fixture", TELNYX_STATUS: "active" };
    const body = { to: "+12025550102", text: "Fixture" };
    const outcomes = await Promise.allSettled([
      sendSms(db, env, principal, "number", body, "sms-one"),
      sendSms(db, env, principal, "number", body, "sms-two"),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      status: 429,
      code: "quota_exceeded",
    });
    await sendSms(
      db,
      env,
      principal,
      "number",
      body,
      outcomes[0]!.status === "fulfilled" ? "sms-one" : "sms-two",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await db.apiKeyDailyUsage.findFirstOrThrow()).toMatchObject({
      emailSends: 0,
      smsSends: 1,
    });
    expect((await db.workspaceEmailUsage.findFirstOrThrow()).smsSends).toBe(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("reports only the caller's effective daily allowance and approval requirement", async () => {
  const key = await db.apiKey.findFirstOrThrow();
  const day = new Date().toISOString().slice(0, 10);
  await db.apiKey.update({
    where: { id: key.id },
    data: { dailyEmailLimit: 2, dailySmsLimit: 3 },
  });
  await db.apiKeyDailyUsage.create({
    data: { apiKeyId: key.id, day, emailSends: 1, smsSends: 1 },
  });
  await db.organization.update({
    where: { id: "org" },
    data: { dailyEmailLimit: 5 },
  });
  await db.workspaceEmailUsage.create({
    data: { organizationId: "org", day, sends: 3 },
  });
  const response = await api.request("http://localhost:3000/v1/me", {
    headers: { Authorization: "Bearer fixture" },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sendLimits).toMatchObject({
    day,
    email: { dailyLimit: 2, remaining: 1, approvalRequired: true },
    sms: { dailyLimit: 3, remaining: 0, approvalRequired: false },
  });
  expect(new Date(body.sendLimits.resetsAt).getUTCHours()).toBe(0);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).emailSends).toBe(1);
  await db.workspaceEmailUsage.updateMany({ data: { sends: 5 } });
  const exhausted = await (
    await api.request("http://localhost:3000/v1/me", {
      headers: { Authorization: "Bearer fixture" },
    })
  ).json();
  expect(exhausted.sendLimits.email.remaining).toBe(0);
});

it("shares OAuth quota across rotated tokens and prevents concurrent overspend", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ data: { id: "oauth-sms-provider" } }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await db.oauthClient.create({
      data: {
        id: "client",
        clientId: "client",
        redirectUris: ["https://example.test/callback"],
      },
    });
    await db.oauthConsent.create({
      data: {
        id: "consent",
        clientId: "client",
        userId: "owner",
        referenceId: "org",
        scopes: ["sms:send"],
        resources: [],
        requestedUserInfoClaims: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        dailySmsLimit: 1,
      },
    });
    await db.phoneNumber.create({
      data: {
        id: "number",
        organizationId: "org",
        phoneNumber: "+12025550101",
        messagingProfileId: "fixture",
        status: "active",
      },
    });
    const principal: Principal = {
      ...owner,
      id: "oauth:client:owner:org",
      role: "agent",
      scopes: ["sms:send"],
      oauthConsentId: "consent",
      credential: { kind: "oauth", id: "token-one" },
    };
    const rotated: Principal = {
      ...principal,
      credential: { kind: "oauth", id: "token-two" },
    };
    const env = { TELNYX_API_KEY: "fixture", TELNYX_STATUS: "active" };
    const body = { to: "+12025550102", text: "Fixture" };
    const results = await Promise.allSettled([
      sendSms(db, env, principal, "number", body, "one"),
      sendSms(db, env, rotated, "number", body, "two"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ status: 429 });
    await sendSms(
      db,
      env,
      rotated,
      "number",
      body,
      results[0]!.status === "fulfilled" ? "one" : "two",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await db.oAuthDailyUsage.findFirstOrThrow()).smsSends).toBe(1);
    await db.oauthConsent.update({
      where: { id: "consent" },
      data: { dailySmsLimit: 0 },
    });
    await expect(
      sendSms(db, env, rotated, "number", body, "three"),
    ).rejects.toMatchObject({ status: 429 });
    expect((await db.oAuthDailyUsage.findFirstOrThrow()).smsSends).toBe(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("limits concurrent inbox creation per key and counts idempotent replay once", async () => {
  await db.apiKey.updateMany({
    data: { scopes: ["inboxes:write"], dailyInboxLimit: 1 },
  });
  const create = (localPart: string, key: string) =>
    send("/v1/inboxes", { name: localPart, localPart }, key);
  const results = await Promise.all([
    create("first", "first"),
    create("second", "second"),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
  const winner = results[0]!.status === 201 ? "first" : "second";
  expect((await create(winner, winner)).status).toBe(201);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).inboxCreations).toBe(1);
  expect(await db.inbox.count()).toBe(2);
  await db.apiKey.updateMany({ data: { dailyInboxLimit: 0 } });
  expect((await create("third", "third")).status).toBe(429);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).inboxCreations).toBe(1);
});

it("does not consume an inbox allowance while waiting for human approval", async () => {
  await db.apiKey.updateMany({
    data: { scopes: ["inboxes:write"], dailyInboxLimit: 1 },
  });
  await db.organization.update({
    where: { id: "org" },
    data: { requireProvisioningApproval: true },
  });
  const response = await send(
    "/v1/inboxes",
    { name: "Review", localPart: "review" },
    "review",
  );
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("approval_required");
  expect(await db.apiKeyDailyUsage.count()).toBe(0);
});

it.each(["inbox", "number"] as const)(
  "shares OAuth %s creation limits across refreshed tokens and rolls back aborted transactions",
  async (action) => {
    await db.oauthClient.create({
      data: {
        id: "client",
        clientId: "client",
        redirectUris: ["https://example.test/callback"],
      },
    });
    await db.oauthConsent.create({
      data: {
        id: "consent",
        clientId: "client",
        userId: "owner",
        referenceId: "org",
        scopes: ["inboxes:write", "numbers:provision"],
        resources: [],
        requestedUserInfoClaims: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        dailyInboxLimit: 1,
        dailyNumberLimit: 1,
      },
    });
    const principal: Principal = {
      ...owner,
      id: "oauth:client:owner:org",
      oauthConsentId: "consent",
      credential: { kind: "oauth", id: "first-token" },
      scopes: ["inboxes:write", "numbers:provision"],
    };
    const reserve = (token: string, abort = false) =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"org"}))`;
        await reserveCredentialUsage(
          tx,
          { ...principal, credential: { kind: "oauth", id: token } },
          action,
          new Date().toISOString().slice(0, 10),
        );
        if (abort) throw new Error("abort");
      });
    await expect(reserve("first-token", true)).rejects.toThrow("abort");
    expect(await db.oAuthDailyUsage.count()).toBe(0);
    const attempts = await Promise.allSettled([
      reserve("first-token"),
      reserve("refreshed-token"),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (attempts.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ code: "quota_exceeded" });
    const usage = await db.oAuthDailyUsage.findFirstOrThrow();
    expect(usage.inboxCreations).toBe(action === "inbox" ? 1 : 0);
    expect(usage.numberPurchases).toBe(action === "number" ? 1 : 0);
    expect(usage.emailSends).toBe(0);
    expect(usage.smsSends).toBe(0);
    const snapshot = await getCredentialLimits(db, principal);
    expect(snapshot.provisioningLimits.inboxes.dailyLimit).toBe(1);
    expect(snapshot.provisioningLimits.phoneNumbers.dailyLimit).toBe(1);
    expect(snapshot.provisioningLimits.inboxes.remaining).toBe(
      action === "inbox" ? 0 : 1,
    );
    expect(snapshot.provisioningLimits.phoneNumbers.remaining).toBe(
      action === "number" ? 0 : 1,
    );
  },
);

it("reports provisioning allowance constrained by daily usage, workspace capacity and scopes", async () => {
  const key = await db.apiKey.findFirstOrThrow();
  const day = new Date().toISOString().slice(0, 10);
  await db.apiKey.update({
    where: { id: key.id },
    data: {
      scopes: ["inboxes:write", "numbers:provision"],
      dailyInboxLimit: 3,
      dailyNumberLimit: 2,
    },
  });
  await db.apiKeyDailyUsage.create({
    data: { apiKeyId: key.id, day, inboxCreations: 2, numberPurchases: 1 },
  });
  await db.organization.update({
    where: { id: "org" },
    data: {
      maxInboxes: 4,
      maxPhoneNumbers: 2,
      requireProvisioningApproval: true,
    },
  });
  await db.phoneNumber.create({
    data: {
      organizationId: "org",
      phoneNumber: "+12025550101",
      messagingProfileId: "fixture",
      status: "unknown",
    },
  });
  const identity = async () =>
    (
      await api.request("http://localhost:3000/v1/me", {
        headers: { Authorization: "Bearer fixture" },
      })
    ).json();
  expect((await identity()).provisioningLimits).toMatchObject({
    day,
    inboxes: {
      dailyLimit: 3,
      capacityRemaining: 3,
      remaining: 1,
      approvalRequired: true,
    },
    phoneNumbers: {
      dailyLimit: 2,
      capacityRemaining: 1,
      remaining: 1,
      approvalRequired: true,
    },
  });
  // A released assignment no longer consumes workspace capacity, but its daily purchase still does.
  await db.phoneNumber.updateMany({ data: { status: "released" } });
  expect((await identity()).provisioningLimits.phoneNumbers).toMatchObject({
    capacityRemaining: 2,
    remaining: 1,
  });
  await db.apiKey.update({
    where: { id: key.id },
    data: { dailyInboxLimit: null, scopes: ["inboxes:write"] },
  });
  const unrestricted = (await identity()).provisioningLimits;
  expect(unrestricted.inboxes).toMatchObject({
    dailyLimit: null,
    remaining: 3,
  });
  expect(unrestricted.phoneNumbers.remaining).toBe(0);
  await db.organization.update({
    where: { id: "org" },
    data: { maxInboxes: 1 },
  });
  expect((await identity()).provisioningLimits.inboxes.remaining).toBe(0);
  expect((await db.apiKeyDailyUsage.findFirstOrThrow()).inboxCreations).toBe(2);
});
