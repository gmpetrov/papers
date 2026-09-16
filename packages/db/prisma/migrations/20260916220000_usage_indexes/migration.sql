CREATE INDEX "EmailMessage_organizationId_createdAt_idx" ON "EmailMessage"("organizationId", "createdAt");
CREATE INDEX "SmsMessage_organizationId_createdAt_idx" ON "SmsMessage"("organizationId", "createdAt");
