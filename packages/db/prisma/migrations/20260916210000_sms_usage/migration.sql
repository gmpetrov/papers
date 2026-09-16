ALTER TABLE "SmsMessage"
  ADD COLUMN "segments" INTEGER,
  ADD COLUMN "segmentsOccurredAt" TIMESTAMP(3),
  ADD COLUMN "costAmount" DECIMAL(20,10),
  ADD COLUMN "costCurrency" TEXT,
  ADD COLUMN "costOccurredAt" TIMESTAMP(3);
ALTER TABLE "SmsMessage" ADD CONSTRAINT "sms_usage_nonnegative" CHECK (
  ("segments" IS NULL OR "segments" > 0) AND ("costAmount" IS NULL OR "costAmount" >= 0)
  AND (("costAmount" IS NULL) = ("costCurrency" IS NULL))
);
