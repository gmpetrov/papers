ALTER TABLE "oauthConsent" ADD COLUMN "dailyEmailLimit" INTEGER, ADD COLUMN "dailySmsLimit" INTEGER;
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_dailyEmailLimit_check" CHECK ("dailyEmailLimit" IS NULL OR "dailyEmailLimit" BETWEEN 0 AND 10000), ADD CONSTRAINT "oauthConsent_dailySmsLimit_check" CHECK ("dailySmsLimit" IS NULL OR "dailySmsLimit" BETWEEN 0 AND 10000);
CREATE TABLE "OAuthDailyUsage" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "consentId" TEXT NOT NULL REFERENCES "oauthConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "day" TEXT NOT NULL,
 "emailSends" INTEGER NOT NULL DEFAULT 0,
 "smsSends" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "OAuthDailyUsage_consentId_day_key" ON "OAuthDailyUsage"("consentId", "day");
