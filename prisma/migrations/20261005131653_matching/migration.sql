-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "linkRequestId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "dealId" TEXT,
    "footprint" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Match_workspaceId_status_idx" ON "Match"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Match_status_expiresAt_idx" ON "Match"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_linkRequestId_siteId_key" ON "Match"("linkRequestId", "siteId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_linkRequestId_fkey" FOREIGN KEY ("linkRequestId") REFERENCES "LinkRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

