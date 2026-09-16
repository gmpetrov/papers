CREATE TABLE "ProviderSmsOptOut" (
  "messagingProfileId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "optedOut" BOOLEAN NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "eventId" TEXT NOT NULL,
  CONSTRAINT "ProviderSmsOptOut_pkey" PRIMARY KEY ("messagingProfileId", "recipient")
);
