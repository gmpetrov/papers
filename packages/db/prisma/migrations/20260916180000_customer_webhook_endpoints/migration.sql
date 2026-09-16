CREATE TABLE "WebhookEndpoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "eventTypes" TEXT[] NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "secretCiphertext" TEXT NOT NULL,
  "secretVersion" INTEGER NOT NULL DEFAULT 1,
  "previousSecretCiphertext" TEXT,
  "previousSecretExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WebhookEndpoint_organizationId_createdAt_idx" ON "WebhookEndpoint"("organizationId", "createdAt");
