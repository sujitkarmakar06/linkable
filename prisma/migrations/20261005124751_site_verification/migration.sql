-- DropIndex
DROP INDEX "Site_domain_key";

-- DropIndex
DROP INDEX "Site_workspaceId_idx";

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "lastVerifyAt" TIMESTAMP(3),
ADD COLUMN     "lastVerifyError" TEXT,
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "verifiedDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Site_verifiedDomain_key" ON "Site"("verifiedDomain");

-- CreateIndex
CREATE INDEX "Site_domain_idx" ON "Site"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Site_workspaceId_domain_key" ON "Site"("workspaceId", "domain");

