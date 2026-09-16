ALTER TABLE "Attachment"
  ADD COLUMN "storageAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storageError" TEXT,
  ADD COLUMN "nextStorageAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Attachment_objectKey_nextStorageAttemptAt_idx" ON "Attachment"("objectKey", "nextStorageAttemptAt");
