import { ExperimentSuccessMetric } from "@prisma/client";

export const SUCCESS_METRIC_LABELS: Record<ExperimentSuccessMetric, string> = {
  [ExperimentSuccessMetric.CLICKS]: "Clicks",
  [ExperimentSuccessMetric.AGE_GATE_ACCEPTS]: "Age gate accepts",
  [ExperimentSuccessMetric.AGGREGATOR_VIEWS]: "Aggregator views",
  [ExperimentSuccessMetric.TELEGRAM_STARTS]: "Telegram starts",
  [ExperimentSuccessMetric.OUTBOUND_REDIRECTS]: "Outbound redirects",
  [ExperimentSuccessMetric.SIGNUPS]: "Signups",
};
