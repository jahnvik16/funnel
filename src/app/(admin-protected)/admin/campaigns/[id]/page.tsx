import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ui } from "@/lib/ui";
import { EditCampaignForm } from "./EditCampaignForm";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, brands, platforms, publishedVersion] = await Promise.all([
    prisma.campaign.findUnique({ where: { id } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
    prisma.trackingLinkVersion.findFirst({ where: { campaignId: id }, select: { id: true } }),
  ]);
  if (!campaign) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/campaigns" className={ui.link}>
          ← Campaigns
        </Link>
      </div>
      <h1 className={ui.pageTitle}>{campaign.name}</h1>
      <EditCampaignForm
        campaign={campaign}
        brands={brands}
        platforms={platforms}
        slugLocked={publishedVersion !== null}
      />
    </div>
  );
}
