-- CreateEnum
CREATE TYPE "IndexState" AS ENUM ('NOT_STARTED', 'PENDING', 'INDEXED', 'EXPIRED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "ImpactWindow" AS ENUM ('BASELINE', 'D30', 'D60', 'D90');

-- AlterTable
ALTER TABLE "DealLeg" ADD COLUMN     "indexCheckedAt" TIMESTAMP(3),
ADD COLUMN     "indexCoverage" TEXT,
ADD COLUMN     "indexDeadline" TIMESTAMP(3),
ADD COLUMN     "indexReminderAt" TIMESTAMP(3),
ADD COLUMN     "indexState" "IndexState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "indexedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GscConnection" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "properties" TEXT[],
    "refreshToken" TEXT NOT NULL,
    "googleEmail" TEXT,
    "connectedById" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "GscConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkImpact" (
    "id" TEXT NOT NULL,
    "legId" TEXT NOT NULL,
    "window" "ImpactWindow" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkImpact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GscConnection_siteId_key" ON "GscConnection"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkImpact_legId_window_key" ON "LinkImpact"("legId", "window");

-- CreateIndex
CREATE INDEX "DealLeg_indexState_idx" ON "DealLeg"("indexState");

-- AddForeignKey
ALTER TABLE "GscConnection" ADD CONSTRAINT "GscConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkImpact" ADD CONSTRAINT "LinkImpact_legId_fkey" FOREIGN KEY ("legId") REFERENCES "DealLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Links verified before the indexing rule keep their existing payout schedule.
UPDATE "DealLeg" SET "indexState" = 'EXEMPT' WHERE "verifiedAt" IS NOT NULL;
