import { workspaceUsageSchema } from "../../contracts/src/responses";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { getWorkspaceUsage } from "../src/usage";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const owner: Principal = {
  id: "owner",
  userId: "owner",
  organizationId: "usage-org",
  role: "owner",
  scopes: [],
  credential: { kind: "session", id: "session" },
};
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  for (const id of ["usage-org", "other-org"]) {
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await db.phoneNumber.create({
      data: {
        id,
        organizationId: id,
        phoneNumber: id === "usage-org" ? "+12025550111" : "+12025550112",
        status: "active",
        messagingProfileId: "usage-fixture",
      },
    });
  }
  for (const [amount, currency, direction, date, organizationId] of [
    ["0.1", "USD", "outbound", "2026-09-01", "usage-org"],
    ["0.2", "USD", "outbound", "2026-09-30", "usage-org"],
    ["0", "EUR", "inbound", "2026-09-12", "usage-org"],
    [null, null, "outbound", "2026-09-13", "usage-org"],
    ["99", "USD", "outbound", "2026-10-01", "usage-org"],
    ["99", "USD", "outbound", "2026-08-31", "usage-org"],
    ["999", "USD", "outbound", "2026-09-10", "other-org"],
  ] as const) {
    const message = await db.smsMessage.create({
      data: {
        organizationId,
        phoneNumberId: organizationId,
        direction,
        status: "delivered",
        from: "+12025550111",
        to: "+12025550112",
        costAmount: amount,
        costCurrency: currency,
        segments: amount === null ? null : 2,
        createdAt: new Date(date + "T00:00:00Z"),
      },
    });
    if (amount && currency === "USD") {
      await db.billingAccount.upsert({
        where: { organizationId },
        create: { organizationId },
        update: {},
      });
      await db.billingReservation.create({
        data: {
          id: message.id,
          organizationId,
          amountMicros: 0n,
          settledMicros: BigInt(Math.round(Number(amount) * 2000000)),
          status: "settled",
        },
      });
    }
  }
});
afterAll(() => db.$disconnect());
it("reports only settled Papers charges with explicit missing coverage and UTC bounds", async () => {
  const data = await getWorkspaceUsage(db, owner, { month: "2026-09" });
  expect(workspaceUsageSchema.parse(data)).toEqual(data);
  expect(data.start).toBe("2026-09-01T00:00:00.000Z");
  expect(data.endExclusive).toBe("2026-10-01T00:00:00.000Z");
  expect(data.sms).toHaveLength(2);
  expect(data.sms.find((row) => row.direction === "outbound")).toMatchObject({
    messages: 3,
    chargedAmount: "0.600000",
    reportedSegments: 4,
    messagesWithCost: 2,
  });
  expect(data.sms.find((row) => row.direction === "inbound")).toMatchObject({
    messages: 1,
    chargedAmount: null,
    messagesWithCost: 0,
  });
  expect(JSON.stringify(data)).not.toContain("reportedProviderCost");
  expect(
    (await getWorkspaceUsage(db, owner, { month: "2026-07" })).sms,
  ).toEqual([]);
});
it("rejects unauthorized principals and invalid dates", async () => {
  for (const principal of [
    { ...owner, role: "member" },
    { ...owner, impersonatedBy: "support" },
    { ...owner, credential: { kind: "key", id: "key" } },
    { ...owner, credential: { kind: "oauth", id: "oauth" } },
  ] as Principal[]) {
    await expect(getWorkspaceUsage(db, principal, {})).rejects.toMatchObject({
      status: 403,
    });
  }
  for (const month of ["2026-13", "2026-00", "2026-9", "invalid"])
    await expect(getWorkspaceUsage(db, owner, { month })).rejects.toThrow();
});
