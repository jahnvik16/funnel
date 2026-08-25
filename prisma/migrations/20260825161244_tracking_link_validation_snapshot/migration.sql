-- DropIndex
DROP INDEX "tracking_links_token_key";

-- AlterTable
ALTER TABLE "tracking_link_versions" ADD COLUMN     "snapshot" JSONB NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_domainId_token_key" ON "tracking_links"("domainId", "token");
