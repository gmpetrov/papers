import type { Prisma } from "@agentinfra/db";
import type { Principal } from "./principal";
import { assert } from "./errors";

/** Reserve under the workspace transaction lock, after approval and before provider calls.
 * The surrounding transaction also reserves workspace usage and creates the operation.
 */
export async function reserveCredentialUsage(
  tx: Prisma.TransactionClient,
  p: Principal,
  channel: "email" | "sms" | "inbox" | "number",
  day: string,
) {
  const fields = {
    email: ["dailyEmailLimit", "emailSends"],
    sms: ["dailySmsLimit", "smsSends"],
    inbox: ["dailyInboxLimit", "inboxCreations"],
    number: ["dailyNumberLimit", "numberPurchases"],
  } as const;
  const [limitField, usageField] = fields[channel];
  if (p.credential?.kind === "oauth") {
    assert(p.oauthConsentId, 401, "unauthorized", "Connection is unavailable");
    const consent = await tx.oauthConsent.findFirst({
      where: {
        id: p.oauthConsentId,
        userId: p.userId,
        referenceId: p.organizationId,
      },
    });
    assert(consent, 401, "unauthorized", "Connection is no longer active");
    const usage = await tx.oAuthDailyUsage.upsert({
      where: { consentId_day: { consentId: consent.id, day } },
      create: { consentId: consent.id, day },
      update: {},
    });
    const limit = consent[limitField];
    const used = usage[usageField];
    assert(
      limit === null || used < limit,
      429,
      "quota_exceeded",
      `Connection daily ${channel} limit reached`,
    );
    await tx.oAuthDailyUsage.update({
      where: { id: usage.id },
      data: { [usageField]: { increment: 1 } },
    });
    return;
  }
  if (p.credential?.kind !== "key") return;
  const key = await tx.apiKey.findFirst({
    where: {
      id: p.credential.id,
      organizationId: p.organizationId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  assert(key, 401, "unauthorized", "API key is no longer active");
  const usage = await tx.apiKeyDailyUsage.upsert({
    where: { apiKeyId_day: { apiKeyId: key.id, day } },
    create: { apiKeyId: key.id, day },
    update: {},
  });
  const limit = key[limitField];
  const used = usage[usageField];
  assert(
    limit === null || used < limit,
    429,
    "quota_exceeded",
    `API key daily ${channel} limit reached`,
  );
  await tx.apiKeyDailyUsage.update({
    where: { id: usage.id },
    data: { [usageField]: { increment: 1 } },
  });
}

export const reserveCredentialSend = reserveCredentialUsage;
