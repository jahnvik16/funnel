import Link from "next/link";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { NewTrackingLinkForm } from "./NewTrackingLinkForm";

function suggestToken(): string {
  return randomBytes(6).toString("base64url");
}

export default async function TrackingLinksPage() {
  const [links, brands, domains] = await Promise.all([
    prisma.trackingLink.findMany({
      orderBy: { createdAt: "desc" },
      include: { brand: true, domain: true, currentVersion: true },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.domain.findMany({ orderBy: { hostname: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Tracking links</h1>

      <NewTrackingLinkForm brands={brands} domains={domains} suggestedToken={suggestToken()} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Label</th>
            <th className={ui.th}>Token</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Domain</th>
            <th className={ui.th}>Path type</th>
            <th className={ui.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={link.id}>
              <td className={ui.td}>
                <Link href={`/admin/tracking-links/${link.id}`} className={ui.link}>
                  {link.label}
                </Link>
              </td>
              <td className={ui.td}>
                <code>{link.token}</code>
              </td>
              <td className={ui.td}>{link.brand.name}</td>
              <td className={ui.td}>{link.domain.hostname}</td>
              <td className={ui.td}>
                {link.currentVersion ? link.currentVersion.pathType : <span className={ui.muted}>Unpublished</span>}
              </td>
              <td className={ui.td}>
                <StatusBadge status={link.status} />
              </td>
            </tr>
          ))}
          {links.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={6}>
                <span className={ui.muted}>No tracking links yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
