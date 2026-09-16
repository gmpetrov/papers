import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { sendSms } from "../src/sms";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const fetcher = vi.fn<typeof fetch>();
let p: Principal, numberId: string;
const env = { TELNYX_STATUS: "active", TELNYX_API_KEY: "test" };
const input = { to: "+12025550100", text: "Hello" };
beforeAll(async () => {
  vi.stubGlobal("fetch", fetcher);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: {
      id: "sms-send",
      name: "SMS",
      slug: "sms-send",
      createdAt: new Date(),
    },
  });
  const project = await db.project.create({
    data: { organizationId: "sms-send" },
  });
  const agent = await db.agent.create({
    data: {
      organizationId: "sms-send",
      projectId: project.id,
      name: "Sender",
      dailySmsLimit: 2,
    },
  });
  const number = await db.phoneNumber.create({
    data: {
      organizationId: "sms-send",
      agentId: agent.id,
      phoneNumber: "+12025550101",
      messagingProfileId: "profile",
      status: "active",
    },
  });
  numberId = number.id;
  p = {
    id: "credential",
    userId: "user",
    organizationId: "sms-send",
    agentId: agent.id,
    role: "agent",
    scopes: ["sms:send"],
  };
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
it("rejects review status, missing scopes, and member access without provider calls", async () => {
  await expect(
    sendSms(
      db,
      { ...env, TELNYX_STATUS: "under_review" },
      p,
      numberId,
      input,
      "review",
    ),
  ).rejects.toMatchObject({ code: "verification_required" });
  await expect(
    sendSms(db, env, { ...p, scopes: [] }, numberId, input, "scope"),
  ).rejects.toMatchObject({ code: "insufficient_scope" });
  await expect(
    sendSms(db, env, { ...p, role: "member" }, numberId, input, "member"),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await db.operation.count()).toBe(0);
});
it("sends once for concurrent requests and rejects a changed idempotent body", async () => {
  await db.organization.update({
    where: { id: p.organizationId },
    data: { dailySmsLimit: 0 },
  });
  await expect(
    sendSms(db, env, p, numberId, input, "workspace-paused"),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
  expect(await db.dailyUsage.count()).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  await db.organization.update({
    where: { id: p.organizationId },
    data: { dailySmsLimit: 100 },
  });
  fetcher.mockResolvedValueOnce(
    Response.json({ data: { id: "sent-provider" } }),
  );
  const responses = await Promise.all([
    sendSms(db, env, p, numberId, input, "same"),
    sendSms(db, env, p, numberId, input, "same"),
  ]);
  expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
    type: "SMS",
    messaging_profile_id: "profile",
    use_profile_webhooks: true,
  });
  await expect(
    sendSms(db, env, p, numberId, { ...input, text: "Changed" }, "same"),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect((await db.dailyUsage.findFirstOrThrow()).smsSends).toBe(1);
  expect((await db.workspaceEmailUsage.findFirstOrThrow()).smsSends).toBe(1);
  expect((await db.smsMessage.findFirstOrThrow()).providerId).toBe(
    "sent-provider",
  );
});
it("does not repeat an unknown provider outcome and enforces quota", async () => {
  fetcher.mockRejectedValueOnce(new Error("timeout"));
  const result = await sendSms(db, env, p, numberId, input, "timeout");
  expect(result.status).toBe(202);
  expect(result.body.status).toBe("unknown");
  const replay = await sendSms(db, env, p, numberId, input, "timeout");
  expect(replay.body.id).toBe(result.body.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    sendSms(db, env, p, numberId, input, "over-quota"),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("enforces agent binding and SMS recipient policy", async () => {
  await expect(
    sendSms(
      db,
      env,
      { ...p, agentId: "different" },
      numberId,
      input,
      "other-agent",
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  await db.agent.update({
    where: { id: p.agentId! },
    data: { allowedSmsRecipients: ["+12025550199"] },
  });
  await expect(
    sendSms(db, env, p, numberId, input, "not-allowed"),
  ).rejects.toMatchObject({ code: "recipient_not_allowed" });
});

it("records a definitive provider rejection without repeating it on retry", async () => {
  await db.agent.update({
    where: { id: p.agentId! },
    data: { dailySmsLimit: 3, allowedSmsRecipients: [] },
  });
  fetcher.mockResolvedValueOnce(
    Response.json({ errors: [{ code: "rejected" }] }, { status: 422 }),
  );
  const result = await sendSms(db, env, p, numberId, input, "rejected");
  expect(result.body.status).toBe("failed");
  expect(
    (
      await db.smsMessage.findUniqueOrThrow({
        where: { id: result.body.messageId! },
      })
    ).status,
  ).toBe("failed");
  expect((await sendSms(db, env, p, numberId, input, "rejected")).body.id).toBe(
    result.body.id,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
