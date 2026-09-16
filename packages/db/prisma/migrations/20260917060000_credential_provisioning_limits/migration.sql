ALTER TABLE "ApiKey" ADD COLUMN "dailyInboxLimit" INTEGER CHECK ("dailyInboxLimit" IS NULL OR "dailyInboxLimit" BETWEEN 0 AND 10000);
ALTER TABLE "ApiKey" ADD COLUMN "dailyNumberLimit" INTEGER CHECK ("dailyNumberLimit" IS NULL OR "dailyNumberLimit" BETWEEN 0 AND 10000);
ALTER TABLE "oauthConsent" ADD COLUMN "dailyInboxLimit" INTEGER CHECK ("dailyInboxLimit" IS NULL OR "dailyInboxLimit" BETWEEN 0 AND 10000);
ALTER TABLE "oauthConsent" ADD COLUMN "dailyNumberLimit" INTEGER CHECK ("dailyNumberLimit" IS NULL OR "dailyNumberLimit" BETWEEN 0 AND 10000);
ALTER TABLE "ApiKeyDailyUsage" ADD COLUMN "inboxCreations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApiKeyDailyUsage" ADD COLUMN "numberPurchases" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OAuthDailyUsage" ADD COLUMN "inboxCreations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OAuthDailyUsage" ADD COLUMN "numberPurchases" INTEGER NOT NULL DEFAULT 0;
