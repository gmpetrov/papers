import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createDatabase } from "@agentinfra/db";
import { ingestTelnyx, processTelnyxEvents } from "../src/telnyx-webhooks";
import { sendSms } from "../src/sms";
import { assertSmsRecipientAllowed } from "../src/sms-opt-out";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const env = {
  TELNYX_STATUS: "active",
  TELNYX_API_KEY: "fixture",
  TELNYX_PUBLIC_KEY: Buffer.from(
    publicKey.export({ format: "jwk" }).x!,
    "base64url",
  ).toString("base64"),
};
const profile = "opt-out-test-profile";
const recipient = "+12025550100";
const p: Principal = {
  id: "key",
  userId: "owner",
  organizationId: "opt-org",
  role: "agent",
  scopes: ["sms:send"],
  credential: { kind: "key", id: "key" },
};
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "ProviderSmsOptOut" CASCADE',
  );
  await db.organization.create({
    data: {
      id: p.organizationId,
      name: "Opt out",
      slug: "opt-out",
      createdAt: new Date(),
      requireSmsApproval: true,
    },
  });
  for (const [id, phoneNumber] of [
    ["opt-number", "+12025550101"],
    ["opt-number-2", "+12025550102"],
  ])
    await db.phoneNumber.create({
      data: {
        id,
        phoneNumber,
        organizationId: p.organizationId,
        messagingProfileId: profile,
        status: "active",
      },
    });
});
afterAll(async () => {
  await db.providerSmsOptOut.deleteMany({
    where: { messagingProfileId: profile },
  });
  vi.unstubAllGlobals();
  await db.$disconnect();
});
async function deliver(
  id: string,
  action: unknown,
  time: string,
  overrides = {},
) {
  const body = JSON.stringify({
    data: {
      id,
      event_type: "message.received",
      occurred_at: time,
      payload: {
        id: `message-${id}`,
        direction: "inbound",
        type: "SMS",
        messaging_profile_id: profile,
        from: { phone_number: recipient },
        to: [{ phone_number: "+12025550101" }],
        text: "arbitrary custom keyword",
        autoresponse_type: action,
        ...overrides,
      },
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${body}`),
    privateKey,
  ).toString("base64");
  await ingestTelnyx(
    db,
    env,
    new Request("https://papers.test/api/webhooks/telnyx", {
      method: "POST",
      body,
      headers: {
        "telnyx-timestamp": timestamp,
        "telnyx-signature-ed25519": signature,
      },
    }),
  );
  await db.providerEvent.update({
    where: { id: `telnyx:${id}` },
    data: { availableAt: new Date(0) },
  });
  await processTelnyxEvents(db);
}
const state = () =>
  db.providerSmsOptOut.findUniqueOrThrow({
    where: {
      messagingProfileId_recipient: { messagingProfileId: profile, recipient },
    },
  });
it("persists signed profile opt-outs, blocks every sender before approval/quota/provider work, and orders opt-ins safely", async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  await deliver("stop", "STOP", "2026-09-16T12:00:00Z");
  expect((await state()).optedOut).toBe(true);
  for (const number of ["opt-number", "opt-number-2"])
    await expect(
      sendSms(db, env, p, number, { to: recipient, text: "Blocked" }, number),
    ).rejects.toMatchObject({ status: 403, code: "recipient_opted_out" });
  expect(await db.operation.count()).toBe(0);
  expect(await db.approval.count()).toBe(0);
  expect(await db.workspaceEmailUsage.count()).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
  await deliver("old-start", "START", "2026-09-16T11:59:59Z");
  await deliver("equal-start", "START", "2026-09-16T12:00:00Z");
  await deliver("help", "HELP", "2026-09-16T12:01:00Z", { text: "START" });
  await deliver("text-only", undefined, "2026-09-16T12:01:00Z", {
    text: "START",
  });
  expect((await state()).optedOut).toBe(true);
  await deliver("new-start", "START", "2026-09-16T12:02:00Z");
  expect((await state()).optedOut).toBe(false);
  await deliver("replayed-stop", "STOP", "2026-09-16T12:00:00Z");
  expect((await state()).optedOut).toBe(false);
  await db.$transaction((tx) =>
    assertSmsRecipientAllowed(tx, profile, recipient),
  );
  await deliver("equal-stop", "STOP", "2026-09-16T12:02:00Z");
  expect((await state()).optedOut).toBe(true);
  await db.$transaction((tx) =>
    assertSmsRecipientAllowed(tx, "different-profile", recipient),
  );
  await db.$transaction((tx) =>
    assertSmsRecipientAllowed(tx, profile, "+12025550199"),
  );
});
it("ignores opt-out metadata on unmatched or outbound messages", async () => {
  await deliver("wrong-profile", "STOP", "2026-09-16T13:00:00Z", {
    messaging_profile_id: "unmatched-profile",
  });
  await deliver("outbound", "START", "2026-09-16T13:00:00Z", {
    direction: "outbound",
  });
  expect(await db.providerSmsOptOut.count()).toBe(1);
  expect((await state()).optedOut).toBe(true);
});

it("imports paginated blocks without undoing newer START callbacks; retries and partial failures are safe", async () => {
  const { TelnyxProvider } = await import("@agentinfra/providers");
  const { importSmsOptOuts } = await import("../src/sms-opt-out-import");
  const { recordSmsOptOut } = await import("../src/sms-opt-out");
  await db.$transaction((tx) =>
    recordSmsOptOut(
      tx,
      profile,
      recipient,
      "START",
      new Date("2026-09-16T14:00:00Z"),
      "new-start",
    ),
  );
  const old = {
    messaging_profile_id: profile,
    to: recipient,
    created_at: "2026-09-16 12:00:00.631252+00:00",
  };
  const fresh = {
    messaging_profile_id: profile,
    to: "+12025550199",
    created_at: "2026-09-16 13:00:00.000000+00:00",
  };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v2/messaging_optouts");
    expect(url.searchParams.get("filter[messaging_profile_id]")).toBe(profile);
    expect(url.searchParams.get("redaction_enabled")).toBe("false");
    const page = Number(url.searchParams.get("page[number]"));
    return Response.json({
      data: page === 1 ? [old] : [fresh],
      meta: { page_number: page, total_pages: 2 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const provider = new TelnyxProvider("fixture", "active");
  expect(await importSmsOptOuts(db, provider, profile)).toEqual({
    pages: 2,
    records: 2,
    updated: 1,
    complete: true,
  });
  expect((await state()).optedOut).toBe(false);
  await expect(
    db.$transaction((tx) => assertSmsRecipientAllowed(tx, profile, fresh.to)),
  ).rejects.toMatchObject({ code: "recipient_opted_out" });
  expect((await importSmsOptOuts(db, provider, profile)).updated).toBe(0);
  expect((await importSmsOptOuts(db, provider, profile, 1)).complete).toBe(
    false,
  );
  fetcher
    .mockResolvedValueOnce(
      Response.json({
        data: [{ ...fresh, to: "+12025550198" }],
        meta: { page_number: 1, total_pages: 2 },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ errors: [{ code: "rate_limit" }] }, { status: 429 }),
    );
  await expect(importSmsOptOuts(db, provider, profile)).rejects.toThrow();
  await expect(
    db.$transaction((tx) =>
      assertSmsRecipientAllowed(tx, profile, "+12025550198"),
    ),
  ).rejects.toMatchObject({ code: "recipient_opted_out" });
  for (const bad of [
    { ...fresh, to: "REDACTED" },
    { ...fresh, messaging_profile_id: "other-profile" },
    { ...fresh, created_at: "invalid" },
  ]) {
    fetcher.mockResolvedValueOnce(
      Response.json({ data: [bad], meta: { page_number: 1, total_pages: 1 } }),
    );
    await expect(importSmsOptOuts(db, provider, profile)).rejects.toThrow();
  }
});
