import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archivePlatform, unarchivePlatform } from "./actions";
import { NewPlatformForm } from "./NewPlatformForm";

export default async function PlatformsPage() {
  const platforms = await prisma.platform.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Platforms</h1>

      <NewPlatformForm />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Slug</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((platform) => (
            <tr key={platform.id}>
              <td className={ui.td}>
                <Link href={`/admin/platforms/${platform.id}`} className={ui.link}>
                  {platform.name}
                </Link>
              </td>
              <td className={ui.td}>{platform.slug}</td>
              <td className={ui.td}>
                <StatusBadge status={platform.status} />
              </td>
              <td className={ui.td}>
                {platform.status === "ACTIVE" ? (
                  <InlineActionForm action={archivePlatform} id={platform.id} label="Archive" variant="danger" />
                ) : (
                  <InlineActionForm action={unarchivePlatform} id={platform.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {platforms.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={4}>
                <span className={ui.muted}>No platforms yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
