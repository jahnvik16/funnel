"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

const experimentSchema = z.object({
  brandId: z.string().trim().min(1, "Brand is required."),
  trackingLinkId: z.string().trim().optional().transform((v) => (v ? v : null)),
  name: z.string().trim().min(1, "Name is required."),
  variantConfig: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidJson(v), "Variant config must be valid JSON.")
    .transform((v) => (v ? (JSON.parse(v) as Prisma.InputJsonValue) : undefined)),
  startedAt: z.string().trim().optional().transform((v) => (v ? new Date(v) : null)),
  endedAt: z.string().trim().optional().transform((v) => (v ? new Date(v) : null)),
});

export type FormState = { error?: string };

export async function createExperiment(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = experimentSchema.safeParse({
    brandId: formData.get("brandId"),
    trackingLinkId: formData.get("trackingLinkId"),
    name: formData.get("name"),
    variantConfig: formData.get("variantConfig"),
    startedAt: formData.get("startedAt"),
    endedAt: formData.get("endedAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let experimentId = "";
  await prisma.$transaction(async (tx) => {
    const experiment = await tx.experiment.create({ data: parsed.data });
    experimentId = experiment.id;
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "CREATE",
      entityType: "Experiment",
      entityId: experiment.id,
      after: experiment,
    });
  });

  redirect(`/admin/experiments/${experimentId}`);
}

export async function updateExperiment(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = experimentSchema.safeParse({
    brandId: formData.get("brandId"),
    trackingLinkId: formData.get("trackingLinkId"),
    name: formData.get("name"),
    variantConfig: formData.get("variantConfig"),
    startedAt: formData.get("startedAt"),
    endedAt: formData.get("endedAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.experiment.findUniqueOrThrow({ where: { id } });
    const after = await tx.experiment.update({ where: { id }, data: parsed.data });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "Experiment",
      entityId: id,
      before,
      after,
    });
  });

  redirect(`/admin/experiments/${id}`);
}

async function setExperimentStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  await prisma.$transaction(async (tx) => {
    const before = await tx.experiment.findUniqueOrThrow({ where: { id } });
    const after = await tx.experiment.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "Experiment",
      entityId: id,
      before,
      after,
    });
  });

  redirect("/admin/experiments");
}

export async function archiveExperiment(formData: FormData): Promise<void> {
  await setExperimentStatus(formData, "ARCHIVED");
}

export async function unarchiveExperiment(formData: FormData): Promise<void> {
  await setExperimentStatus(formData, "ACTIVE");
}

// --- Experiment arms -------------------------------------------------------

const armSchema = z.object({
  experimentId: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name is required."),
  trackingLinkVersionId: z.string().trim().optional().transform((v) => (v ? v : null)),
  weight: z.coerce.number().int().min(0, "Weight must be zero or greater."),
});

export async function createExperimentArm(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = armSchema.safeParse({
    experimentId: formData.get("experimentId"),
    name: formData.get("name"),
    trackingLinkVersionId: formData.get("trackingLinkVersionId"),
    weight: formData.get("weight"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const arm = await tx.experimentArm.create({ data: parsed.data });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "ExperimentArm",
        entityId: arm.id,
        after: arm,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "An arm with that name already exists for this experiment." };
    }
    throw error;
  }

  redirect(`/admin/experiments/${parsed.data.experimentId}`);
}

async function setExperimentArmStatus(formData: FormData, status: "ACTIVE" | "ARCHIVED") {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  const arm = await prisma.$transaction(async (tx) => {
    const before = await tx.experimentArm.findUniqueOrThrow({ where: { id } });
    const after = await tx.experimentArm.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: status === "ARCHIVED" ? "ARCHIVE" : "UNARCHIVE",
      entityType: "ExperimentArm",
      entityId: id,
      before,
      after,
    });
    return after;
  });

  redirect(`/admin/experiments/${arm.experimentId}`);
}

export async function archiveExperimentArm(formData: FormData): Promise<void> {
  await setExperimentArmStatus(formData, "ARCHIVED");
}

export async function unarchiveExperimentArm(formData: FormData): Promise<void> {
  await setExperimentArmStatus(formData, "ACTIVE");
}
