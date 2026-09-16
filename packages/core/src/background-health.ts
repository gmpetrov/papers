import type { Database } from "@agentinfra/db";

const categories = [
  "provider_pending",
  "provider_expired_lease",
  "provider_dead_letter",
  "webhook_pending",
  "webhook_expired_lease",
  "webhook_failed",
  "number_reconciliation",
  "number_requirements",
  "unknown_operations",
  "attachment_pending",
  "attachment_failed",
  "opt_out_sync_failed",
] as const;
type Category = (typeof categories)[number];

/** Operator-only database diagnostic. Never expose through a tenant/public route.
 * No payloads, identifiers, addresses, exceptions, URLs, or secrets are selected.
 */
export async function getBackgroundHealth(
  db: Database,
  staleAfterSeconds = 900,
) {
  if (
    !Number.isInteger(staleAfterSeconds) ||
    staleAfterSeconds < 60 ||
    staleAfterSeconds > 86400
  )
    throw new Error("The stale threshold must be 60–86400 seconds");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [clock] = await tx.$queryRaw<
        { observedAt: Date }[]
      >`SELECT CURRENT_TIMESTAMP AS "observedAt"`;
      const rows = await tx.$queryRaw<
        {
          category: Category;
          count: number;
          oldestAt: Date | null;
          attention: number;
        }[]
      >`
      WITH observations AS (
        SELECT 'provider_pending' AS category, "availableAt" AS since, false AS urgent
          FROM "ProviderEvent" WHERE status='pending' AND "availableAt" <= CURRENT_TIMESTAMP
        UNION ALL SELECT 'provider_expired_lease', coalesce("lockedAt", "createdAt"), true
          FROM "ProviderEvent" WHERE status='processing' AND ("lockedAt" IS NULL OR "lockedAt" < CURRENT_TIMESTAMP - interval '5 minutes')
        UNION ALL SELECT 'provider_dead_letter', "createdAt", true FROM "ProviderEvent" WHERE status='dead_letter'
        UNION ALL SELECT 'webhook_pending', "availableAt", false
          FROM "WebhookDelivery" WHERE status='pending' AND "availableAt" <= CURRENT_TIMESTAMP
        UNION ALL SELECT 'webhook_expired_lease', coalesce("leaseExpiresAt", "createdAt"), true
          FROM "WebhookDelivery" WHERE status='processing' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        UNION ALL SELECT 'webhook_failed', "createdAt", true FROM "WebhookDelivery" WHERE status='failed'
        UNION ALL SELECT 'number_reconciliation', "nextReconcileAt", false
          FROM "PhoneNumber" WHERE status IN ('pending','unknown','releasing') AND "nextReconcileAt" <= CURRENT_TIMESTAMP
        UNION ALL SELECT 'number_requirements', "createdAt", true FROM "PhoneNumber" WHERE status='awaiting_requirements'
        UNION ALL SELECT 'unknown_operations', "createdAt", false FROM "Operation" WHERE status='unknown'
        UNION ALL SELECT 'attachment_pending', "nextStorageAttemptAt", false
          FROM "Attachment" WHERE "objectKey" IS NULL AND "storageAttempts" < 8 AND "nextStorageAttemptAt" <= CURRENT_TIMESTAMP
        UNION ALL SELECT 'attachment_failed', "nextStorageAttemptAt", true
          FROM "Attachment" WHERE "objectKey" IS NULL AND "storageAttempts" >= 8
        UNION ALL SELECT 'opt_out_sync_failed', "availableAt", true
          FROM "ProviderSmsOptOutSync" WHERE "lastError" IS NOT NULL AND "availableAt" <= CURRENT_TIMESTAMP
      )
      SELECT category, count(*)::int AS count, min(since) AS "oldestAt",
        count(*) FILTER (WHERE urgent OR since <= CURRENT_TIMESTAMP - ${staleAfterSeconds} * interval '1 second')::int AS attention
      FROM observations GROUP BY category
    `;
      const observedAt = clock!.observedAt;
      const metrics = categories.map((category) => {
        const row = rows.find((row) => row.category === category);
        return {
          category,
          count: row?.count ?? 0,
          needsAttention: row?.attention ?? 0,
          oldestAgeSeconds: row?.oldestAt
            ? Math.max(0, Math.floor((+observedAt - +row.oldestAt) / 1000))
            : null,
        };
      });
      return {
        observedAt: observedAt.toISOString(),
        staleAfterSeconds,
        needsAttention: metrics.some((metric) => metric.needsAttention > 0),
        metrics,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
