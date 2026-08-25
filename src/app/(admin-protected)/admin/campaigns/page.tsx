import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { StatusBadge } from "../_components/StatusBadge";
import { InlineActionForm } from "../_components/InlineActionForm";
import { archiveCampaign, unarchiveCampaign } from "./actions";
import { NewCampaignForm } from "./NewCampaignForm";

export default async function CampaignsPage() {
  const [campaigns, brands, platforms] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { brand: true, platform: true },
    }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className={ui.pageTitle}>Campaigns</h1>

      <NewCampaignForm brands={brands} platforms={platforms} />

      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th}>Name</th>
            <th className={ui.th}>Brand</th>
            <th className={ui.th}>Platform</th>
            <th className={ui.th}>Default</th>
            <th className={ui.th}>Status</th>
            <th className={ui.th}></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id}>
              <td className={ui.td}>
                <Link href={`/admin/campaigns/${campaign.id}`} className={ui.link}>
                  {campaign.name}
                </Link>
              </td>
              <td className={ui.td}>{campaign.brand.name}</td>
              <td className={ui.td}>{campaign.platform.name}</td>
              <td className={ui.td}>{campaign.isDefault ? "Yes" : ""}</td>
              <td className={ui.td}>
                <StatusBadge status={campaign.status} />
              </td>
              <td className={ui.td}>
                {campaign.status === "ACTIVE" ? (
                  <InlineActionForm
                    action={archiveCampaign}
                    id={campaign.id}
                    label="Archive"
                    variant="danger"
                  />
                ) : (
                  <InlineActionForm action={unarchiveCampaign} id={campaign.id} label="Unarchive" />
                )}
              </td>
            </tr>
          ))}
          {campaigns.length === 0 ? (
            <tr>
              <td className={ui.td} colSpan={6}>
                <span className={ui.muted}>No campaigns yet.</span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
