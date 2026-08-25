"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

const domainSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Enter a valid hostname (e.g. links.example.com)."),
  brandId: z.string().trim().optional().transform((v) => (v ? v : null)),
});

export type FormState = { error?: string };

export async function createDomain(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = domainSchema.safeParse({
    hostname: formData.get("hostname"),
    brandId: formData.get("brandId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "Domain",
        entityId: domain.id,
        after: domain,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That hostname is already registered." };
    }
    throw error;
  }

  redirect("/admin/domains");
}

export async function updateDomain(_prevState: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = domainSchema.safeParse({
    hostname: formData.get("hostname"),
    brandId: formData.get("brandId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.domain.findUniqueOrThrow({ where: { id } });
      const after = await tx.domain.update({ where: { id }, data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "Domain",
        entityId: id,
        before,
        after,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That hostname is already registered." };
    }
    throw error;
  }

  redirect("/admin/domains");
}

async function setDomainActive(formData: FormData, isActive: boolean) {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.domain.findUniqueOrThrow({ where: { id } });
    const after = await tx.domain.update({ where: { id }, data: { isActive } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: isActive ? "UNARCHIVE" : "ARCHIVE",
      entityType: "Domain",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/domains");
}

export async function archiveDomain(formData: FormData): Promise<void> {
  await setDomainActive(formData, false);
}

export async function unarchiveDomain(formData: FormData): Promise<void> {
  await setDomainActive(formData, true);
}
