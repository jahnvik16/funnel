"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma, PathType, LinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";

export type FormState = { error?: string };

const createLinkSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{4,64}$/, "Token must be 4-64 URL-safe characters (letters, numbers, - or _)."),
  brandId: z.string().trim().min(1, "Brand is required."),
  domainId: z.string().trim().min(1, "Domain is required."),
});

async function assertDomainMatchesBrand(domainId: string, brandId: string) {
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id: domainId } });
  if (domain.brandId && domain.brandId !== brandId) {
    throw new Error("That domain belongs to a different brand.");
  }
}

export async function createTrackingLink(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = createLinkSchema.safeParse({
    label: formData.get("label"),
    token: formData.get("token"),
    brandId: formData.get("brandId"),
    domainId: formData.get("domainId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await assertDomainMatchesBrand(parsed.data.domainId, parsed.data.brandId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid domain." };
  }

  let linkId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const link = await tx.trackingLink.create({ data: parsed.data });
      linkId = link.id;
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "CREATE",
        entityType: "TrackingLink",
        entityId: link.id,
        after: link,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That token is already in use." };
    }
    throw error;
  }

  redirect(`/admin/tracking-links/${linkId}`);
}

const updateLinkSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  domainId: z.string().trim().min(1, "Domain is required."),
  status: z.nativeEnum(LinkStatus),
});

export async function updateTrackingLinkDetails(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const parsed = updateLinkSchema.safeParse({
    label: formData.get("label"),
    domainId: formData.get("domainId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const before = await prisma.trackingLink.findUniqueOrThrow({ where: { id } });

  try {
    await assertDomainMatchesBrand(parsed.data.domainId, before.brandId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid domain." };
  }

  await prisma.$transaction(async (tx) => {
    const after = await tx.trackingLink.update({ where: { id }, data: parsed.data });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "TrackingLink",
      entityId: id,
      before,
      after,
    });
  });

  redirect(`/admin/tracking-links/${id}`);
}

const publishSchema = z
  .object({
    trackingLinkId: z.string().trim().min(1),
    campaignId: z.string().trim().min(1, "Campaign is required."),
    socialAccountId: z.string().trim().optional().transform((v) => (v ? v : null)),
    pathType: z.nativeEnum(PathType),
    destinationUrl: z.string().trim().optional(),
    telegramBotId: z.string().trim().optional(),
    startParamTemplate: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    ageGateEnabled: z.coerce.boolean().default(false),
    experimentArmId: z.string().trim().optional().transform((v) => (v ? v : null)),
  })
  .superRefine((data, ctx) => {
    if (data.pathType === PathType.DIRECT || data.pathType === PathType.AGGREGATOR) {
      if (!data.destinationUrl || !z.string().url().safeParse(data.destinationUrl).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A valid destination URL is required for this path type.",
          path: ["destinationUrl"],
        });
      }
    } else if (data.pathType === PathType.TELEGRAM) {
      if (!data.telegramBotId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A Telegram bot is required for the Telegram path type.",
          path: ["telegramBotId"],
        });
      }
    }
  });

export async function publishTrackingLinkVersion(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = publishSchema.safeParse({
    trackingLinkId: formData.get("trackingLinkId"),
    campaignId: formData.get("campaignId"),
    socialAccountId: formData.get("socialAccountId") || undefined,
    pathType: formData.get("pathType"),
    destinationUrl: formData.get("destinationUrl") || undefined,
    telegramBotId: formData.get("telegramBotId") || undefined,
    startParamTemplate: formData.get("startParamTemplate") || undefined,
    ageGateEnabled: formData.get("ageGateEnabled") === "on",
    experimentArmId: formData.get("experimentArmId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const isTelegram = data.pathType === PathType.TELEGRAM;
  const pathConfig: Prisma.InputJsonValue = isTelegram
    ? { startParamTemplate: data.startParamTemplate ?? null }
    : { destinationUrl: data.destinationUrl };

  await prisma.$transaction(async (tx) => {
    const link = await tx.trackingLink.findUniqueOrThrow({ where: { id: data.trackingLinkId } });

    const lastVersion = await tx.trackingLinkVersion.findFirst({
      where: { trackingLinkId: link.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const version = await tx.trackingLinkVersion.create({
      data: {
        trackingLinkId: link.id,
        versionNumber,
        pathType: data.pathType,
        campaignId: data.campaignId,
        socialAccountId: data.socialAccountId,
        telegramBotId: isTelegram ? data.telegramBotId : null,
        ageGateEnabled: data.ageGateEnabled,
        pathConfig,
        publishedById: admin.id,
      },
    });

    const linkAfter = await tx.trackingLink.update({
      where: { id: link.id },
      data: { currentVersionId: version.id },
    });

    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "PUBLISH",
      entityType: "TrackingLink",
      entityId: link.id,
      before: link,
      after: { ...linkAfter, publishedVersion: version },
    });

    if (data.experimentArmId) {
      const armBefore = await tx.experimentArm.findUniqueOrThrow({ where: { id: data.experimentArmId } });
      const armAfter = await tx.experimentArm.update({
        where: { id: data.experimentArmId },
        data: { trackingLinkVersionId: version.id },
      });
      await writeAuditLog(tx, {
        actorId: admin.id,
        action: "UPDATE",
        entityType: "ExperimentArm",
        entityId: data.experimentArmId,
        before: armBefore,
        after: armAfter,
      });
    }
  });

  redirect(`/admin/tracking-links/${data.trackingLinkId}`);
}
