"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { Prisma, PathType, LinkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import {
  validateTrackingLinkConfig,
  publishTrackingLinkVersion as publishTrackingLinkVersionCore,
  type ValidationIssue,
} from "@/lib/tracking-link-publishing";

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
      return { error: "That token is already in use on this domain." };
    }
    throw error;
  }

  redirect(`/admin/tracking-links/${linkId}`);
}

const updateLinkSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  domainId: z.string().trim().min(1, "Domain is required."),
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

  try {
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That token is already in use on this domain." };
    }
    throw error;
  }

  redirect(`/admin/tracking-links/${id}`);
}

// --- Lifecycle: Activate / Pause / Archive ---------------------------------

async function setTrackingLinkStatus(
  formData: FormData,
  status: LinkStatus,
  action: "ACTIVATE" | "PAUSE" | "ARCHIVE",
) {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));

  const linkId = await prisma.$transaction(async (tx) => {
    const before = await tx.trackingLink.findUniqueOrThrow({ where: { id } });
    const after = await tx.trackingLink.update({ where: { id }, data: { status } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action,
      entityType: "TrackingLink",
      entityId: id,
      before,
      after,
    });
    return after.id;
  });

  redirect(`/admin/tracking-links/${linkId}`);
}

export async function activateTrackingLink(formData: FormData): Promise<void> {
  await setTrackingLinkStatus(formData, "ACTIVE", "ACTIVATE");
}

export async function pauseTrackingLink(formData: FormData): Promise<void> {
  await setTrackingLinkStatus(formData, "PAUSED", "PAUSE");
}

export async function archiveTrackingLink(formData: FormData): Promise<void> {
  await setTrackingLinkStatus(formData, "ARCHIVED", "ARCHIVE");
}

// --- Validate / Publish -----------------------------------------------------

export type PublishFormState = {
  error?: string;
  issues?: ValidationIssue[];
  validated?: boolean;
};

const publishInputSchema = z.object({
  trackingLinkId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1, "Campaign is required."),
  socialAccountId: z.string().trim().optional(),
  pathType: z.nativeEnum(PathType),
  destinationUrl: z.string().trim().optional(),
  telegramBotId: z.string().trim().optional(),
  startParamTemplate: z.string().trim().optional(),
  ageGateEnabled: z.coerce.boolean().default(false),
  experimentId: z.string().trim().optional(),
  experimentArmId: z.string().trim().optional(),
});

function parsePublishInput(formData: FormData) {
  const parsed = publishInputSchema.safeParse({
    trackingLinkId: formData.get("trackingLinkId"),
    campaignId: formData.get("campaignId"),
    socialAccountId: formData.get("socialAccountId") || undefined,
    pathType: formData.get("pathType"),
    destinationUrl: formData.get("destinationUrl") || undefined,
    telegramBotId: formData.get("telegramBotId") || undefined,
    startParamTemplate: formData.get("startParamTemplate") || undefined,
    ageGateEnabled: formData.get("ageGateEnabled") === "on",
    experimentId: formData.get("experimentId") || undefined,
    experimentArmId: formData.get("experimentArmId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." } as const;
  }
  const d = parsed.data;
  return {
    input: {
      trackingLinkId: d.trackingLinkId,
      campaignId: d.campaignId,
      socialAccountId: d.socialAccountId ?? null,
      pathType: d.pathType,
      destinationUrl: d.destinationUrl,
      telegramBotId: d.telegramBotId ?? null,
      startParamTemplate: d.startParamTemplate,
      ageGateEnabled: d.ageGateEnabled,
      experimentId: d.experimentId ?? null,
      experimentArmId: d.experimentArmId ?? null,
    },
  } as const;
}

export async function validateTrackingLinkVersionInput(
  _prevState: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  await requireAdmin();
  const parsed = parsePublishInput(formData);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  const result = await validateTrackingLinkConfig(prisma, parsed.input);
  return { validated: true, issues: result.issues };
}

export async function publishTrackingLinkVersion(
  _prevState: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const admin = await requireAdmin();
  const parsed = parsePublishInput(formData);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersionCore(tx, parsed.input, admin.id),
  );

  if (!result.ok) {
    return { issues: result.issues };
  }

  redirect(`/admin/tracking-links/${parsed.input.trackingLinkId}`);
}
