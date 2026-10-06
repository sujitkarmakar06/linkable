-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "aiDraftsPerMonth" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "aiSuggestionsPerMonth" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "guestPostMaxRevisions" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "guestPostMinWords" INTEGER NOT NULL DEFAULT 800,
ALTER COLUMN "freeMaxSites" SET DEFAULT 2;

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "legId" TEXT,
    "outputHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_workspaceId_kind_createdAt_idx" ON "AiUsage"("workspaceId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_legId_idx" ON "AiUsage"("legId");


-- Free plan now allows 2 sites (owner decision, 2026-10-06). Only bump rows still on the old default.
UPDATE "PlatformSettings" SET "freeMaxSites" = 2 WHERE "freeMaxSites" = 1;
