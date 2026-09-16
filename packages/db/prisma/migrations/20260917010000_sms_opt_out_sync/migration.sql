CREATE TABLE "ProviderSmsOptOutSync" (
  "messagingProfileId" TEXT PRIMARY KEY,
  "nextPage" INTEGER NOT NULL DEFAULT 1 CHECK ("nextPage" > 0),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "lastError" TEXT
);
CREATE INDEX "ProviderSmsOptOutSync_availableAt_idx" ON "ProviderSmsOptOutSync"("availableAt");
