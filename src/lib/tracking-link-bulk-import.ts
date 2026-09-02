import { PrismaClient, Prisma, PathType, Status } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { parseCsv, type CsvRow } from "@/lib/paybig-import";
import { publishTrackingLinkVersion, type PublishInput } from "@/lib/tracking-link-publishing";

// Bulk-creates Campaigns + Tracking Links (and publishes each one) from a CSV,
// instead of clicking through the admin UI once per row — built for setups
// like a Paybig export covering dozens of brand/platform/campaign
// combinations at once (see docs/funnelcore/BULK_TRACKING_LINK_IMPORT.md).
//
// Deliberately reuses the exact same validated code paths the manual admin
// UI uses (publishTrackingLinkVersion from lib/tracking-link-publishing.ts)
// rather than reimplementing publish rules here — the goal is less manual
// effort, not a second, divergent way to create a tracking link. Every rule
// that applies to a manually-published link (active brand/platform/domain,
// a validated Telegram bot, a real destination URL, etc.) applies here too.
//
// Unlike lib/paybig-import.ts (which takes a Prisma.TransactionClient and
// never opens a transaction of its own, since each conversion row is a
// single independent write), a single row here is several writes — Campaign,
// TrackingLink, TrackingLinkVersion — that must succeed or fail together.
// That needs a real per-row transaction, and Prisma.TransactionClient
// deliberately has no $transaction of its own (no nested transactions), so
// this takes the full PrismaClient and opens one transaction per row itself.

const REQUIRED_COLUMNS = [
  "brand_slug",
  "platform_slug",
  "campaign_name",
  "campaign_slug",
  "paybig_url",
  "domain_hostname",
  "tracking_link_label",
  "tracking_link_token",
  "path_type",
] as const;

const PATH_TYPE_BY_LOWERCASE: Record<string, PathType> = {
  direct: PathType.DIRECT,
  aggregator: PathType.AGGREGATOR,
  telegram: PathType.TELEGRAM,
};

const TRUE_VALUES = new Set(["true", "yes", "1"]);
const FALSE_VALUES = new Set(["false", "no", "0", ""]);

type ParsedRow = {
  brandSlug: string;
  platformSlug: string;
  campaignName: string;
  campaignSlug: string;
  paybigUrl: string;
  domainHostname: string;
  trackingLinkLabel: string;
  trackingLinkToken: string;
  pathType: PathType;
  destinationUrl: string | null;
  telegramBotName: string | null;
  socialAccountHandle: string | null;
  ageGateEnabled: boolean;
  raw: CsvRow;
};

type RowParseResult = { ok: true; data: ParsedRow } | { ok: false; reason: string };

function parseRow(row: CsvRow): RowParseResult {
  const missing = REQUIRED_COLUMNS.filter((col) => !row[col]?.trim());
  if (missing.length > 0) {
    return { ok: false, reason: `Missing required column(s): ${missing.join(", ")}.` };
  }

  const pathTypeRaw = row.path_type.trim().toLowerCase();
  const pathType = PATH_TYPE_BY_LOWERCASE[pathTypeRaw];
  if (!pathType) {
    return { ok: false, reason: `Invalid path_type: "${row.path_type}" (expected direct, aggregator, or telegram).` };
  }

  const destinationUrlRaw = row.destination_url?.trim() || null;
  if (pathType !== PathType.TELEGRAM) {
    if (!destinationUrlRaw) {
      return { ok: false, reason: "destination_url is required for direct/aggregator path types." };
    }
    try {
      new URL(destinationUrlRaw);
    } catch {
      return { ok: false, reason: `Invalid destination_url: "${destinationUrlRaw}".` };
    }
  }

  const telegramBotName = row.telegram_bot_name?.trim() || null;
  if (pathType === PathType.TELEGRAM && !telegramBotName) {
    return { ok: false, reason: "telegram_bot_name is required for the telegram path type." };
  }

  try {
    new URL(row.paybig_url.trim());
  } catch {
    return { ok: false, reason: `Invalid paybig_url: "${row.paybig_url}".` };
  }

  const ageGateRaw = row.age_gate_enabled?.trim().toLowerCase() ?? "";
  let ageGateEnabled: boolean;
  if (TRUE_VALUES.has(ageGateRaw)) {
    ageGateEnabled = true;
  } else if (FALSE_VALUES.has(ageGateRaw)) {
    ageGateEnabled = false;
  } else {
    return { ok: false, reason: `Invalid age_gate_enabled: "${row.age_gate_enabled}" (expected true/false, or blank).` };
  }

  return {
    ok: true,
    data: {
      brandSlug: row.brand_slug.trim(),
      platformSlug: row.platform_slug.trim(),
      campaignName: row.campaign_name.trim(),
      campaignSlug: row.campaign_slug.trim().toLowerCase(),
      paybigUrl: row.paybig_url.trim(),
      domainHostname: row.domain_hostname.trim().toLowerCase(),
      trackingLinkLabel: row.tracking_link_label.trim(),
      trackingLinkToken: row.tracking_link_token.trim(),
      pathType,
      destinationUrl: destinationUrlRaw,
      telegramBotName,
      socialAccountHandle: row.social_account_handle?.trim() || null,
      ageGateEnabled,
      raw: row,
    },
  };
}

export type BulkImportRowResult =
  | {
      rowNumber: number;
      status: "created";
      trackingLinkId: string;
      versionId: string;
      campaignId: string;
      campaignCreated: boolean;
    }
  | { rowNumber: number; status: "skipped_existing"; trackingLinkId: string }
  | { rowNumber: number; status: "invalid"; reason: string };

export type BulkImportSummary = {
  totalRows: number;
  created: number;
  skippedExisting: number;
  campaignsCreated: number;
  campaignsReused: number;
  invalid: { rowNumber: number; reason: string }[];
  rows: BulkImportRowResult[];
};

// One transaction per row, not one for the whole file: a CSV can cover many
// brands, and one bad/misconfigured row (a typo'd slug, an unvalidated bot)
// must never block every other row from importing — same reasoning as
// lib/paybig-import.ts's row-by-row design.
async function importRow(
  db: Prisma.TransactionClient,
  parsed: ParsedRow,
  rowNumber: number,
  actorId: string,
): Promise<BulkImportRowResult> {
  const brand = await db.brand.findUnique({ where: { slug: parsed.brandSlug } });
  if (!brand) return { rowNumber, status: "invalid", reason: `No brand with slug "${parsed.brandSlug}".` };
  if (brand.status !== Status.ACTIVE) {
    return { rowNumber, status: "invalid", reason: `Brand "${parsed.brandSlug}" is archived.` };
  }

  const platform = await db.platform.findUnique({ where: { slug: parsed.platformSlug } });
  if (!platform) return { rowNumber, status: "invalid", reason: `No platform with slug "${parsed.platformSlug}".` };
  if (platform.status !== Status.ACTIVE) {
    return { rowNumber, status: "invalid", reason: `Platform "${parsed.platformSlug}" is archived.` };
  }

  const domain = await db.domain.findUnique({ where: { hostname: parsed.domainHostname } });
  if (!domain) return { rowNumber, status: "invalid", reason: `No domain with hostname "${parsed.domainHostname}".` };
  if (!domain.isActive) {
    return { rowNumber, status: "invalid", reason: `Domain "${parsed.domainHostname}" is inactive.` };
  }
  if (domain.brandId && domain.brandId !== brand.id) {
    return { rowNumber, status: "invalid", reason: `Domain "${parsed.domainHostname}" belongs to a different brand.` };
  }

  let socialAccountId: string | null = null;
  if (parsed.socialAccountHandle) {
    const socialAccount = await db.socialAccount.findFirst({
      where: { brandId: brand.id, platformId: platform.id, handle: parsed.socialAccountHandle },
    });
    if (!socialAccount) {
      return {
        rowNumber,
        status: "invalid",
        reason: `No social account "${parsed.socialAccountHandle}" for this brand/platform.`,
      };
    }
    socialAccountId = socialAccount.id;
  }

  let telegramBotId: string | null = null;
  if (parsed.pathType === PathType.TELEGRAM) {
    const bot = await db.telegramBot.findFirst({
      where: { brandId: brand.id, name: parsed.telegramBotName! },
    });
    if (!bot) {
      return { rowNumber, status: "invalid", reason: `No Telegram bot named "${parsed.telegramBotName}" for this brand.` };
    }
    telegramBotId = bot.id;
    // publishTrackingLinkVersion re-validates bot status/username anyway —
    // this just gives a clearer reason than the generic validation issue
    // would, since "wrong bot name" and "right bot, not validated yet" read
    // very differently to whoever's fixing the CSV.
    if (!bot.botUsername) {
      return {
        rowNumber,
        status: "invalid",
        reason: `Telegram bot "${parsed.telegramBotName}" hasn't been validated yet (no username on file).`,
      };
    }
  }

  // Find-or-create the campaign. An existing campaign is reused, never
  // silently overwritten — if its paybig_url disagrees with the CSV, that's
  // reported as an invalid row rather than guessed at, since overwriting a
  // live campaign's destination from a bulk row is exactly the kind of
  // silent accuracy risk this tool exists to avoid, not introduce.
  let campaign = await db.campaign.findFirst({ where: { brandId: brand.id, slug: parsed.campaignSlug } });
  let campaignCreated = false;
  if (campaign) {
    if (campaign.paybigUrl !== parsed.paybigUrl) {
      return {
        rowNumber,
        status: "invalid",
        reason: `Campaign "${parsed.campaignSlug}" already exists with a different paybig_url — not overwritten. Fix the CSV or update the campaign manually first.`,
      };
    }
    if (campaign.status !== Status.ACTIVE) {
      return { rowNumber, status: "invalid", reason: `Campaign "${parsed.campaignSlug}" is archived.` };
    }
  } else {
    campaign = await db.campaign.create({
      data: {
        brandId: brand.id,
        platformId: platform.id,
        name: parsed.campaignName,
        slug: parsed.campaignSlug,
        paybigUrl: parsed.paybigUrl,
        isDefault: false,
      },
    });
    campaignCreated = true;
    await writeAuditLog(db, {
      actorId,
      action: "CREATE",
      entityType: "Campaign",
      entityId: campaign.id,
      after: campaign,
    });
  }

  const existingLink = await db.trackingLink.findFirst({
    where: { domainId: domain.id, token: parsed.trackingLinkToken },
  });
  if (existingLink) {
    return { rowNumber, status: "skipped_existing", trackingLinkId: existingLink.id };
  }

  const link = await db.trackingLink.create({
    data: {
      label: parsed.trackingLinkLabel,
      token: parsed.trackingLinkToken,
      brandId: brand.id,
      domainId: domain.id,
    },
  });
  await writeAuditLog(db, {
    actorId,
    action: "CREATE",
    entityType: "TrackingLink",
    entityId: link.id,
    after: link,
  });

  const publishInput: PublishInput = {
    trackingLinkId: link.id,
    campaignId: campaign.id,
    socialAccountId,
    pathType: parsed.pathType,
    destinationUrl: parsed.destinationUrl ?? undefined,
    telegramBotId,
    ageGateEnabled: parsed.ageGateEnabled,
    experimentId: null,
    experimentArmId: null,
  };

  // publishTrackingLinkVersionCore re-validates everything from scratch
  // (including the checks already done above) and is the same function the
  // admin UI's Publish button calls — see the module-level comment for why
  // this isn't reimplemented here.
  const result = await publishTrackingLinkVersion(db, publishInput, actorId);
  if (!result.ok) {
    // Re-validation failed for a reason not already caught above (e.g. a
    // token collision that appeared between the check above and here, in a
    // concurrent import). Surface the first issue verbatim rather than a
    // generic message.
    const issue = result.issues[0];
    return {
      rowNumber,
      status: "invalid",
      reason: issue ? `${issue.field}: ${issue.message}` : "Publish validation failed.",
    };
  }

  return {
    rowNumber,
    status: "created",
    trackingLinkId: link.id,
    versionId: result.versionId,
    campaignId: campaign.id,
    campaignCreated,
  };
}

export async function importTrackingLinksCsv(
  db: PrismaClient,
  csvContent: string,
  actorId: string,
): Promise<BulkImportSummary> {
  const { rows } = parseCsv(csvContent);

  const summary: BulkImportSummary = {
    totalRows: rows.length,
    created: 0,
    skippedExisting: 0,
    campaignsCreated: 0,
    campaignsReused: 0,
    invalid: [],
    rows: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-indexing, +1 for the header row
    const parsed = parseRow(rows[i]);
    if (!parsed.ok) {
      summary.invalid.push({ rowNumber, reason: parsed.reason });
      summary.rows.push({ rowNumber, status: "invalid", reason: parsed.reason });
      continue;
    }

    let result: BulkImportRowResult;
    try {
      result = await db.$transaction((tx) => importRow(tx, parsed.data, rowNumber, actorId));
    } catch (error) {
      const reason =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
          ? "A tracking link with this token already exists on this domain."
          : error instanceof Error
            ? error.message
            : "Unexpected error while importing this row.";
      result = { rowNumber, status: "invalid", reason };
    }

    summary.rows.push(result);
    if (result.status === "created") {
      summary.created++;
      if (result.campaignCreated) {
        summary.campaignsCreated++;
      } else {
        summary.campaignsReused++;
      }
    } else if (result.status === "skipped_existing") {
      summary.skippedExisting++;
    } else {
      summary.invalid.push({ rowNumber, reason: result.reason });
    }
  }

  return summary;
}
