import { sendSms } from "../src/sms";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import {
  billingLock,
  ensureBilling,
  ledgerEntry,
  reserveSms,
  releaseSmsReservation,
  settleSms,
  smsSegments,
  usdMicros,
  reserveEmail,
  releaseEmail,
  USD,
} from "../src/billing-ledger";
import { billingOwner, ingestStripe } from "../src/stripe-billing";
import { assertInboxCapacity } from "../src/inbox-limits";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const org = "billing-test";
let phone: string;
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "SmsRate" CASCADE',
  );
  await db.organization.create({
    data: {
      id: org,
      name: "Billing",
      slug: org,
      createdAt: new Date(),
      maxInboxes: 1000,
    },
  });
  await ensureBilling(db, org);
  await db.billingAccount.update({
    where: { organizationId: org },
    data: {
      plan: "developer",
      status: "active",
      periodEnd: new Date(Date.now() + 86400000),
      balanceMicros: USD,
    },
  });
  phone = (
    await db.phoneNumber.create({
      data: {
        organizationId: org,
        phoneNumber: "+12025550101",
        messagingProfileId: "profile",
        status: "active",
      },
    })
  ).id;
  await db.smsRate.create({
    data: {
      prefix: "+1202",
      maxProviderMicrosPerSegment: 500000n,
      expiresAt: new Date(Date.now() + 86400000),
      note: "Test rate",
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
});
it("counts GSM extension characters and UTF-16 surrogate pairs", () => {
  expect(smsSegments("a".repeat(160))).toBe(1);
  expect(smsSegments("a".repeat(161))).toBe(2);
  expect(smsSegments("^".repeat(81))).toBe(2);
  expect(smsSegments("😀".repeat(36))).toBe(2);
  expect(usdMicros("0.0085000001")).toBe(8501n);
});
it("reserves atomically across concurrent sends without withholding a customer receiving buffer", async () => {
  const results = await Promise.allSettled(
    ["a", "b", "c"].map((id) =>
      db.$transaction((tx) => reserveSms(tx, org, id, "+12025550100", "Hello")),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).reservedMicros,
  ).toBe(USD);
  expect(await db.billingReservation.count()).toBe(1);
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { balanceMicros: { increment: 2n * USD } },
  });
});
it("rejects unpriced routes without any charge", async () => {
  await expect(
    db.$transaction((tx) =>
      reserveSms(tx, org, "unpriced", "+33612345678", "Hello"),
    ),
  ).rejects.toMatchObject({ code: "sms_rate_unavailable" });
  expect(
    await db.billingReservation.findUnique({ where: { id: "unpriced" } }),
  ).toBeNull();
});
it("releases a definitive rejection exactly once", async () => {
  const r = await db.billingReservation.findFirstOrThrow();
  await db.$transaction((tx) => releaseSmsReservation(tx, org, r.id));
  await db.$transaction((tx) => releaseSmsReservation(tx, org, r.id));
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).reservedMicros,
  ).toBe(0n);
});
it("credits the same successful payment once under concurrency", async () => {
  const input = {
    organizationId: org,
    key: "payment:pi-test",
    kind: "topup",
    amountMicros: 10n * USD,
    description: "Test credit",
  };
  await Promise.all(
    [1, 2, 3].map(() =>
      db.$transaction(async (tx) => {
        await billingLock(tx, org);
        await ledgerEntry(tx, input);
      }),
    ),
  );
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros,
  ).toBe(13n * USD);
});
it("settles at twice provider cost, handles corrections, and ignores duplicate callbacks", async () => {
  const m = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: phone,
      direction: "outbound",
      status: "delivered",
      from: "+12025550101",
      to: "+12025550100",
      text: "Hi",
      segments: 1,
      costAmount: "0.0085",
      costCurrency: "USD",
      costOccurredAt: new Date("2026-09-17T10:00:00Z"),
    },
  });
  await db.$transaction((tx) => reserveSms(tx, org, m.id, m.to, m.text));
  await db.$transaction((tx) => settleSms(tx, m.id));
  await db.$transaction((tx) => settleSms(tx, m.id));
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros,
  ).toBe(12983000n);
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).reservedMicros,
  ).toBe(0n);
  await db.smsMessage.update({
    where: { id: m.id },
    data: {
      costAmount: "0.009",
      costOccurredAt: new Date("2026-09-17T11:00:00Z"),
    },
  });
  await db.$transaction((tx) => settleSms(tx, m.id));
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).balanceMicros,
  ).toBe(12982000n);
  await db.smsMessage.delete({ where: { id: m.id } });
  expect(await db.billingLedger.count({ where: { resourceId: m.id } })).toBe(2);
});
it("does not treat missing cost as free or release its reservation", async () => {
  const m = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: phone,
      direction: "outbound",
      status: "queued",
      from: "+12025550101",
      to: "+12025550100",
      text: "Hi",
    },
  });
  await db.$transaction((tx) => reserveSms(tx, org, m.id, m.to, m.text));
  await db.$transaction((tx) => settleSms(tx, m.id));
  expect(
    (await db.billingReservation.findUniqueOrThrow({ where: { id: m.id } }))
      .status,
  ).toBe("reserved");
});
it("charges inbound messages once even without an outbound reservation", async () => {
  const m = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: phone,
      direction: "inbound",
      status: "received",
      from: "+12025550100",
      to: "+12025550101",
      text: "Hi",
      costAmount: "0.004",
      costCurrency: "USD",
      costOccurredAt: new Date(),
    },
  });
  await db.$transaction((tx) => settleSms(tx, m.id));
  await db.$transaction((tx) => settleSms(tx, m.id));
  expect(
    (await db.billingReservation.findUniqueOrThrow({ where: { id: m.id } }))
      .settledMicros,
  ).toBe(8000n);
});
it("enforces plan inbox ceilings independently of editable workspace policy", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { status: "free" },
  });
  await db.inbox.createMany({
    data: [1, 2, 3].map((n) => ({
      organizationId: org,
      name: `Inbox ${n}`,
      address: `billing-${n}@example.com`,
    })),
  });
  await expect(
    db.$transaction((tx) => assertInboxCapacity(tx, org)),
  ).rejects.toMatchObject({ code: "quota_exceeded" });
});
it("email quota uses a retained ledger, and rejected sends restore allowance", async () => {
  await db.$transaction((tx) => reserveEmail(tx, org, "emails-3000", 3000));
  await expect(
    db.$transaction((tx) => reserveEmail(tx, org, "email-over", 1)),
  ).rejects.toMatchObject({ code: "email_allowance_exceeded" });
  await db.$transaction((tx) => releaseEmail(tx, org, "emails-3000"));
  await db.$transaction((tx) => reserveEmail(tx, org, "email-after", 1));
  expect(await db.billingEmailUsage.count()).toBe(2);
});
it("denies billing mutations to agents, admins, and impersonated owners", () => {
  const owner = {
    role: "owner",
    credential: { kind: "session", id: "s" },
  } as Principal;
  expect(() => billingOwner(owner)).not.toThrow();
  expect(() => billingOwner({ ...owner, role: "admin" })).toThrow();
  expect(() =>
    billingOwner({ ...owner, credential: { kind: "key", id: "k" } }),
  ).toThrow();
  expect(() => billingOwner({ ...owner, impersonatedBy: "support" })).toThrow();
});
it("rejects unsigned Stripe events before persistence", async () => {
  await expect(
    ingestStripe(
      db,
      {
        STRIPE_SECRET_KEY: "sk_test_fake",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
      },
      new Request("https://example.com", {
        method: "POST",
        body: '{"type":"payment_intent.succeeded"}',
      }),
    ),
  ).rejects.toMatchObject({ code: "invalid_signature" });
  expect(await db.providerEvent.count({ where: { provider: "stripe" } })).toBe(
    0,
  );
});

it("free and past-due plans cannot spend prepaid SMS funds", async () => {
  await expect(
    db.$transaction((tx) =>
      reserveSms(tx, org, "free-sms", "+12025550100", "Hello"),
    ),
  ).rejects.toMatchObject({ code: "subscription_required" });
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { plan: "scale", status: "past_due", balanceMicros: 1000n * USD },
  });
  await expect(
    db.$transaction((tx) =>
      reserveSms(tx, org, "past-due-sms", "+12025550100", "Hello"),
    ),
  ).rejects.toMatchObject({ code: "subscription_required" });
});
it("unknown currency freezes spending without treating it as USD", async () => {
  const message = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: phone,
      direction: "inbound",
      status: "received",
      from: "+12025550100",
      to: "+12025550101",
      costAmount: "1.00",
      costCurrency: "EUR",
      costOccurredAt: new Date(),
    },
  });
  const before = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: org },
  });
  await db.$transaction((tx) => settleSms(tx, message.id));
  const after = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: org },
  });
  expect(after.blocked).toBe(true);
  expect(after.balanceMicros).toBe(before.balanceMicros);
});

it("the actual SMS API path refuses an unfunded send before calling Telnyx", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: {
      plan: "developer",
      status: "active",
      blocked: false,
      balanceMicros: 0n,
    },
  });
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Must not call provider"));
  try {
    await expect(
      sendSms(
        db,
        { TELNYX_STATUS: "active", TELNYX_API_KEY: "test" },
        {
          id: "test",
          userId: "test",
          organizationId: org,
          role: "owner",
          scopes: ["sms:send"],
        },
        phone,
        { to: "+12025550100", text: "No credit" },
        "unfunded-send",
      ),
    ).rejects.toMatchObject({ code: "insufficient_balance" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db.operation.count({ where: { key: "unfunded-send" } })).toBe(
      0,
    );
  } finally {
    fetcher.mockRestore();
  }
});

it("Papers absorbs incoming costs beyond available funds without consuming send reservations", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { balanceMicros: 500000n, reservedMicros: 400000n },
  });
  const message = await db.smsMessage.create({
    data: {
      organizationId: org,
      phoneNumberId: phone,
      direction: "inbound",
      status: "received",
      from: "+12025550100",
      to: "+12025550101",
      text: "Hello",
      costAmount: "0.2",
      costCurrency: "USD",
      costOccurredAt: new Date(),
      segments: 1,
    },
  });
  await db.$transaction((tx) => settleSms(tx, message.id));
  await db.$transaction((tx) => settleSms(tx, message.id));
  const account = await db.billingAccount.findUniqueOrThrow({
    where: { organizationId: org },
  });
  expect(account.balanceMicros).toBe(400000n);
  expect(account.reservedMicros).toBe(400000n);
  expect(
    (
      await db.billingReservation.findUniqueOrThrow({
        where: { id: message.id },
      })
    ).settledMicros,
  ).toBe(100000n);
});

it("the $0.50 welcome balance is available for SMS without a receiving deduction", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: { balanceMicros: 500000n, reservedMicros: 0n, blocked: false },
  });
  await db.smsRate.update({
    where: { prefix: "+1202" },
    data: { maxProviderMicrosPerSegment: 5000n },
  });
  await db.$transaction((tx) =>
    reserveSms(tx, org, "welcome-send", "+12025550100", "Hello"),
  );
  expect(
    (
      await db.billingAccount.findUniqueOrThrow({
        where: { organizationId: org },
      })
    ).reservedMicros,
  ).toBe(10000n);
});

it("requires a separate MMS ceiling and reserves it once per MMS, not per text segment", async () => {
  await db.billingAccount.update({
    where: { organizationId: org },
    data: {
      plan: "developer",
      status: "active",
      blocked: false,
      periodEnd: new Date(Date.now() + 86400000),
      balanceMicros: 100n * USD,
    },
  });
  await db.smsRate.update({
    where: { prefix: "+1202" },
    data: {
      maxProviderMicrosPerMms: null,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await expect(
    db.$transaction((tx) =>
      reserveSms(tx, org, "mms-no-rate", "+12025550100", "Hello", true),
    ),
  ).rejects.toMatchObject({ code: "sms_rate_unavailable" });
  expect(
    await db.billingReservation.findUnique({ where: { id: "mms-no-rate" } }),
  ).toBeNull();
  await db.smsRate.update({
    where: { prefix: "+1202" },
    data: { maxProviderMicrosPerMms: 100_000n },
  });
  await db.$transaction((tx) =>
    reserveSms(tx, org, "mms-priced", "+12025550100", "x".repeat(1000), true),
  );
  expect(
    (
      await db.billingReservation.findUniqueOrThrow({
        where: { id: "mms-priced" },
      })
    ).amountMicros,
  ).toBe(200_000n);
});
