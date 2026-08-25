-- AlterEnum
ALTER TYPE "FunnelStepType" ADD VALUE 'TELEGRAM_REDIRECTED';
ALTER TYPE "FunnelStepType" ADD VALUE 'TELEGRAM_STARTED';

-- AlterTable
ALTER TABLE "telegram_bots" ADD COLUMN     "webhookSecretCiphertext" TEXT;

-- AlterTable
ALTER TABLE "telegram_start_payloads" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL;
