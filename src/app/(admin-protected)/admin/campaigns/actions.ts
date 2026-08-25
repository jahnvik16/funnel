"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

const campaignSchema = z.object({
  brandId: z.string().trim().min(1, "Brand is required."),
  platformId: z.string().trim().min(1, "Platform is required."),
  name: z.string().trim().min(1, "Name is required."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case."),
  paybigUrl: z.string().trim().url("Enter a valid URL."),
  isDefault: z.coerce.boolean().default(false),
});

export type FormState = { error?: string };

// At most one ACTIVE default campaign per (brandId, platformId) — enforced
// here, not as a DB constraint (see prisma/schema.prisma comment on Campaign).
async function demoteOtherDefaults(
  tx: Prisma.TransactionClient,
  actorId: string,
  brandId: string,
  platformId: string,
  exceptCampaignId?: string,
) {
  const others = await tx.campaign.findMany({
    where: {
      brandId,
      platformId,
      isDefault: true,
      ...(exceptCampaignId ? { id: { not: exceptCampaignId } } : {}),
    },
  });

  for (const other of others) {
    const updated = await tx.campaign.update({
      where: { id: other.id },
      data: { isDefault: false },
    });
    await writeAuditLog(tx, {
      actorId,
      action: "UPDATE",
      entityType: "Campaign",
      entityId: other.id,
      before: other,
      after: updated,
    });
  }
}

export async function createCampaign(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = campaignSchema.safeParse({
    brandId: formData.get("brandId"),
    platformId: formData.get("platformId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    paybigUrl: formData.get("paybigUrl"),
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "Campaign",
        entityId: campaign.id,
        after: campaign,
      });
      if (parsed.data.isDefault) {
        await demoteOtherDefaults(tx, admin.id, parsed.data.brandId, parsed.data.platformId, campaign.id);
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A campaign with that slug already exists for this brand." };
    }
    throw error;
  }

  redirect("/admin/campaigns");
}

export async function updateCampaign(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = campaignSchema.safeParse({
    brandId: formData.get("brandId"),
    platformId: formData.get("platformId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    paybigUrl: formData.get("paybigUrl"),
    isDefault: formData.get("isDefault") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.campaign.findUniqueOrThrow({ where: { id } });
      const after = await tx.campaign.update({ where: { id }, data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: id,
        before,
        after,
      });
      if (parsed.data.isDefault) {
        await demoteOtherDefaults(tx, admin.id, parsed.data.brandId, parsed.data.platformId, id);
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A campaign with that slug already exists for this brand." };
    }
    throw error;
  }

  redirect("/admin/campaigns");
}

async function setCampaignStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.campaign.findUniqueOrThrow({ where: { id } });
    const after = await tx.campaign.update({
      where: { id },
      // Archiving a campaign also drops its default/fallback flag — an
      // archived campaign should never keep silently absorbing default traffic.
      data: { status, isDefault: status === "ARCHIVED" ? false : before.isDefault },
    });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "Campaign",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/campaigns");
}

export async function archiveCampaign(formData: FormData): Promise<void> {
  await setCampaignStatus(formData, "ARCHIVED");
}

export async function unarchiveCampaign(formData: FormData): Promise<void> {
  await setCampaignStatus(formData, "ACTIVE");
}
