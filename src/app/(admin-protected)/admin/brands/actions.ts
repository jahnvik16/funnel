"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

const brandSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case (e.g. my-brand)."),
});

export type FormState = { error?: string };

export async function createBrand(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = brandSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "Brand",
        entityId: brand.id,
        after: brand,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A brand with that slug already exists." };
    }
    throw error;
  }

  redirect("/admin/brands");
}

export async function updateBrand(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = brandSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.brand.findUniqueOrThrow({ where: { id } });
      const after = await tx.brand.update({ where: { id }, data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "Brand",
        entityId: id,
        before,
        after,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "A brand with that slug already exists." };
    }
    throw error;
  }

  redirect("/admin/brands");
}

async function setBrandStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.brand.findUniqueOrThrow({ where: { id } });
    const after = await tx.brand.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "Brand",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/brands");
}

export async function archiveBrand(formData: FormData): Promise<void> {
  await setBrandStatus(formData, "ARCHIVED");
}

export async function unarchiveBrand(formData: FormData): Promise<void> {
  await setBrandStatus(formData, "ACTIVE");
}
