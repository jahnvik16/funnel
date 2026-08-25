"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

const platformSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case (e.g. instagram)."),
});

export type FormState = { error?: string };

export async function createPlatform(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = platformSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const platform = await tx.platform.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "Platform",
        entityId: platform.id,
        after: platform,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A platform with that slug already exists." };
    }
    throw error;
  }

  redirect("/admin/platforms");
}

export async function updatePlatform(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = platformSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.platform.findUniqueOrThrow({ where: { id } });
      const after = await tx.platform.update({ where: { id }, data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "Platform",
        entityId: id,
        before,
        after,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A platform with that slug already exists." };
    }
    throw error;
  }

  redirect("/admin/platforms");
}

async function setPlatformStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.platform.findUniqueOrThrow({ where: { id } });
    const after = await tx.platform.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "Platform",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/platforms");
}

export async function archivePlatform(formData: FormData): Promise<void> {
  await setPlatformStatus(formData, "ARCHIVED");
}

export async function unarchivePlatform(formData: FormData): Promise<void> {
  await setPlatformStatus(formData, "ACTIVE");
}
