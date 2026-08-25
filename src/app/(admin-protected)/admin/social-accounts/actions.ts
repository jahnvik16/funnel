"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

const socialAccountSchema = z.object({
  brandId: z.string().trim().min(1, "Brand is required."),
  platformId: z.string().trim().min(1, "Platform is required."),
  handle: z.string().trim().min(1, "Handle is required."),
  displayName: z.string().trim().optional().transform((v) => (v ? v : null)),
});

export type FormState = { error?: string };

export async function createSocialAccount(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = socialAccountSchema.safeParse({
    brandId: formData.get("brandId"),
    platformId: formData.get("platformId"),
    handle: formData.get("handle"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.socialAccount.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "SocialAccount",
        entityId: account.id,
        after: account,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That brand/platform/handle combination already exists." };
    }
    throw error;
  }

  redirect("/admin/social-accounts");
}

export async function updateSocialAccount(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = socialAccountSchema.safeParse({
    brandId: formData.get("brandId"),
    platformId: formData.get("platformId"),
    handle: formData.get("handle"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.socialAccount.findUniqueOrThrow({ where: { id } });
      const after = await tx.socialAccount.update({ where: { id }, data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "SocialAccount",
        entityId: id,
        before,
        after,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That brand/platform/handle combination already exists." };
    }
    throw error;
  }

  redirect("/admin/social-accounts");
}

async function setSocialAccountStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.socialAccount.findUniqueOrThrow({ where: { id } });
    const after = await tx.socialAccount.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "SocialAccount",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/social-accounts");
}

export async function archiveSocialAccount(formData: FormData): Promise<void> {
  await setSocialAccountStatus(formData, "ARCHIVED");
}

export async function unarchiveSocialAccount(formData: FormData): Promise<void> {
  await setSocialAccountStatus(formData, "ACTIVE");
}
