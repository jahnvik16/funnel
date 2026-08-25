-- CreateEnum
CREATE TYPE "ApiConnectionAuthType" AS ENUM ('NONE', 'API_KEY_HEADER', 'API_KEY_QUERY', 'BEARER_TOKEN', 'BASIC_AUTH');

-- DropIndex
DROP INDEX "campaigns_brandId_paybigCampaignRef_key";

-- AlterTable
ALTER TABLE "api_connections" ADD COLUMN     "authType" "ApiConnectionAuthType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "baseUrl" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN "paybigCampaignRef",
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paybigUrl" TEXT NOT NULL,
ADD COLUMN     "platformId" TEXT NOT NULL,
ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "telegram_bots" ADD COLUMN     "ctaLabel" TEXT,
ADD COLUMN     "welcomeMessage" TEXT,
ALTER COLUMN "botUsername" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tracking_links" ADD COLUMN     "label" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_brandId_slug_key" ON "campaigns"("brandId", "slug");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
