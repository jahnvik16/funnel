import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../../_components/StatusBadge";
import { InlineActionForm } from "../../_components/InlineActionForm";
import type { TrackingLinkVersionSnapshot } from "@/lib/tracking-link-publishing";
import {
  activateTrackingLink,
  pauseTrackingLink,
  archiveTrackingLink,
} from "../actions";
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
    include: { brand: true, domain: true, currentVersion: true },
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
      // An experiment's brand is optional scoping metadata, not an
      // enforced restriction — brand-less experiments are offered
      // everywhere, brand-scoped ones only where the brand matches (the
      // publish validation in lib/tracking-link-publishing.ts rejects a
      // brand mismatch too, so this is a UX narrowing, not the real guard).
      prisma.experiment.findMany({
        where: { status: "ACTIVE", OR: [{ brandId: null }, { brandId: link.brandId }] },
        include: { arms: true },
        orderBy: { name: "asc" },
      }),
      prisma.trackingLinkVersion.findMany({
        where: { trackingLinkId: link.id },
        orderBy: { versionNumber: "desc" },
        include: { campaign: true, socialAccount: true, telegramBot: true, publishedBy: true },
      }),
    ]);

  const currentSnapshot = link.currentVersion?.snapshot as TrackingLinkVersionSnapshot | undefined;

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

      <div className="flex gap-3">
        {link.status !== "ACTIVE" ? (
          <InlineActionForm action={activateTrackingLink} id={link.id} label="Activate" variant="primary" />
        ) : null}
        {link.status === "ACTIVE" ? (
          <InlineActionForm action={pauseTrackingLink} id={link.id} label="Pause" variant="secondary" />
        ) : null}
        {link.status !== "ARCHIVED" ? (
          <InlineActionForm action={archiveTrackingLink} id={link.id} label="Archive" variant="danger" />
        ) : null}
      </div>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Link settings</h2>
        <EditTrackingLinkForm link={link} domains={domains} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className={ui.sectionTitle}>Current published version</h2>
        {currentSnapshot ? (
          <div className={`${ui.form} gap-2`}>
            <p>
              <strong>v{link.currentVersion!.versionNumber}</strong> · {currentSnapshot.pathType} · published{" "}
              {link.currentVersion!.publishedAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className={ui.muted}>Domain / token</dt>
                <dd>
                  {currentSnapshot.domain.hostname} / <code>{currentSnapshot.token}</code>
                </dd>
              </div>
              <div>
                <dt className={ui.muted}>Brand / platform</dt>
                <dd>
                  {currentSnapshot.brand.name}
                  {currentSnapshot.platform ? ` / ${currentSnapshot.platform.name}` : ""}
                </dd>
              </div>
              <div>
                <dt className={ui.muted}>Campaign</dt>
                <dd>
                  {currentSnapshot.campaign.name} → {currentSnapshot.campaign.paybigUrl}
                </dd>
              </div>
              <div>
                <dt className={ui.muted}>Social account</dt>
                <dd>{currentSnapshot.socialAccount?.handle ?? "—"}</dd>
              </div>
              <div>
                <dt className={ui.muted}>Path config</dt>
                <dd>
                  <code>{JSON.stringify(currentSnapshot.pathConfig)}</code>
                </dd>
              </div>
              <div>
                <dt className={ui.muted}>Age gate</dt>
                <dd>{currentSnapshot.ageGateEnabled ? "Required" : "Not required"}</dd>
              </div>
              {currentSnapshot.telegramBot ? (
                <div>
                  <dt className={ui.muted}>Telegram bot</dt>
                  <dd>{currentSnapshot.telegramBot.name}</dd>
                </div>
              ) : null}
              {currentSnapshot.experiment ? (
                <div>
                  <dt className={ui.muted}>Experiment / arm</dt>
                  <dd>
                    {currentSnapshot.experiment.name} / {currentSnapshot.experimentArm?.name}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : (
          <p className={ui.muted}>No version has been published yet.</p>
        )}
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
