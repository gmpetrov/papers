-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "allowedSmsRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dailySmsLimit" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "DailyUsage" ADD COLUMN     "smsSends" INTEGER NOT NULL DEFAULT 0;
