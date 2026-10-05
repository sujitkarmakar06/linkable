-- AlterTable
ALTER TABLE "DealLeg" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "removedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "previousDealStatus" "DealStatus";

