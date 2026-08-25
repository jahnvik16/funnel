-- CreateEnum
CREATE TYPE "ExperimentSuccessMetric" AS ENUM ('CLICKS', 'AGE_GATE_ACCEPTS', 'AGGREGATOR_VIEWS', 'TELEGRAM_STARTS', 'OUTBOUND_REDIRECTS', 'SIGNUPS');

-- DropForeignKey
ALTER TABLE "experiments" DROP CONSTRAINT "experiments_brandId_fkey";

-- DropForeignKey
ALTER TABLE "experiments" DROP CONSTRAINT "experiments_trackingLinkId_fkey";

-- AlterTable
ALTER TABLE "experiments" DROP COLUMN "trackingLinkId",
ADD COLUMN     "platformId" TEXT,
ADD COLUMN     "successMetric" "ExperimentSuccessMetric" NOT NULL DEFAULT 'OUTBOUND_REDIRECTS',
ALTER COLUMN "brandId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
