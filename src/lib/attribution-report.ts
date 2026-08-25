import type { Prisma, PathType, FunnelStepType } from "@prisma/client";

// Framework-independent, same split as lib/tracking-link-publishing.ts and
// lib/public-routing.ts — directly testable against the real dev database.
type Db = Prisma.TransactionClient;

export type ReportFilters = {
  dateFrom?: Date;
  dateTo?: Date;
  brandId?: string;
  platformId?: string;
  campaignId?: string;
  pathType?: PathType;
  socialAccountId?: string;
  experimentId?: string;
  experimentArmId?: string;
};

// Click/FunnelEvent carry real click-level attribution (brand, platform,
// social account, campaign, path type via the resolved version, experiment
// arm). Conversion (from a Paybig CSV keyed only on campaign_slug) carries
// none of that — it only ever joins to Campaign/Brand. A filter on path,
// social account, experiment, or experiment arm therefore narrows the click
// side of the report to a subset that Conversion data cannot be sliced to
// match, so any metric that divides a campaign-wide signup count by that
// narrowed click count would compare mismatched populations. See
// DECISIONS.md D029.
function isSignupAttributionCompatible(filters: ReportFilters): boolean {
  return !filters.pathType && !filters.socialAccountId && !filters.experimentId && !filters.experimentArmId;
}

function buildClickWhere(filters: ReportFilters): Prisma.ClickWhereInput {
  const where: Prisma.ClickWhereInput = {};

  if (filters.dateFrom || filters.dateTo) {
    where.clickedAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.brandId) where.brandId = filters.brandId;
  if (filters.platformId) where.platformId = filters.platformId;
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.socialAccountId) where.socialAccountId = filters.socialAccountId;

  if (filters.pathType || filters.experimentId || filters.experimentArmId) {
    where.trackingLinkVersion = {
      ...(filters.pathType ? { pathType: filters.pathType } : {}),
      ...(filters.experimentArmId
        ? { experimentArms: { some: { id: filters.experimentArmId } } }
        : filters.experimentId
          ? { experimentArms: { some: { experimentId: filters.experimentId } } }
          : {}),
    };
  }

  return where;
}

async function countFunnelEvent(
  db: Db,
  clickWhere: Prisma.ClickWhereInput,
  stepType: FunnelStepType,
): Promise<number> {
  return db.funnelEvent.count({ where: { stepType, click: clickWhere } });
}

// Only the dimensions Conversion data actually has: date range (occurredAt),
// brand, campaign (direct FKs), and platform (via Campaign.platformId, a
// stable attribute of the campaign itself — not derived from any click).
//
// "Signups" means attributed signups, counted separately from
// unmatchedConversions (buildUnmatchedWhere) — a row with no campaign match
// must never be counted in both, so campaignId is always constrained to
// non-null here even when no specific campaign filter is selected.
function buildConversionWhere(filters: ReportFilters): Prisma.ConversionWhereInput {
  const where: Prisma.ConversionWhereInput = {
    campaignId: filters.campaignId ?? { not: null },
  };

  if (filters.dateFrom || filters.dateTo) {
    where.occurredAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.brandId) where.brandId = filters.brandId;
  if (filters.platformId) where.campaign = { platformId: filters.platformId };

  return where;
}

// Unmatched conversions have no campaign and no brand by definition — the
// brand/platform/campaign filters are meaningless against them, so this
// metric only ever respects the date range, deliberately global across
// brands within that window (a data-quality signal, not a per-brand metric).
function buildUnmatchedWhere(filters: ReportFilters): Prisma.ConversionWhereInput {
  const where: Prisma.ConversionWhereInput = { campaignId: null };
  if (filters.dateFrom || filters.dateTo) {
    where.occurredAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  return where;
}

function buildDefaultConversionWhere(filters: ReportFilters): Prisma.ConversionWhereInput {
  const where = buildConversionWhere(filters);
  return {
    ...where,
    campaign: { ...(where.campaign as Prisma.CampaignWhereInput | undefined), isDefault: true },
  };
}

export type AttributionReport = {
  filters: ReportFilters;
  funnel: {
    clicks: number;
    ageGateAccepts: number;
    aggregatorViews: number;
    telegramStarts: number;
    outboundRedirects: number;
    outboundRedirectRate: number | null;
  };
  signupAttribution: {
    // False whenever a path/social-account/experiment/experiment-arm filter
    // is active — the UI must visibly flag the rate metrics as unavailable
    // rather than silently showing a number computed from a granularity the
    // underlying data doesn't support (CLAUDE.md's "critical attribution
    // rule").
    compatible: boolean;
    signups: number;
    signupRatePerClick: number | null;
    signupRatePerOutboundRedirect: number | null;
    unmatchedConversions: number;
    defaultConversions: number;
  };
};

export async function buildAttributionReport(db: Db, filters: ReportFilters): Promise<AttributionReport> {
  const clickWhere = buildClickWhere(filters);

  const [clicks, ageGateAccepts, aggregatorViews, telegramStarts, outboundRedirects] = await Promise.all([
    db.click.count({ where: clickWhere }),
    countFunnelEvent(db, clickWhere, "AGE_GATE_ACCEPTED"),
    countFunnelEvent(db, clickWhere, "AGGREGATOR_VIEWED"),
    countFunnelEvent(db, clickWhere, "TELEGRAM_STARTED"),
    countFunnelEvent(db, clickWhere, "OUTBOUND_PAYBIG_REDIRECTED"),
  ]);

  const compatible = isSignupAttributionCompatible(filters);
  const [signups, unmatchedConversions, defaultConversions] = await Promise.all([
    db.conversion.count({ where: buildConversionWhere(filters) }),
    db.conversion.count({ where: buildUnmatchedWhere(filters) }),
    db.conversion.count({ where: buildDefaultConversionWhere(filters) }),
  ]);

  return {
    filters,
    funnel: {
      clicks,
      ageGateAccepts,
      aggregatorViews,
      telegramStarts,
      outboundRedirects,
      outboundRedirectRate: clicks > 0 ? outboundRedirects / clicks : null,
    },
    signupAttribution: {
      compatible,
      signups,
      signupRatePerClick: compatible && clicks > 0 ? signups / clicks : null,
      signupRatePerOutboundRedirect: compatible && outboundRedirects > 0 ? signups / outboundRedirects : null,
      unmatchedConversions,
      defaultConversions,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-arm experiment report — the "aggregator vs Telegram" dashboard
// ---------------------------------------------------------------------------

export type ExperimentArmRow = {
  armId: string;
  armName: string;
  weight: number;
  status: string;
  // The tracking link/campaign an arm is currently wired to, discovered via
  // whichever TrackingLinkVersion was most recently published with this arm
  // selected (see lib/tracking-link-publishing.ts) — null until an admin has
  // published a version for this arm at least once. V1 is manually assigned
  // (no automatic traffic splitting), so this can legitimately stay null.
  trackingLink: { id: string; label: string; token: string } | null;
  campaign: { id: string; name: string } | null;
  funnel: AttributionReport["funnel"];
  // Campaign-level signups for the campaign this arm's link funnels through
  // — NOT exclusive to this arm. Paybig conversions carry no arm/click
  // attribution (see isSignupAttributionCompatible above), so this is the
  // most precise honest number available: the total signups reported for
  // that campaign, from any tracking link that uses it. If two arms share a
  // campaign, both rows show the same number — it must never be summed
  // across arms. Null when the arm has no assigned campaign yet.
  campaignSignups: number | null;
};

// One row per arm of an experiment, each computed via buildAttributionReport
// scoped to that specific arm (full click/funnel-event precision) plus a
// separate campaign-scoped lookup for the signups figure. Deliberately does
// not attempt to allocate/estimate signups per arm — see CLAUDE.md's
// "critical attribution rule" and DECISIONS.md's entry for this milestone.
export async function buildExperimentArmReport(db: Db, experimentId: string): Promise<ExperimentArmRow[]> {
  const arms = await db.experimentArm.findMany({
    where: { experimentId },
    orderBy: { createdAt: "asc" },
    include: {
      trackingLinkVersion: { include: { trackingLink: true, campaign: true } },
    },
  });

  const rows: ExperimentArmRow[] = [];
  for (const arm of arms) {
    const version = arm.trackingLinkVersion;
    const armReport = await buildAttributionReport(db, { experimentArmId: arm.id });

    let campaignSignups: number | null = null;
    if (version) {
      const campaignReport = await buildAttributionReport(db, { campaignId: version.campaignId });
      campaignSignups = campaignReport.signupAttribution.signups;
    }

    rows.push({
      armId: arm.id,
      armName: arm.name,
      weight: arm.weight,
      status: arm.status,
      trackingLink: version
        ? { id: version.trackingLink.id, label: version.trackingLink.label, token: version.trackingLink.token }
        : null,
      campaign: version ? { id: version.campaign.id, name: version.campaign.name } : null,
      funnel: armReport.funnel,
      campaignSignups,
    });
  }

  return rows;
}
