import { Prisma, PathType } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";

export type ValidationIssue = { field: string; message: string };

export type PublishInput = {
  trackingLinkId: string;
  campaignId: string;
  socialAccountId: string | null;
  pathType: PathType;
  destinationUrl?: string;
  telegramBotId?: string | null;
  startParamTemplate?: string;
  ageGateEnabled: boolean;
  experimentId: string | null;
  experimentArmId: string | null;
};

// Everything the (future) public route needs to execute this version,
// frozen at publish time. Never contains secrets — no ciphertext, no raw
// Telegram token, no API credentials. See DECISIONS.md D016.
export type TrackingLinkVersionSnapshot = {
  domain: { id: string; hostname: string };
  token: string;
  brand: { id: string; name: string; slug: string };
  platform: { id: string; name: string; slug: string } | null;
  campaign: { id: string; name: string; slug: string; paybigUrl: string };
  socialAccount: { id: string; handle: string } | null;
  pathType: PathType;
  pathConfig: Prisma.JsonValue;
  telegramBot: { id: string; name: string; username: string } | null;
  ageGateEnabled: boolean;
  experiment: { id: string; name: string } | null;
  experimentArm: { id: string; name: string } | null;
};

// A PrismaClient satisfies this structurally, so callers can pass either the
// module-level `prisma` (for a read-only Validate) or a `$transaction`
// callback's `tx` (for Publish, which must write atomically).
type Db = Prisma.TransactionClient;

type LoadedEntities = {
  link: Prisma.TrackingLinkGetPayload<{ include: { brand: true; domain: true } }> | null;
  campaign: Prisma.CampaignGetPayload<{ include: { brand: true; platform: true } }> | null;
  socialAccount: Prisma.SocialAccountGetPayload<object> | null;
  telegramBot: Prisma.TelegramBotGetPayload<object> | null;
  experimentArm: Prisma.ExperimentArmGetPayload<{ include: { experiment: true } }> | null;
};

async function loadAndValidate(
  db: Db,
  input: PublishInput,
): Promise<{ issues: ValidationIssue[]; entities: LoadedEntities }> {
  const issues: ValidationIssue[] = [];

  const link = await db.trackingLink.findUnique({
    where: { id: input.trackingLinkId },
    include: { brand: true, domain: true },
  });

  if (!link) {
    return {
      issues: [{ field: "trackingLinkId", message: "Tracking link not found." }],
      entities: { link: null, campaign: null, socialAccount: null, telegramBot: null, experimentArm: null },
    };
  }

  if (!link.domain.isActive) {
    issues.push({ field: "domainId", message: "This link's domain is inactive." });
  }
  if (link.brand.status !== "ACTIVE") {
    issues.push({ field: "brandId", message: "This link's brand is archived." });
  }
  if (link.status === "ARCHIVED") {
    issues.push({ field: "status", message: "This tracking link is archived; activate it before publishing." });
  }
  const tokenConflict = await db.trackingLink.findFirst({
    where: { domainId: link.domainId, token: link.token, id: { not: link.id } },
  });
  if (tokenConflict) {
    issues.push({ field: "token", message: "Another tracking link already uses this token on this domain." });
  }

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    include: { brand: true, platform: true },
  });
  if (!campaign) {
    issues.push({ field: "campaignId", message: "Campaign not found." });
  } else {
    if (campaign.status !== "ACTIVE") {
      issues.push({ field: "campaignId", message: "Campaign is archived." });
    }
    if (!campaign.paybigUrl.trim()) {
      issues.push({ field: "campaignId", message: "Campaign has no Paybig destination configured." });
    }
    if (campaign.brandId !== link.brandId) {
      issues.push({ field: "campaignId", message: "Campaign belongs to a different brand than this tracking link." });
    }
    if (campaign.platform.status !== "ACTIVE") {
      issues.push({ field: "campaignId", message: "Campaign's platform is archived." });
    }
  }

  let socialAccount: LoadedEntities["socialAccount"] = null;
  if (input.socialAccountId) {
    socialAccount = await db.socialAccount.findUnique({ where: { id: input.socialAccountId } });
    if (!socialAccount) {
      issues.push({ field: "socialAccountId", message: "Social account not found." });
    } else {
      if (socialAccount.status !== "ACTIVE") {
        issues.push({ field: "socialAccountId", message: "Social account is archived." });
      }
      if (socialAccount.brandId !== link.brandId) {
        issues.push({
          field: "socialAccountId",
          message: "Social account belongs to a different brand than this tracking link.",
        });
      }
      if (campaign && socialAccount.platformId !== campaign.platformId) {
        issues.push({
          field: "socialAccountId",
          message: "Social account's platform doesn't match the campaign's platform.",
        });
      }
    }
  }

  if (input.pathType === PathType.DIRECT || input.pathType === PathType.AGGREGATOR) {
    const url = input.destinationUrl;
    let validUrl = false;
    if (url) {
      try {
        new URL(url);
        validUrl = true;
      } catch {
        validUrl = false;
      }
    }
    if (!validUrl) {
      issues.push({ field: "destinationUrl", message: "A valid destination URL is required for this path type." });
    }
  } else if (input.pathType === PathType.TELEGRAM) {
    // handled below, needs the fetched bot
  } else {
    issues.push({ field: "pathType", message: "Unsupported path type." });
  }

  let telegramBot: LoadedEntities["telegramBot"] = null;
  if (input.pathType === PathType.TELEGRAM) {
    if (!input.telegramBotId) {
      issues.push({ field: "telegramBotId", message: "A Telegram bot is required for the Telegram path type." });
    } else {
      telegramBot = await db.telegramBot.findUnique({ where: { id: input.telegramBotId } });
      if (!telegramBot) {
        issues.push({ field: "telegramBotId", message: "Telegram bot not found." });
      } else {
        if (telegramBot.status !== "ACTIVE") {
          issues.push({ field: "telegramBotId", message: "Telegram bot is archived." });
        }
        if (telegramBot.brandId !== link.brandId) {
          issues.push({
            field: "telegramBotId",
            message: "Telegram bot belongs to a different brand than this tracking link.",
          });
        }
        if (!telegramBot.botUsername) {
          issues.push({
            field: "telegramBotId",
            message: "Telegram bot has not been validated yet (no username on file). Validate it first.",
          });
        }
      }
    }
  }

  let experimentArm: LoadedEntities["experimentArm"] = null;
  if (input.experimentArmId) {
    experimentArm = await db.experimentArm.findUnique({
      where: { id: input.experimentArmId },
      include: { experiment: true },
    });
    if (!experimentArm) {
      issues.push({ field: "experimentArmId", message: "Experiment arm not found." });
    } else {
      if (experimentArm.status !== "ACTIVE") {
        issues.push({ field: "experimentArmId", message: "Experiment arm is archived." });
      }
      if (experimentArm.experiment.status !== "ACTIVE") {
        issues.push({ field: "experimentArmId", message: "Experiment is archived." });
      }
      if (input.experimentId && experimentArm.experimentId !== input.experimentId) {
        issues.push({
          field: "experimentArmId",
          message: "The selected arm does not belong to the selected experiment.",
        });
      }
      if (experimentArm.experiment.trackingLinkId && experimentArm.experiment.trackingLinkId !== link.id) {
        issues.push({
          field: "experimentArmId",
          message: "This experiment is not associated with this tracking link.",
        });
      }
    }
  }

  return { issues, entities: { link, campaign, socialAccount, telegramBot, experimentArm } };
}

export async function validateTrackingLinkConfig(
  db: Db,
  input: PublishInput,
): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
  const { issues } = await loadAndValidate(db, input);
  return { valid: issues.length === 0, issues };
}

function buildPathConfig(input: PublishInput): Prisma.InputJsonValue {
  return input.pathType === PathType.TELEGRAM
    ? { startParamTemplate: input.startParamTemplate ?? null }
    : { destinationUrl: input.destinationUrl };
}

function buildSnapshot(
  input: PublishInput,
  entities: LoadedEntities,
  pathConfig: Prisma.InputJsonValue,
): TrackingLinkVersionSnapshot {
  const link = entities.link!;
  const campaign = entities.campaign!;

  return {
    domain: { id: link.domain.id, hostname: link.domain.hostname },
    token: link.token,
    brand: { id: link.brand.id, name: link.brand.name, slug: link.brand.slug },
    platform: { id: campaign.platform.id, name: campaign.platform.name, slug: campaign.platform.slug },
    campaign: { id: campaign.id, name: campaign.name, slug: campaign.slug, paybigUrl: campaign.paybigUrl },
    socialAccount: entities.socialAccount
      ? { id: entities.socialAccount.id, handle: entities.socialAccount.handle }
      : null,
    pathType: input.pathType,
    pathConfig: pathConfig as Prisma.JsonValue,
    // botUsername is guaranteed non-null here — publishing a TELEGRAM version
    // with an unvalidated bot is rejected above.
    telegramBot: entities.telegramBot
      ? { id: entities.telegramBot.id, name: entities.telegramBot.name, username: entities.telegramBot.botUsername! }
      : null,
    ageGateEnabled: input.ageGateEnabled,
    experiment: entities.experimentArm
      ? { id: entities.experimentArm.experiment.id, name: entities.experimentArm.experiment.name }
      : null,
    experimentArm: entities.experimentArm
      ? { id: entities.experimentArm.id, name: entities.experimentArm.name }
      : null,
  };
}

export type PublishResult =
  | { ok: true; versionId: string }
  | { ok: false; issues: ValidationIssue[] };

// Must be called with a transaction client — it validates, then (only if
// valid) creates the immutable version, points the link at it, activates the
// link, links the chosen experiment arm, and writes the audit log(s), all
// atomically. See ARCHITECTURE.md §5 and CLAUDE.md rule 5.
export async function publishTrackingLinkVersion(
  tx: Db,
  input: PublishInput,
  publishedById: string,
): Promise<PublishResult> {
  const { issues, entities } = await loadAndValidate(tx, input);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const link = entities.link!;
  const pathConfig = buildPathConfig(input);
  const snapshot = buildSnapshot(input, entities, pathConfig);

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
      pathType: input.pathType,
      campaignId: input.campaignId,
      socialAccountId: input.socialAccountId,
      telegramBotId: input.pathType === PathType.TELEGRAM ? input.telegramBotId : null,
      ageGateEnabled: input.ageGateEnabled,
      pathConfig,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      publishedById,
    },
  });

  const linkBefore = link;
  const linkAfter = await tx.trackingLink.update({
    where: { id: link.id },
    data: { currentVersionId: version.id, status: "ACTIVE" },
  });

  await writeAuditLog(tx, {
    actorId: publishedById,
    action: "PUBLISH",
    entityType: "TrackingLink",
    entityId: link.id,
    before: linkBefore,
    after: { ...linkAfter, publishedVersionId: version.id, versionNumber },
  });

  if (input.experimentArmId) {
    const armBefore = entities.experimentArm!;
    const armAfter = await tx.experimentArm.update({
      where: { id: input.experimentArmId },
      data: { trackingLinkVersionId: version.id },
    });
    await writeAuditLog(tx, {
      actorId: publishedById,
      action: "UPDATE",
      entityType: "ExperimentArm",
      entityId: input.experimentArmId,
      before: armBefore,
      after: armAfter,
    });
  }

  return { ok: true, versionId: version.id };
}
