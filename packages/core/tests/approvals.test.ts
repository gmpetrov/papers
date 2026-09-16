import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { sendSms } from "../src/sms";
import { decideApproval, listApprovals } from "../src/approvals";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const env = { TELNYX_STATUS: "active", TELNYX_API_KEY: "fixture" };
const requester: Principal = {
  id: "key",
  userId: "owner",
  organizationId: "org",
  role: "agent",
  scopes: ["sms:send"],
  credential: { kind: "key", id: "key" },
};
const owner: Principal = {
  ...requester,
  id: "owner",
  role: "owner",
  credential: { kind: "session", id: "session" },
};
const input = { to: "+12025550100", text: "Approval fixture" };
const fetcher = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockResolvedValue(Response.json({ data: { id: "provider" } }));
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: {
      id: "org",
      name: "Org",
      slug: "org",
      createdAt: new Date(),
      requireSmsApproval: true,
    },
  });
  await db.apiKey.create({
    data: {
      id: "key",
      organizationId: "org",
      createdBy: "owner",
      name: "Fixture",
      prefix: "fixture",
      hash: "fixture-hash",
      scopes: ["sms:send"],
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await db.phoneNumber.create({
    data: {
      id: "number",
      organizationId: "org",
      phoneNumber: "+12025550101",
      messagingProfileId: "profile",
      status: "active",
    },
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
});
async function pending(key = "send") {
  await expect(
    sendSms(db, env, requester, "number", input, key),
  ).rejects.toMatchObject({
    code: "approval_required",
    details: { approvalId: expect.any(String) },
  });
  return db.approval.findFirstOrThrow({
    where: { key },
    orderBy: { createdAt: "desc" },
  });
}
it("commits one pending request without quota/provider effects; approved concurrent retries execute once", async () => {
  const approval = await pending();
  await pending();
  expect(await db.approval.count()).toBe(1);
  expect(await db.operation.count()).toBe(0);
  expect(await db.workspaceEmailUsage.count()).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    sendSms(
      db,
      env,
      requester,
      "number",
      { ...input, text: "changed" },
      "send",
    ),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  await decideApproval(db, owner, approval.id, "approved");
  const results = await Promise.all([
    sendSms(db, env, requester, "number", input, "send"),
    sendSms(db, env, requester, "number", input, "send"),
  ]);
  expect(results[0].body.id).toBe(results[1].body.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await db.operation.count()).toBe(1);
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id: approval.id } }))
      .status,
  ).toBe("consumed");
  expect((await db.workspaceEmailUsage.findFirstOrThrow()).smsSends).toBe(1);
});
it("rejects agent self-approval, impersonation, member decisions, and cross-tenant decisions", async () => {
  const approval = await pending();
  for (const actor of [
    requester,
    { ...owner, impersonatedBy: "support" },
    { ...owner, role: "member" },
    { ...owner, credential: { kind: "oauth", id: "oauth" } },
  ] as Principal[])
    await expect(
      decideApproval(db, actor, approval.id, "approved"),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    decideApproval(
      db,
      { ...owner, organizationId: "other" },
      approval.id,
      "approved",
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await listApprovals(db, { ...requester, id: "different-key" })).data,
  ).toEqual([]);
  expect((await listApprovals(db, owner)).data).toHaveLength(1);
});
it("denials and expiry prevent execution; a changed policy requires a new decision", async () => {
  const denied = await pending();
  await decideApproval(db, owner, denied.id, "denied");
  await expect(
    sendSms(db, env, requester, "number", input, "send"),
  ).rejects.toMatchObject({ code: "approval_denied" });
  const expired = await pending("expired");
  await db.approval.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    decideApproval(db, owner, expired.id, "approved"),
  ).rejects.toMatchObject({ code: "approval_expired" });
  await expect(
    sendSms(db, env, requester, "number", input, "expired"),
  ).rejects.toMatchObject({ code: "approval_expired" });
  const changed = await pending("changed");
  await db.organization.update({
    where: { id: "org" },
    data: { policyVersion: { increment: 1 } },
  });
  await expect(
    decideApproval(db, owner, changed.id, "approved"),
  ).rejects.toMatchObject({ code: "policy_changed" });
  const replacement = await pending("changed");
  expect(replacement.id).not.toBe(changed.id);
  expect(fetcher).not.toHaveBeenCalled();
});
it("approval cannot bypass execution-time quotas and rolls back consumption on refusal", async () => {
  const approval = await pending();
  await decideApproval(db, owner, approval.id, "approved");
  await db.organization.update({
    where: { id: "org" },
    data: { dailySmsLimit: 0 },
  });
  await expect(
    sendSms(db, env, requester, "number", input, "send"),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
  expect(
    (await db.approval.findUniqueOrThrow({ where: { id: approval.id } }))
      .status,
  ).toBe("approved");
  expect(fetcher).not.toHaveBeenCalled();
});

it("pages tied timestamps without gaps and rejects cursors outside the viewer's scope", async () => {
  const createdAt = new Date("2026-09-16T00:00:00Z");
  await db.approval.createMany({
    data: Array.from({ length: 103 }, (_, i) => ({
      id: `approval-${String(i).padStart(3, "0")}`,
      organizationId: "org",
      principalId: "key",
      route: "sms",
      key: `page-${i}`,
      requestHash: "hash",
      parameters: input,
      resourceId: "number",
      policyVersion: 1,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt,
    })),
  });
  const first = await listApprovals(db, requester, { limit: 100 });
  expect(first.data).toHaveLength(100);
  expect(first.nextCursor).toBe("approval-003");
  const second = await listApprovals(db, requester, {
    cursor: first.nextCursor,
    limit: 100,
  });
  expect(second.data.map((row) => row.id)).toEqual([
    "approval-002",
    "approval-001",
    "approval-000",
  ]);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set([...first.data, ...second.data].map((row) => row.id)).size,
  ).toBe(103);
  await expect(
    listApprovals(
      db,
      { ...requester, id: "other-key" },
      { cursor: first.nextCursor },
    ),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
  await db.organization.create({
    data: { id: "other-org", name: "Other", slug: "other", createdAt },
  });
  await expect(
    listApprovals(
      db,
      { ...owner, organizationId: "other-org" },
      { cursor: first.nextCursor },
    ),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(listApprovals(db, owner, { limit: 101 })).rejects.toThrow();
  expect((await listApprovals(db, owner)).data).toHaveLength(25);
});
