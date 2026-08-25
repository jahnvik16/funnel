import { notFound } from "next/navigation";
import Link from "next/link";
import { ExperimentSuccessMetric } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { buildExperimentArmReport } from "@/lib/attribution-report";
import { StatusBadge } from "../../_components/StatusBadge";
import { InlineActionForm } from "../../_components/InlineActionForm";
import {
  archiveExperiment,
  unarchiveExperiment,
  archiveExperimentArm,
  unarchiveExperimentArm,
} from "../actions";
import { SUCCESS_METRIC_LABELS } from "../successMetricLabels";
import { EditExperimentForm } from "./EditExperimentForm";
import { NewExperimentArmForm } from "./NewExperimentArmForm";

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const experiment = await prisma.experiment.findUnique({
    where: { id },
    include: { arms: { orderBy: { createdAt: "asc" } } },
  });
  if (!experiment) notFound();

  const [brands, platforms, armRows] = await Promise.all([
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
    buildExperimentArmReport(prisma, experiment.id),
  ]);

  const campaignIds = new Set(armRows.map((row) => row.campaign?.id).filter(Boolean));
  const armsUseDifferentCampaigns = campaignIds.size > 1;
  const successMetricIsSignups = experiment.successMetric === ExperimentSuccessMetric.SIGNUPS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/experiments" className={ui.link}>
          ← Experiments
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <h1 className={ui.pageTitle}>{experiment.name}</h1>
        <StatusBadge status={experiment.status} />
      </div>

      <EditExperimentForm experiment={experiment} brands={brands} platforms={platforms} />

      <div>
        {experiment.status === "ACTIVE" ? (
          <InlineActionForm
            action={archiveExperiment}
            id={experiment.id}
            label="Archive experiment"
            variant="danger"
          />
        ) : (
          <InlineActionForm action={unarchiveExperiment} id={experiment.id} label="Unarchive experiment" />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Experiment arms</h2>
        <p className={ui.muted}>
          Each arm is wired to a tracking link manually — publish that link (see its own page)
          and select this experiment and arm on the publish form. V1 has no automatic traffic
          splitting: arms are simply whichever links an admin chose to point at each one.
        </p>

        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Name</th>
              <th className={ui.th}>Weight</th>
              <th className={ui.th}>Status</th>
              <th className={ui.th}></th>
            </tr>
          </thead>
          <tbody>
            {experiment.arms.map((arm) => (
              <tr key={arm.id}>
                <td className={ui.td}>{arm.name}</td>
                <td className={ui.td}>{arm.weight}</td>
                <td className={ui.td}>
                  <StatusBadge status={arm.status} />
                </td>
                <td className={ui.td}>
                  {arm.status === "ACTIVE" ? (
                    <InlineActionForm
                      action={archiveExperimentArm}
                      id={arm.id}
                      label="Archive"
                      variant="danger"
                    />
                  ) : (
                    <InlineActionForm action={unarchiveExperimentArm} id={arm.id} label="Unarchive" />
                  )}
                </td>
              </tr>
            ))}
            {experiment.arms.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={4}>
                  <span className={ui.muted}>No arms yet.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <NewExperimentArmForm experimentId={experiment.id} />
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className={ui.sectionTitle}>Arm performance</h2>
          <p className={ui.muted}>
            Success metric for this experiment: <strong>{SUCCESS_METRIC_LABELS[experiment.successMetric]}</strong>{" "}
            (shown for reference only — FunnelCore does not auto-select a winner).
          </p>
        </div>

        {successMetricIsSignups ? (
          <p className={`${ui.error} rounded border border-red-300 p-3 dark:border-red-800`}>
            This experiment&apos;s chosen success metric is Signups, but Paybig conversions carry
            no arm-level attribution — see the note below the table. Treat the Signups column as
            informational only, not a per-arm comparison.
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className={ui.table}>
            <thead>
              <tr>
                <th className={ui.th}>Arm</th>
                <th className={ui.th}>Tracking link</th>
                <th className={ui.th}>Clicks</th>
                <th className={ui.th}>Gate accepts</th>
                <th className={ui.th}>Aggregator views</th>
                <th className={ui.th}>Telegram starts</th>
                <th className={ui.th}>Outbound redirects</th>
                <th className={ui.th}>Campaign</th>
                <th className={ui.th}>Signups (campaign-level)</th>
              </tr>
            </thead>
            <tbody>
              {armRows.map((row) => (
                <tr key={row.armId}>
                  <td className={ui.td}>{row.armName}</td>
                  <td className={ui.td}>
                    {row.trackingLink ? (
                      `${row.trackingLink.label} (${row.trackingLink.token})`
                    ) : (
                      <span className={ui.muted}>Not yet assigned</span>
                    )}
                  </td>
                  <td className={ui.td}>{row.funnel.clicks}</td>
                  <td className={ui.td}>{row.funnel.ageGateAccepts}</td>
                  <td className={ui.td}>{row.funnel.aggregatorViews}</td>
                  <td className={ui.td}>{row.funnel.telegramStarts}</td>
                  <td className={ui.td}>{row.funnel.outboundRedirects}</td>
                  <td className={ui.td}>{row.campaign?.name ?? <span className={ui.muted}>—</span>}</td>
                  <td className={ui.td}>
                    {row.campaignSignups === null ? (
                      <span className={ui.muted}>N/A — no campaign yet</span>
                    ) : (
                      row.campaignSignups
                    )}
                  </td>
                </tr>
              ))}
              {armRows.length === 0 ? (
                <tr>
                  <td className={ui.td} colSpan={9}>
                    <span className={ui.muted}>No arms yet.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className={ui.muted}>
          Clicks through outbound redirects are precise, computed directly from this arm&apos;s
          published tracking-link version. Signups are shown at the <strong>campaign</strong>{" "}
          level, not per arm — Paybig conversions carry no arm/click attribution, so a
          campaign&apos;s signup count is the most precise honest figure available.
          {armsUseDifferentCampaigns
            ? " These arms use different campaigns, so their signup counts are independently meaningful."
            : " If two arms share the same campaign, the identical signup count will appear on both rows — never sum this column across arms."}
        </p>
      </div>
    </div>
  );
}
