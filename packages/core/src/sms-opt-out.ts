import type { Prisma } from "@agentinfra/db";
import { assert } from "./errors";

async function lock(
  tx: Prisma.TransactionClient,
  profile: string,
  recipient: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sms-opt-out:${profile}:${recipient}`}))`;
}

/** Accept only verified provider evidence for a known messaging profile. */
export async function recordSmsOptOut(
  tx: Prisma.TransactionClient,
  profile: string,
  recipient: string,
  responseType: unknown,
  occurredAt: Date,
  eventId: string,
) {
  if (responseType !== "STOP" && responseType !== "START") return false;
  const optedOut = responseType === "STOP";
  await lock(tx, profile, recipient);
  const where = {
    messagingProfileId_recipient: { messagingProfileId: profile, recipient },
  };
  const previous = await tx.providerSmsOptOut.findUnique({ where });
  // STOP wins equal timestamps, regardless of arrival order. Only a strictly
  // newer START may clear it. Replays and old callbacks cannot revert state.
  if (
    previous &&
    (previous.occurredAt > occurredAt ||
      (+previous.occurredAt === +occurredAt &&
        (previous.optedOut || !optedOut)))
  )
    return false;
  const data = { optedOut, occurredAt, eventId };
  await tx.providerSmsOptOut.upsert({
    where,
    create: { messagingProfileId: profile, recipient, ...data },
    update: data,
  });
  return true;
}

export async function assertSmsRecipientAllowed(
  tx: Prisma.TransactionClient,
  profile: string,
  recipient: string,
) {
  await lock(tx, profile, recipient);
  const state = await tx.providerSmsOptOut.findUnique({
    where: {
      messagingProfileId_recipient: { messagingProfileId: profile, recipient },
    },
  });
  assert(
    !state?.optedOut,
    403,
    "recipient_opted_out",
    "The recipient has opted out of SMS for this messaging profile",
  );
}
