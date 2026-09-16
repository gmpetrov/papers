import type { Database, Prisma } from "@agentinfra/db";
import type { Principal } from "./principal";

export const REQUEST_LIMITS = { principal: 120, organization: 1200 } as const;

// PostgreSQL owns both the clock and atomic counters across all app instances.
// Reuse one row per principal; refresh tokens and browser sessions share a bucket.
async function consume(
  tx: Prisma.TransactionClient,
  organizationId: string,
  bucket: string,
  limit: number,
) {
  const [result] = await tx.$queryRaw<{ count: number; retryAfter: number }[]>`
    INSERT INTO "ApiRequestBucket" ("organizationId", bucket, "window", count)
    VALUES (${organizationId}, ${bucket}, floor(extract(epoch FROM CURRENT_TIMESTAMP) / 60)::bigint, 1)
    ON CONFLICT ("organizationId", bucket) DO UPDATE SET
      count = CASE WHEN "ApiRequestBucket"."window" >= EXCLUDED."window"
        THEN least("ApiRequestBucket".count + 1, ${limit + 1}) ELSE 1 END,
      "window" = greatest("ApiRequestBucket"."window", EXCLUDED."window")
    RETURNING count,
      greatest(1, ceil(60 - mod(extract(epoch FROM CURRENT_TIMESTAMP), 60)))::int AS "retryAfter"
  `;
  return { allowed: result!.count <= limit, retryAfter: result!.retryAfter };
}

export function consumeApiRequest(db: Database, p: Principal) {
  const bucket = p.oauthConsentId
    ? `oauth:${p.oauthConsentId}`
    : p.credential?.kind === "session"
      ? `user:${p.userId}`
      : `key:${p.credential?.id ?? p.id}`;
  return db.$transaction(async (tx) => {
    // Fixed lock order avoids deadlocks. Rejected attempts also count toward the
    // workspace allowance, which prevents bypass by rotating credentials.
    const workspace = await consume(
      tx,
      p.organizationId,
      "workspace",
      REQUEST_LIMITS.organization,
    );
    if (!workspace.allowed) return workspace;
    return consume(tx, p.organizationId, bucket, REQUEST_LIMITS.principal);
  });
}

export async function pruneRequestBuckets(db: Database) {
  const processed = await db.$executeRaw`
    DELETE FROM "ApiRequestBucket" WHERE ("organizationId", bucket) IN (
      SELECT "organizationId", bucket FROM "ApiRequestBucket"
      WHERE "window" < floor(extract(epoch FROM CURRENT_TIMESTAMP) / 60)::bigint - 1440
      ORDER BY "window" LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
  `;
  return { processed };
}
