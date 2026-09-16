import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createDatabase } from "@agentinfra/db";
import { sendSms } from "../src/sms";
import { ingestTelnyx, processTelnyxEvents } from "../src/telnyx-webhooks";
import { confirmSmsSend } from "../src/sms-delivery";
import { reconcileSmsSends } from "../src/sms-reconciliation";
import { describeSmsFailure } from "@agentinfra/contracts";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const env = {
  TELNYX_STATUS: "active",
  TELNYX_API_KEY: "test",
  TELNYX_WEBHOOK_URL: "https://example.test/api/webhooks/telnyx",
  TELNYX_PUBLIC_KEY: Buffer.from(
    publicKey.export({ format: "jwk" }).x!,
    "base64url",
  ).toString("base64"),
};
const p: Principal = {
  id: "key",
  userId: "owner",
  organizationId: "org",
  role: "agent",
  scopes: ["sms:send"],
};
const fetcher = vi.fn<typeof fetch>();
const input = { to: "+12025550100", text: "Recovery" };
let numberId: string;
beforeAll(() => vi.stubGlobal("fetch", fetcher));
beforeEach(async () => {
  fetcher.mockReset();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: { id: "org", name: "Workspace", slug: "org", createdAt: new Date() },
  });
  numberId = (
    await db.phoneNumber.create({
      data: {
        organizationId: "org",
        phoneNumber: "+12025550101",
        messagingProfileId: "profile",
        status: "active",
      },
    })
  ).id;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
async function webhook(
  callback: string | undefined,
  overrides: Record<string, unknown> = {},
  transportUrl = env.TELNYX_WEBHOOK_URL,
  kind = "message.finalized",
  status = "delivered",
) {
  const body = JSON.stringify({
    data: {
      id: crypto.randomUUID(),
      event_type: kind,
      occurred_at: new Date().toISOString(),
      payload: {
        id: "provider",
        direction: "outbound",
        type: "SMS",
        messaging_profile_id: "profile",
        from: { phone_number: "+12025550101" },
        to: [{ phone_number: input.to, status }],
        text: input.text,
        ...(callback ? { webhook_url: callback } : {}),
        ...overrides,
      },
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  await ingestTelnyx(
    db,
    env,
    new Request(transportUrl, {
      method: "POST",
      body,
      headers: {
        "telnyx-timestamp": timestamp,
        "telnyx-signature-ed25519": sign(
          null,
          Buffer.from(`${timestamp}|${body}`),
          privateKey,
        ).toString("base64"),
      },
    }),
  );
  // All fixtures are due before this worker pass, independent of DB clock rounding.
  await db.providerEvent.updateMany({
    where: { status: "pending" },
    data: { availableAt: new Date(0) },
  });
  await processTelnyxEvents(db);
}
async function unknownSend() {
  fetcher.mockRejectedValueOnce(new Error("timeout"));
  const result = await sendSms(db, env, p, numberId, input, "send");
  const payload = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(
    new URL(payload.webhook_url).searchParams.get("papers_operation"),
  ).toBe(result.body.id);
  return { result, callback: payload.webhook_url as string };
}
it("recovers a lost response from signed delivery evidence without resending", async () => {
  const { result, callback } = await unknownSend();
  expect(result.body.status).toBe("unknown");
  await webhook(callback);
  await webhook(callback);
  const saved = await db.smsMessage.findFirstOrThrow();
  expect(saved).toMatchObject({ providerId: "provider", status: "delivered" });
  expect((await db.operation.findFirstOrThrow()).status).toBe("completed");
  expect(await db.event.count({ where: { type: "sms.queued" } })).toBe(1);
  const replay = await sendSms(db, env, p, numberId, input, "send");
  expect(replay.body.status).toBe("completed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not let an HTTP timeout overwrite earlier webhook confirmation", async () => {
  fetcher.mockImplementationOnce(async (_url, options) => {
    const payload = JSON.parse(options!.body as string);
    await webhook(payload.webhook_url);
    throw new Error("response lost");
  });
  const result = await sendSms(db, env, p, numberId, input, "send");
  expect(result.body.status).toBe("completed");
  expect(result.status).toBe(200);
  expect((await db.smsMessage.findFirstOrThrow()).status).toBe("delivered");
});
it("does not downgrade a finalized message when the HTTP success arrives late", async () => {
  fetcher.mockImplementationOnce(async (_url, options) => {
    await webhook(JSON.parse(options!.body as string).webhook_url);
    return Response.json({ data: { id: "provider" } });
  });
  expect((await sendSms(db, env, p, numberId, input, "send")).body.status).toBe(
    "completed",
  );
  expect((await db.smsMessage.findFirstOrThrow()).status).toBe("delivered");
  expect(await db.event.count({ where: { type: "sms.queued" } })).toBe(1);
});
it("ignores unsigned transport correlation and mismatched signed message fields", async () => {
  const { callback } = await unknownSend();
  await webhook(undefined, {}, callback);
  expect((await db.operation.findFirstOrThrow()).status).toBe("unknown");
  for (const mismatch of [
    { webhook_url: callback.replace("example.test", "other.test") },
    { text: "Different" },
    { from: { phone_number: "+12025550199" } },
    { to: [{ phone_number: "+12025550198", status: "delivered" }] },
    { messaging_profile_id: "other-profile" },
  ]) {
    await webhook(callback, mismatch);
    expect((await db.operation.findFirstOrThrow()).status).toBe("unknown");
    expect((await db.smsMessage.findFirstOrThrow()).providerId).toBeNull();
  }
});
it("refuses conflicting provider IDs and preserves terminal delivery failures", async () => {
  const { result, callback } = await unknownSend();
  await webhook(
    callback,
    {},
    env.TELNYX_WEBHOOK_URL,
    "message.finalized",
    "delivery_unconfirmed",
  );
  expect(
    await db.$transaction((tx) =>
      confirmSmsSend(tx, result.body.id, "conflicting"),
    ),
  ).toBe(false);
  await webhook(callback, {}, env.TELNYX_WEBHOOK_URL, "message.sent", "sent");
  expect((await db.smsMessage.findFirstOrThrow()).status).toBe(
    "delivery_unconfirmed",
  );
});

it("retains bounded provider diagnostics without persisting response bodies", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json(
      {
        errors: [
          { code: "40001", detail: "PRIVATE_PROVIDER_BODY" },
          { code: "not-a-safe-code" },
        ],
      },
      { status: 422 },
    ),
  );
  const response = await sendSms(db, env, p, numberId, input, "send");
  expect(response.body.status).toBe("failed");
  expect(response.body.failure).toEqual({
    kind: "provider_http_error",
    httpStatus: 422,
    providerCodes: ["40001"],
  });
  const saved = await db.operation.findFirstOrThrow();
  expect(JSON.stringify(saved)).not.toContain("PRIVATE_PROVIDER_BODY");
  expect(JSON.stringify(saved)).not.toContain("not-a-safe-code");
  expect((saved.result as { webhookUrl: string }).webhookUrl).toContain(
    "papers_operation=",
  );
  expect(
    (await sendSms(db, env, p, numberId, input, "send")).body.failure,
  ).toEqual(response.body.failure);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  { codes: ["40306"], status: "failed", messageStatus: "failed" },
  { codes: [], status: "unknown", messageStatus: "pending" },
  { codes: ["99999"], status: "unknown", messageStatus: "pending" },
  { codes: ["40306", "99999"], status: "unknown", messageStatus: "pending" },
])(
  "classifies HTTP 409 with codes $codes as $status without resending",
  async ({ codes, status, messageStatus }) => {
    fetcher.mockResolvedValueOnce(
      Response.json(
        { errors: codes.map((code) => ({ code })) },
        { status: 409 },
      ),
    );
    const response = await sendSms(db, env, p, numberId, input, "conflict");
    expect(response.body.status).toBe(status);
    expect(response.status).toBe(status === "failed" ? 200 : 202);
    expect(response.body.failure).toEqual({
      kind: "provider_http_error",
      httpStatus: 409,
      providerCodes: codes,
    });
    expect(
      (
        await db.smsMessage.findUniqueOrThrow({
          where: { id: response.body.messageId! },
        })
      ).status,
    ).toBe(messageStatus);
    const replay = await sendSms(db, env, p, numberId, input, "conflict");
    expect(replay.body.id).toBe(response.body.id);
    expect(replay.body.status).toBe(status);
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (status === "failed")
      expect(describeSmsFailure(response.body.failure!)).toContain(
        "alphanumeric sender ID",
      );
  },
);

it("shows actionable account verification diagnostics for a rejected send", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({ errors: [{ code: "20014" }] }, { status: 403 }),
  );
  const response = await sendSms(db, env, p, numberId, input, "unverified");
  expect(response.body.status).toBe("failed");
  expect(describeSmsFailure(response.body.failure!)).toContain(
    "Level 2 verification",
  );
  expect(
    (
      await db.smsMessage.findUniqueOrThrow({
        where: { id: response.body.messageId! },
      })
    ).status,
  ).toBe("failed");
});

it("retains timeout diagnostics until a valid webhook resolves the send", async () => {
  fetcher.mockRejectedValueOnce(
    new DOMException("PRIVATE_REQUEST_DETAILS", "TimeoutError"),
  );
  const response = await sendSms(db, env, p, numberId, input, "send");
  expect(response.body.failure).toEqual({ kind: "timeout", providerCodes: [] });
  const operation = await db.operation.findFirstOrThrow();
  expect(JSON.stringify(operation)).not.toContain("PRIVATE_REQUEST_DETAILS");
  await webhook((operation.result as { webhookUrl: string }).webhookUrl);
  const replay = await sendSms(db, env, p, numberId, input, "send");
  expect(replay.body.status).toBe("completed");
  expect(replay.body.failure).toBeUndefined();
});

it("recovers a saved provider acceptance after a failed local confirmation without resending", async () => {
  let transactions = 0;
  const interrupted = new Proxy(db, {
    get(target, property) {
      if (property === "$transaction")
        return (...args: unknown[]) => {
          if (++transactions === 2)
            throw new Error("Simulated confirmation failure");
          return (target.$transaction as Function).apply(target, args);
        };
      return Reflect.get(target, property);
    },
  });
  fetcher.mockResolvedValueOnce(Response.json({ data: { id: "provider" } }));
  const sent = await sendSms(interrupted, env, p, numberId, input, "accepted");
  expect(sent.body.status).toBe("unknown");
  expect(sent.body.failure?.kind).toBe("confirmation_failed");
  expect((await reconcileSmsSends(db)).confirmed).toBe(0);
  await db.operation.update({
    where: { id: sent.body.id },
    data: { updatedAt: new Date(0) },
  });
  const runs = await Promise.all([
    reconcileSmsSends(db),
    reconcileSmsSends(db),
  ]);
  expect(runs.reduce((total, run) => total + run.confirmed, 0)).toBe(1);
  expect(
    (await db.operation.findUniqueOrThrow({ where: { id: sent.body.id } }))
      .status,
  ).toBe("completed");
  const message = await db.smsMessage.findFirstOrThrow();
  expect(message.providerId).toBe("provider");
  expect(message.status).toBe("queued");
  expect(await db.event.count({ where: { type: "sms.queued" } })).toBe(1);
  expect(
    (await sendSms(db, env, p, numberId, input, "accepted")).body.status,
  ).toBe("completed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("leaves timeouts unknown and refuses conflicting saved acceptance IDs", async () => {
  const { result } = await unknownSend();
  await db.operation.update({
    where: { id: result.body.id },
    data: { updatedAt: new Date(0) },
  });
  expect((await reconcileSmsSends(db)).confirmed).toBe(0);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: result.body.id },
  });
  expect(operation.status).toBe("unknown");
  await db.operation.update({
    where: { id: operation.id },
    data: {
      updatedAt: new Date(0),
      result: {
        providerMessageId: "conflicting",
        failure: { kind: "confirmation_failed" },
      },
    },
  });
  await db.smsMessage.update({
    where: { id: operation.resourceId! },
    data: { providerId: "original", status: "delivered" },
  });
  expect((await reconcileSmsSends(db)).confirmed).toBe(0);
  const saved = await db.smsMessage.findUniqueOrThrow({
    where: { id: operation.resourceId! },
  });
  expect(saved.providerId).toBe("original");
  expect(saved.status).toBe("delivered");
  expect(
    (
      await db.operation.findUniqueOrThrow({ where: { id: operation.id } })
    ).updatedAt.getTime(),
  ).toBeGreaterThan(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
