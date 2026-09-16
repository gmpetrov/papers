-- CreateTable
CREATE TABLE "PhoneNumber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "providerId" TEXT,
    "messagingProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "providerId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "providerOccurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_phoneNumber_key" ON "PhoneNumber"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_providerId_key" ON "PhoneNumber"("providerId");

-- CreateIndex
CREATE INDEX "PhoneNumber_organizationId_createdAt_idx" ON "PhoneNumber"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_id_organizationId_key" ON "PhoneNumber"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SmsMessage_organizationId_phoneNumberId_createdAt_idx" ON "SmsMessage"("organizationId", "phoneNumberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_phoneNumberId_providerId_key" ON "SmsMessage"("phoneNumberId", "providerId");

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneNumber" ADD CONSTRAINT "PhoneNumber_agentId_organizationId_fkey" FOREIGN KEY ("agentId", "organizationId") REFERENCES "Agent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_phoneNumberId_organizationId_fkey" FOREIGN KEY ("phoneNumberId", "organizationId") REFERENCES "PhoneNumber"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
