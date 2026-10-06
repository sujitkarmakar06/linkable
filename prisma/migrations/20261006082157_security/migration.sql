-- AlterTable
ALTER TABLE "CreditEntry" ADD COLUMN     "legId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastTotpStep" INTEGER;

-- CreateIndex
CREATE INDEX "CreditEntry_legId_reason_idx" ON "CreditEntry"("legId", "reason");

