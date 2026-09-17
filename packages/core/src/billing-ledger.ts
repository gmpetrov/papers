import type { Database, Prisma } from "@agentinfra/db";
import { planFor } from "@agentinfra/contracts";
import { assert } from "./errors";

export const USD = 1_000_000n;
export function usdMicros(value: string): bigint {
  assert(
    /^\d{1,10}(\.\d{1,10})?$/.test(value),
    400,
    "invalid_amount",
    "Invalid USD amount",
  );
  const [whole, fraction = ""] = value.split(".");
  // Round provider charges upward to a micro-dollar, never through a float.
  return (
    BigInt(whole!) * USD +
    BigInt((fraction + "000000").slice(0, 6)) +
    (/[1-9]/.test(fraction.slice(6)) ? 1n : 0n)
  );
}
export async function billingLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + organizationId}))`;
}
export async function ensureBilling(db: Database, organizationId: string) {
  return db.billingAccount.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}
export function effectivePlan(account: {
  plan: string;
  status: string;
  periodEnd: Date | null;
}) {
  return planFor(
    account.status === "active" &&
      account.periodEnd &&
      account.periodEnd > new Date()
      ? account.plan
      : "free",
  );
}
export async function receivingReserve(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const numbers = await tx.phoneNumber.count({
    where: { organizationId, status: { notIn: ["failed", "released"] } },
  });
  return BigInt(numbers) * 2n * USD;
}
/** Must hold billingLock. Idempotent entries and balances commit together. */
export async function ledgerEntry(
  tx: Prisma.TransactionClient,
  entry: {
    organizationId: string;
    key: string;
    kind: string;
    amountMicros: bigint;
    description: string;
    resourceId?: string;
  },
) {
  if (await tx.billingLedger.findUnique({ where: { key: entry.key } }))
    return false;
  await tx.billingLedger.create({ data: entry });
  await tx.billingAccount.update({
    where: { organizationId: entry.organizationId },
    data: { balanceMicros: { increment: entry.amountMicros } },
  });
  return true;
}
const gsm = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const extended = new Set(Array.from("^{}\\[~]|€\f"));
export function smsSegments(text: string) {
  let length = 0;
  for (const char of text) {
    if (gsm.has(char)) length++;
    else if (extended.has(char)) length += 2;
    else
      return Math.max(1, text.length <= 70 ? 1 : Math.ceil(text.length / 67));
  }
  return Math.max(1, length <= 160 ? 1 : Math.ceil(length / 153));
}
export async function reserveSms(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
  to: string,
  text: string,
) {
  await billingLock(tx, organizationId);
  const account = await tx.billingAccount.findUnique({
    where: { organizationId },
  });
  if (!account) return; // Legacy development workspaces; production middleware always creates an account.
  assert(
    !account.blocked && effectivePlan(account).numbers > 0,
    402,
    "subscription_required",
    "An active paid plan is required for SMS",
  );
  const rates = await tx.smsRate.findMany({
    where: { expiresAt: { gt: new Date() } },
  });
  const rate = rates
    .filter((r) => to.startsWith(r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  assert(
    rate && rate.maxProviderMicrosPerSegment > 0n,
    503,
    "sms_rate_unavailable",
    "This destination has no verified rate ceiling; sending is disabled",
  );
  const amount =
    rate.maxProviderMicrosPerSegment * 2n * BigInt(smsSegments(text));
  assert(
    account.balanceMicros - account.reservedMicros >= amount,
    402,
    "insufficient_balance",
    "Top up your messaging balance before sending",
  );
  await tx.billingReservation.create({
    data: { id: messageId, organizationId, amountMicros: amount },
  });
  await tx.billingAccount.update({
    where: { organizationId },
    data: { reservedMicros: { increment: amount } },
  });
}
export async function releaseSmsReservation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
) {
  await billingLock(tx, organizationId);
  const reservation = await tx.billingReservation.findUnique({
    where: { id: messageId },
  });
  if (!reservation || reservation.status !== "reserved") return;
  await tx.billingAccount.update({
    where: { organizationId },
    data: { reservedMicros: { decrement: reservation.amountMicros } },
  });
  await tx.billingReservation.update({
    where: { id: messageId },
    data: { status: "released" },
  });
}
/** Revisions create delta ledger entries, surviving deletions and duplicate/late callbacks. */
export async function settleSms(
  tx: Prisma.TransactionClient,
  messageId: string,
) {
  const message = await tx.smsMessage.findUniqueOrThrow({
    where: { id: messageId },
  });
  await billingLock(tx, message.organizationId);
  const account = await tx.billingAccount.findUnique({
    where: { organizationId: message.organizationId },
  });
  if (!account) return;
  if (message.costAmount === null || !message.costOccurredAt) {
    if (
      message.direction === "inbound" &&
      !(await tx.billingReservation.findUnique({ where: { id: messageId } }))
    ) {
      // Inbound charges already happened. Unknown prices freeze outgoing usage until reconciliation.
      await tx.billingAccount.update({
        where: { organizationId: message.organizationId },
        data: { blocked: true },
      });
    }
    return;
  }
  if (message.costCurrency !== "USD") {
    await tx.billingAccount.update({
      where: { organizationId: message.organizationId },
      data: { blocked: true },
    });
    return; // No silent currency conversion; operator reconciliation required.
  }
  const old = await tx.billingReservation.findUnique({
    where: { id: messageId },
  });
  if (old?.occurredAt && old.occurredAt >= message.costOccurredAt) return;
  let charge = usdMicros(message.costAmount.toFixed(10)) * 2n;
  const previous = old?.settledMicros ?? 0n;
  // Papers absorbs incoming costs beyond prepaid funds, including deliveries
  // already in flight when messaging is paused. Never consume outgoing holds.
  if (message.direction === "inbound") {
    const available = account.balanceMicros - account.reservedMicros;
    const ceiling = previous + (available > 0n ? available : 0n);
    if (charge > ceiling) charge = ceiling;
  }
  const changed = await ledgerEntry(tx, {
    organizationId: message.organizationId,
    key: `sms:${messageId}:${message.costOccurredAt.toISOString()}`,
    kind: "sms",
    amountMicros: previous - charge,
    resourceId: messageId,
    description: `${message.direction} SMS (${message.segments ?? "unknown"} segments)`,
  });
  if (!changed) return;
  if (old?.status === "reserved")
    await tx.billingAccount.update({
      where: { organizationId: message.organizationId },
      data: { reservedMicros: { decrement: old.amountMicros } },
    });
  await tx.billingReservation.upsert({
    where: { id: messageId },
    create: {
      id: messageId,
      organizationId: message.organizationId,
      amountMicros: 0n,
      settledMicros: charge,
      occurredAt: message.costOccurredAt,
      status: "settled",
    },
    update: {
      status: "settled",
      settledMicros: charge,
      occurredAt: message.costOccurredAt,
    },
  });
  if (old && charge > old.amountMicros && message.direction === "outbound") {
    await tx.billingAccount.update({
      where: { organizationId: message.organizationId },
      data: { blocked: true },
    });
  }
}
export function billingPeriod(account: {
  status: string;
  periodStart: Date;
  periodEnd: Date | null;
}) {
  return account.status === "active" &&
    account.periodEnd &&
    account.periodEnd > new Date()
    ? account.periodStart.toISOString()
    : new Date().toISOString().slice(0, 7);
}
export async function reserveEmail(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
  units: number,
  inbound = false,
) {
  await billingLock(tx, organizationId);
  const account = await tx.billingAccount.findUnique({
    where: { organizationId },
  });
  if (!account) return;
  if (!inbound)
    assert(
      !account.blocked,
      402,
      "billing_blocked",
      "Billing is paused pending payment reconciliation",
    );
  const period = billingPeriod(account);
  const usage = await tx.billingEmailUsage.aggregate({
    where: { organizationId, period, status: { not: "released" } },
    _sum: { units: true },
  });
  const excess =
    Math.max(
      0,
      (usage._sum.units ?? 0) + units - effectivePlan(account).emails,
    ) - Math.max(0, (usage._sum.units ?? 0) - effectivePlan(account).emails);
  // Explicit prepaid overages for paid workspaces; no end-of-month exposure.
  if (excess > 0) {
    const amount = BigInt(excess) * 2000n;
    if (!inbound)
      assert(
        !account.blocked &&
          effectivePlan(account).monthlyCents > 0 &&
          account.balanceMicros - account.reservedMicros >= amount,
        402,
        "email_allowance_exceeded",
        "Email allowance exhausted; upgrade or add prepaid usage credit",
      );
    if (
      inbound &&
      (effectivePlan(account).monthlyCents === 0 ||
        account.balanceMicros - account.reservedMicros < amount)
    )
      return false;
    await ledgerEntry(tx, {
      organizationId,
      key: `email:${messageId}`,
      kind: "email_overage",
      amountMicros: -amount,
      resourceId: messageId,
      description: `${excess} additional email recipients`,
    });
  }
  await tx.billingEmailUsage.create({
    data: {
      id: messageId,
      organizationId,
      period,
      units,
      status: inbound ? "settled" : "reserved",
    },
  });
  return true;
}
export async function releaseEmail(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
) {
  await billingLock(tx, organizationId);
  const usage = await tx.billingEmailUsage.findUnique({
    where: { id: messageId },
  });
  if (!usage || usage.status !== "reserved") return;
  await tx.billingEmailUsage.update({
    where: { id: messageId },
    data: { status: "released" },
  });
  const charge = await tx.billingLedger.findUnique({
    where: { key: `email:${messageId}` },
  });
  if (charge)
    await ledgerEntry(tx, {
      organizationId,
      key: `email_refund:${messageId}`,
      kind: "email_refund",
      amountMicros: -charge.amountMicros,
      description: "Rejected email credit restored",
      resourceId: messageId,
    });
}
