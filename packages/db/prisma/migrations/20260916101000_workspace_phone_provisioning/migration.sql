-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "monthlyCost" TEXT,
ADD COLUMN     "nextReconcileAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "orderReference" TEXT,
ADD COLUMN     "providerOrderId" TEXT,
ADD COLUMN     "upfrontCost" TEXT,
ALTER COLUMN "agentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkspaceEmailUsage" ADD COLUMN     "smsSends" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "dailySmsLimit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "maxPhoneNumbers" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_orderReference_key" ON "PhoneNumber"("orderReference");

