-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('SWAP', 'REQUEST_OFFER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "DealSource" ADD VALUE 'REQUEST_OFFER';

-- AlterTable
ALTER TABLE "DealLeg" ADD COLUMN     "giverWorkspaceId" TEXT NOT NULL,
ADD COLUMN     "receiverWorkspaceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "awaitingWorkspaceId" TEXT NOT NULL,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "kind" "ProposalKind" NOT NULL DEFAULT 'SWAP',
ADD COLUMN     "linkRequestId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
DROP COLUMN "status",
ADD COLUMN     "status" "ProposalStatus" NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX "Proposal_fromWorkspaceId_status_idx" ON "Proposal"("fromWorkspaceId", "status");

-- CreateIndex
CREATE INDEX "Proposal_toWorkspaceId_status_idx" ON "Proposal"("toWorkspaceId", "status");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_linkRequestId_fkey" FOREIGN KEY ("linkRequestId") REFERENCES "LinkRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

