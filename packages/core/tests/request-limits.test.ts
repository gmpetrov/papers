import { afterAll, beforeEach, expect, it } from "vitest";
import { createDatabase, type Prisma } from "@agentinfra/db";
import { createAuth } from "@agentinfra/auth";
import { createApi } from "../src/index";
import { hash } from "../src/errors";
import { consumeApiRequest, pruneRequestBuckets } from "../src/request-limits";
import type { Principal } from "../src/principal";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const principal: Principal = {
  id: "rate-key",
  userId: "rate-user",
  organizationId: "rate-org",
  role: "owner",
  scopes: ["inboxes:read"],
  credential: { kind: "key", id: "rate-key" },
};
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent" CASCADE',
  );
  await db.organization.create({
    data: {
      id: "rate-org",
      name: "Rates",
      slug: "rates",
      createdAt: new Date(),
    },
  });
});
afterAll(() => db.$disconnect());
async function seed(bucket: string, count: number, age = 0) {
  await db.$executeRaw`INSERT INTO "ApiRequestBucket" ("organizationId", bucket, "window", count)
    VALUES ('rate-org', ${bucket}, floor(extract(epoch FROM CURRENT_TIMESTAMP)/60)::bigint - ${age}, ${count})
    ON CONFLICT ("organizationId", bucket) DO UPDATE SET count=EXCLUDED.count, "window"=EXCLUDED."window"`;
}
it("atomically caps concurrent requests without moving the retry window", async () => {
  // Run within one database transaction so the minute boundary cannot change
  // midway through this concurrency assertion. All calls use the same SQL path.
  await db.$transaction(async (tx) => {
    const transactionalDb = {
      $transaction: (run: (tx: Prisma.TransactionClient) => unknown) => run(tx),
    } as unknown as typeof db;
    const results = await Promise.all(
      Array.from({ length: 130 }, () =>
        consumeApiRequest(transactionalDb, principal),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(120);
    expect(new Set(results.map((r) => r.retryAfter)).size).toBe(1);
    expect(results[0]!.retryAfter).toBeGreaterThanOrEqual(1);
    expect(results[0]!.retryAfter).toBeLessThanOrEqual(60);
  });
});
it("shares OAuth allowance across token rotation and session allowance across logins", async () => {
  const oauth = {
    ...principal,
    oauthConsentId: "consent",
    credential: { kind: "oauth" as const, id: "token-one" },
  };
  await consumeApiRequest(db, oauth);
  await consumeApiRequest(db, {
    ...oauth,
    credential: { kind: "oauth", id: "token-two" },
  });
  await consumeApiRequest(db, {
    ...principal,
    credential: { kind: "session", id: "session-one" },
  });
  await consumeApiRequest(db, {
    ...principal,
    credential: { kind: "session", id: "session-two" },
  });
  const buckets = await db.apiRequestBucket.findMany({
    where: { organizationId: "rate-org", bucket: { not: "workspace" } },
  });
  expect(buckets.map((b) => b.bucket).sort()).toEqual([
    "oauth:consent",
    "user:rate-user",
  ]);
  expect(buckets.every((b) => b.count === 2)).toBe(true);
});
it("enforces the workspace cap across credentials and resets expired buckets", async () => {
  await seed("workspace", 1200);
  expect((await consumeApiRequest(db, principal)).allowed).toBe(false);
  expect(
    (
      await consumeApiRequest(db, {
        ...principal,
        credential: { kind: "key", id: "another" },
      })
    ).allowed,
  ).toBe(false);
  await seed("workspace", 1200, 1);
  await seed("key:rate-key", 120, 1);
  expect((await consumeApiRequest(db, principal)).allowed).toBe(true);
  await seed("key:old", 120, 1442);
  expect((await pruneRequestBuckets(db)).processed).toBe(1);
  expect(await db.apiRequestBucket.count()).toBe(2);
});
it("returns retryable 429 and Retry-After before executing an authenticated route", async () => {
  await db.user.create({
    data: {
      id: "rate-user",
      name: "Rates",
      email: "rates@example.test",
      emailVerified: true,
    },
  });
  await db.member.create({
    data: {
      id: "rate-member",
      organizationId: "rate-org",
      userId: "rate-user",
      role: "owner",
      createdAt: new Date(),
    },
  });
  await db.apiKey.create({
    data: {
      id: "rate-key",
      organizationId: "rate-org",
      createdBy: "rate-user",
      name: "Rates",
      prefix: "rate",
      hash: await hash("rate-token"),
      expiresAt: new Date(Date.now() + 60000),
      scopes: ["inboxes:read"],
    },
  });
  const auth = createAuth(db, {
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "rate-test-secret-that-is-long-enough",
  });
  const api = createApi(db, auth, {});
  await seed("key:rate-key", 120);
  const response = await api.request("http://localhost:3000/v1/inboxes", {
    headers: { authorization: "Bearer rate-token" },
  });
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({
    error: { code: "rate_limited", retryable: true },
  });
  expect((await api.request("http://localhost:3000/v1/inboxes")).status).toBe(
    401,
  );
});
