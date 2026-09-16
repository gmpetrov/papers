ALTER TABLE "organization" ADD COLUMN "requireSmsApproval" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "Approval" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "principalId" TEXT NOT NULL, "route" TEXT NOT NULL, "key" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL, "parameters" JSONB NOT NULL, "resourceId" TEXT NOT NULL,
 "policyVersion" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "expiresAt" TIMESTAMP(3) NOT NULL, "decidedBy" TEXT, "decidedAt" TIMESTAMP(3),
 "operationId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Approval_operationId_key" ON "Approval"("operationId");
CREATE UNIQUE INDEX "Approval_organizationId_principalId_route_key_policyVersion_key"
 ON "Approval"("organizationId", "principalId", "route", "key", "policyVersion");
CREATE INDEX "Approval_organizationId_status_createdAt_idx" ON "Approval"("organizationId", "status", "createdAt");
