import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../../_components/StatusBadge";
import { EditTrackingLinkForm } from "./EditTrackingLinkForm";
import { PublishVersionForm } from "./PublishVersionForm";

export default async function TrackingLinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const link = await prisma.trackingLink.findUnique({
    where: { id },
    include: { brand: true, domain: true },
  });
  if (!link) notFound();

  const [domains, campaigns, socialAccounts, telegramBots, experiments, versions] =
    await Promise.all([
      prisma.domain.findMany({ orderBy: { hostname: "asc" } }),
      prisma.campaign.findMany({ where: { brandId: link.brandId }, orderBy: { name: "asc" } }),
      prisma.socialAccount.findMany({ where: { brandId: link.brandId }, orderBy: { handle: "asc" } }),
      prisma.telegramBot.findMany({
        where: { brandId: link.brandId },
        select: { id: true, name: true, status: true },
        orderBy: { name: "asc" },
      }),
      prisma.experiment.findMany({
        where: { trackingLinkId: link.id },
        include: { arms: true },
        orderBy: { name: "asc" },
      }),
      prisma.trackingLinkVersion.findMany({
        where: { trackingLinkId: link.id },
        orderBy: { versionNumber: "desc" },
        include: { campaign: true, socialAccount: true, telegramBot: true, publishedBy: true },
      }),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin/tracking-links" className={ui.link}>
          ← Tracking links
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <h1 className={ui.pageTitle}>{link.label}</h1>
        <StatusBadge status={link.status} />
      </div>
      <p className={ui.muted}>
        Token: <code>{link.token}</code> · Brand: {link.brand.name} (fixed at creation)
      </p>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Link settings</h2>
        <EditTrackingLinkForm link={link} domains={domains} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Version history</h2>
        <table className={ui.table}>
          <thead>
            <tr>
              <th className={ui.th}>Version</th>
              <th className={ui.th}>Path type</th>
              <th className={ui.th}>Campaign</th>
              <th className={ui.th}>Social account</th>
              <th className={ui.th}>Age gate</th>
              <th className={ui.th}>Published</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td className={ui.td}>
                  v{version.versionNumber}
                  {link.currentVersionId === version.id ? " (current)" : ""}
                </td>
                <td className={ui.td}>{version.pathType}</td>
                <td className={ui.td}>{version.campaign.name}</td>
                <td className={ui.td}>{version.socialAccount?.handle ?? <span className={ui.muted}>—</span>}</td>
                <td className={ui.td}>{version.ageGateEnabled ? "Yes" : "No"}</td>
                <td className={ui.td}>
                  {version.publishedAt.toISOString().slice(0, 16).replace("T", " ")} by{" "}
                  {version.publishedBy.email}
                </td>
              </tr>
            ))}
            {versions.length === 0 ? (
              <tr>
                <td className={ui.td} colSpan={6}>
                  <span className={ui.muted}>No versions published yet.</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Publish new version</h2>
        <PublishVersionForm
          trackingLinkId={link.id}
          campaigns={campaigns}
          socialAccounts={socialAccounts}
          telegramBots={telegramBots}
          experiments={experiments}
        />
      </section>
    </div>
  );
}
