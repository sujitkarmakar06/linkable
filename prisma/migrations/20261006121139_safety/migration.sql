-- AlterTable
ALTER TABLE "LinkRequest" ADD COLUMN     "targetTopics" JSONB,
ADD COLUMN     "targetTopicsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "relevance" INTEGER;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "brandTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "topicSummary" TEXT,
ADD COLUMN     "topics" JSONB,
ADD COLUMN     "topicsUpdatedAt" TIMESTAMP(3);

