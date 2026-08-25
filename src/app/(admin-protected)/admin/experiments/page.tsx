import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { NewExperimentForm } from "./NewExperimentForm";
import { SUCCESS_METRIC_LABELS } from "./successMetricLabels";

export default async function ExperimentsPage() {
  const [experiments, brands, platforms] = await Promise.all([
    prisma.experiment.findMany({
      orderBy: { createdAt: "desc" },
      include: { brand: true, platform: true, arms: true },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Experiments</h1>

      <NewExperimentForm brands={brands} platforms={platforms} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Platform</th>
            <th className={ui.th}>Success metric</th>
            <th className={ui.th}>Arms</th>
            <th className={ui.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {experiments.map((experiment) => (
            <tr key={experiment.id}>
              <td className={ui.td}>
                <Link href={`/admin/experiments/${experiment.id}`} className={ui.link}>
                  {experiment.name}
                </Link>
              </td>
              <td className={ui.td}>{experiment.brand?.name ?? <span className={ui.muted}>All brands</span>}</td>
              <td className={ui.td}>
                {experiment.platform?.name ?? <span className={ui.muted}>All platforms</span>}
              </td>
              <td className={ui.td}>{SUCCESS_METRIC_LABELS[experiment.successMetric]}</td>
              <td className={ui.td}>{experiment.arms.length}</td>
              <td className={ui.td}>
                <StatusBadge status={experiment.status} />
              </td>
            </tr>
          ))}
          {experiments.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={6}>
                <span className={ui.muted}>No experiments yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
