-- AlterEnum
BEGIN;
CREATE TYPE "FunnelStepType_new" AS ENUM ('ROUTE_RESOLVED', 'AGE_GATE_SHOWN', 'AGE_GATE_ACCEPTED', 'AGE_GATE_DECLINED', 'AGGREGATOR_VIEWED', 'AGGREGATOR_CONTINUE_CLICKED', 'OUTBOUND_PAYBIG_REDIRECTED', 'ROUTE_FAILED');
ALTER TABLE "funnel_events" ALTER COLUMN "stepType" TYPE "FunnelStepType_new" USING ("stepType"::text::"FunnelStepType_new");
ALTER TYPE "FunnelStepType" RENAME TO "FunnelStepType_old";
ALTER TYPE "FunnelStepType_new" RENAME TO "FunnelStepType";
DROP TYPE "public"."FunnelStepType_old";
COMMIT;
