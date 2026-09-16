-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "replyTo" TEXT[] DEFAULT ARRAY[]::TEXT[];
