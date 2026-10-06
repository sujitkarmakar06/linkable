-- CreateEnum
CREATE TYPE "EmailMode" AS ENUM ('INSTANT', 'DIGEST', 'OFF');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailState" TEXT NOT NULL DEFAULT 'sent';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailDeals" "EmailMode" NOT NULL DEFAULT 'INSTANT',
ADD COLUMN     "emailMessages" "EmailMode" NOT NULL DEFAULT 'INSTANT',
ADD COLUMN     "emailSites" "EmailMode" NOT NULL DEFAULT 'INSTANT',
ADD COLUMN     "monthlyReport" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_kind_period_key" ON "JobRun"("kind", "period");

