-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "agentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Inbox" ALTER COLUMN "agentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "dailyEmailLimit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "maxInboxes" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "WorkspaceEmailUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "sends" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkspaceEmailUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceEmailUsage_organizationId_day_key" ON "WorkspaceEmailUsage"("organizationId", "day");

-- AddForeignKey
ALTER TABLE "WorkspaceEmailUsage" ADD CONSTRAINT "WorkspaceEmailUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
