import type { Database } from "@agentinfra/db";
import { TelnyxProvider } from "@agentinfra/providers";
import { recordSmsOptOut } from "./sms-opt-out";

/** One profile page per cycle, with shared durable claims across worker instances. */
export async function reconcileSmsOptOuts(
  db: Database,
  env: { TELNYX_STATUS?: string; TELNYX_API_KEY?: string },
) {
  if (env.TELNYX_STATUS !== "active" || !env.TELNYX_API_KEY)
    return { processed: 0 };
  await db.$executeRaw`
    INSERT INTO "ProviderSmsOptOutSync" ("messagingProfileId")
    SELECT DISTINCT "messagingProfileId" FROM "PhoneNumber" WHERE status = 'active'
    ON CONFLICT DO NOTHING`;
  const token = crypto.randomUUID();
  const rows = await db.$queryRaw<
    Array<{ messagingProfileId: string; nextPage: number }>
  >`
    UPDATE "ProviderSmsOptOutSync" SET "leaseToken" = ${token},
      "leaseExpiresAt" = NOW() + INTERVAL '60 seconds'
    WHERE "messagingProfileId" IN (
      SELECT s."messagingProfileId" FROM "ProviderSmsOptOutSync" s
      WHERE s."availableAt" <= NOW()
        AND (s."leaseExpiresAt" IS NULL OR s."leaseExpiresAt" <= NOW())
        AND EXISTS (SELECT 1 FROM "PhoneNumber" n WHERE n."messagingProfileId" = s."messagingProfileId" AND n.status = 'active')
      ORDER BY s."availableAt", s."messagingProfileId"
      LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING "messagingProfileId", "nextPage"`;
  const claim = rows[0];
  if (!claim) return { processed: 0 };
  const where = {
    messagingProfileId: claim.messagingProfileId,
    leaseToken: token,
  };
  try {
    const page = await new TelnyxProvider(
      env.TELNYX_API_KEY,
      env.TELNYX_STATUS,
    ).listOptOuts(claim.messagingProfileId, claim.nextPage);
    const complete = claim.nextPage >= page.meta.total_pages;
    const changed = await db.$transaction(async (tx) => {
      // Updating the claim first fences late workers and keeps imported rows and
      // progress atomic. Any failed row rolls back the entire page/checkpoint.
      const fence = await tx.providerSmsOptOutSync.updateMany({
        where,
        data: {
          nextPage: complete ? 1 : claim.nextPage + 1,
          availableAt: new Date(Date.now() + (complete ? 15 * 60000 : 0)),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
          ...(complete ? { lastCompletedAt: new Date() } : {}),
        },
      });
      if (!fence.count) return false;
      for (const row of [...page.data].sort((a, b) =>
        a.to.localeCompare(b.to),
      )) {
        await recordSmsOptOut(
          tx,
          claim.messagingProfileId,
          row.to,
          "STOP",
          row.created_at,
          `telnyx-opt-out-import:${row.created_at.toISOString()}`,
        );
      }
      return true;
    });
    return { processed: changed ? 1 : 0 };
  } catch {
    await db.providerSmsOptOutSync.updateMany({
      where,
      data: {
        availableAt: new Date(Date.now() + 5 * 60000),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: "provider_import_failed",
      },
    });
    throw new Error("SMS opt-out import failed");
  }
}
