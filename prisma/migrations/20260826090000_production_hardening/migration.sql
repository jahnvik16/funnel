-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "clicks_brandId_idx" ON "clicks"("brandId");

-- CreateIndex
CREATE INDEX "clicks_platformId_idx" ON "clicks"("platformId");

-- CreateIndex
CREATE INDEX "clicks_socialAccountId_idx" ON "clicks"("socialAccountId");
