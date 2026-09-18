ALTER TABLE "Attachment" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "smsMessageId" TEXT,
 ADD COLUMN "sourceUrl" TEXT, ADD COLUMN "providerTokenHash" TEXT,
 ADD COLUMN "providerTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "SmsMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_one_message" CHECK (("messageId" IS NOT NULL)::int + ("smsMessageId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "Attachment_providerTokenHash_key" ON "Attachment"("providerTokenHash");
CREATE INDEX "Attachment_smsMessageId_idx" ON "Attachment"("smsMessageId");

ALTER TABLE "SmsRate" ADD COLUMN "maxProviderMicrosPerMms" BIGINT;
