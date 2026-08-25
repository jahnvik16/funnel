import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../../_components/StatusBadge";
import { InlineActionForm } from "../../_components/InlineActionForm";
import {
  archiveExperiment,
  unarchiveExperiment,
  archiveExperimentArm,
  unarchiveExperimentArm,
} from "../actions";
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
    include: { arms: { include: { trackingLinkVersion: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!experiment) notFound();

  const [brands, trackingLinks, versions] = await Promise.all([
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.trackingLink.findMany({ orderBy: { label: "asc" }, select: { id: true, label: true, token: true } }),
    experiment.trackingLinkId
      ? prisma.trackingLinkVersion.findMany({
          where: { trackingLinkId: experiment.trackingLinkId },
          orderBy: { versionNumber: "desc" },
        })
      : Promise.resolve([]),
  ]);

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

      <EditExperimentForm experiment={experiment} brands={brands} trackingLinks={trackingLinks} />

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

        {!experiment.trackingLinkId ? (
          <p className={ui.muted}>
            Assign a tracking link to this experiment to be able to point an arm at a specific
            published version.
          </p>
        ) : null}

        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Name</th>
              <th className={ui.th}>Version</th>
              <th className={ui.th}>Weight</th>
              <th className={ui.th}>Status</th>
              <th className={ui.th}></th>
            </tr>
          </thead>
          <tbody>
            {experiment.arms.map((arm) => (
              <tr key={arm.id}>
                <td className={ui.td}>{arm.name}</td>
                <td className={ui.td}>
                  {arm.trackingLinkVersion ? `v${arm.trackingLinkVersion.versionNumber}` : <span className={ui.muted}>Unassigned</span>}
                </td>
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
                <td className={ui.td} colSpan={5}>
                  <span className={ui.muted}>No arms yet.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <NewExperimentArmForm experimentId={experiment.id} versions={versions} />
      </div>
    </div>
  );
}
