import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "@agentinfra/db";
import { reconcileSmsOptOuts } from "../src/sms-opt-out-sync";
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const env = { TELNYX_STATUS: "active", TELNYX_API_KEY: "fixture" };
const fetcher = vi.fn<typeof fetch>();
const profile = "sync-profile";
const where = { messagingProfileId: profile };
const response = (page: number, total = 1, to = "+12025550100") =>
  Response.json({
    data: [
      {
        messaging_profile_id: profile,
        to,
        created_at: "2026-09-16 12:00:00.000000+00:00",
      },
    ],
    meta: { page_number: page, total_pages: total },
  });
beforeEach(async () => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "ProviderSmsOptOut", "ProviderSmsOptOutSync" CASCADE',
  );
  await db.organization.create({
    data: { id: "sync-org", name: "Sync", slug: "sync", createdAt: new Date() },
  });
  await db.phoneNumber.create({
    data: {
      organizationId: "sync-org",
      phoneNumber: "+12025550101",
      messagingProfileId: profile,
      status: "active",
    },
  });
});
afterAll(async () => {
  await db.providerSmsOptOut.deleteMany({ where });
  await db.providerSmsOptOutSync.deleteMany({ where });
  vi.unstubAllGlobals();
  await db.$disconnect();
});
it("claims one page at a time, checkpoints, and schedules a new pass after completion", async () => {
  let release!: (response: Response) => void;
  let ready!: () => void;
  const started = new Promise<void>((r) => {
    ready = r;
  });
  fetcher.mockImplementationOnce(() => {
    ready();
    return new Promise((r) => {
      release = r;
    });
  });
  const first = reconcileSmsOptOuts(db, env);
  await started;
  expect(await reconcileSmsOptOuts(db, env)).toEqual({ processed: 0 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(response(1, 2));
  expect(await first).toEqual({ processed: 1 });
  expect(
    (await db.providerSmsOptOutSync.findUniqueOrThrow({ where })).nextPage,
  ).toBe(2);
  await db.providerSmsOptOutSync.update({
    where,
    data: { availableAt: new Date(0) },
  });
  fetcher.mockResolvedValueOnce(response(2, 2, "+12025550102"));
  expect(await reconcileSmsOptOuts(db, env)).toEqual({ processed: 1 });
  const finished = await db.providerSmsOptOutSync.findUniqueOrThrow({ where });
  expect(finished.nextPage).toBe(1);
  expect(finished.lastCompletedAt).not.toBeNull();
  expect(finished.availableAt.getTime()).toBeGreaterThan(
    Date.now() + 14 * 60000,
  );
  expect(await reconcileSmsOptOuts(db, env)).toEqual({ processed: 0 });
  expect(await db.providerSmsOptOut.count()).toBe(2);
});
it("backs off failures and does not advance the page or leak provider data", async () => {
  fetcher.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_PAYLOAD"));
  await expect(reconcileSmsOptOuts(db, env)).rejects.toThrow(
    "SMS opt-out import failed",
  );
  const failed = await db.providerSmsOptOutSync.findUniqueOrThrow({ where });
  expect(failed.nextPage).toBe(1);
  expect(failed.leaseToken).toBeNull();
  expect(failed.lastError).toBe("provider_import_failed");
  expect(await reconcileSmsOptOuts(db, env)).toEqual({ processed: 0 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await db.providerSmsOptOut.count()).toBe(0);
});
it("recovers expired claims and fences the late worker before applying its rows", async () => {
  let release!: (response: Response) => void;
  let ready!: () => void;
  const started = new Promise<void>((r) => {
    ready = r;
  });
  fetcher.mockImplementationOnce(() => {
    ready();
    return new Promise((r) => {
      release = r;
    });
  });
  const stale = reconcileSmsOptOuts(db, env);
  await started;
  await db.providerSmsOptOutSync.update({
    where,
    data: { leaseExpiresAt: new Date(0) },
  });
  fetcher.mockResolvedValueOnce(response(1));
  expect(await reconcileSmsOptOuts(db, env)).toEqual({ processed: 1 });
  release(response(1, 2, "+12025550199"));
  expect(await stale).toEqual({ processed: 0 });
  expect(await db.providerSmsOptOut.count()).toBe(1);
  expect(
    (await db.providerSmsOptOutSync.findUniqueOrThrow({ where })).nextPage,
  ).toBe(1);
});
it("does not access the provider or database without active credentials", async () => {
  expect(await reconcileSmsOptOuts({} as typeof db, {})).toEqual({
    processed: 0,
  });
  expect(fetcher).not.toHaveBeenCalled();
});
