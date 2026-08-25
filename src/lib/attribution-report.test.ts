try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. CI with vars injected directly) — fine.
}

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { PathType, type FunnelStepType } from "@prisma/client";
import { prisma } from "./prisma";
import { publishTrackingLinkVersion } from "./tracking-link-publishing";
import { buildAttributionReport } from "./attribution-report";

function unique(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

const cleanup: Array<() => Promise<unknown>> = [];
after(async () => {
  for (const fn of cleanup.reverse()) {
    await fn();
  }
  await prisma.$disconnect();
});

async function makeAdmin() {
  const admin = await prisma.adminUser.create({
    data: { email: `${unique("test-admin")}@example.com`, passwordHash: "test-not-a-real-hash" },
  });
  cleanup.push(() => prisma.adminUser.delete({ where: { id: admin.id } }));
  return admin;
}

async function makeBrand() {
  const brand = await prisma.brand.create({ data: { name: unique("Brand"), slug: unique("brand") } });
  cleanup.push(() => prisma.brand.delete({ where: { id: brand.id } }));
  return brand;
}

async function makePlatform() {
  const platform = await prisma.platform.create({ data: { name: unique("Platform"), slug: unique("platform") } });
  cleanup.push(() => prisma.platform.delete({ where: { id: platform.id } }));
  return platform;
}

async function makeDomain(brandId: string) {
  const domain = await prisma.domain.create({ data: { hostname: `${unique("links")}.example.test`, brandId } });
  cleanup.push(() => prisma.domain.delete({ where: { id: domain.id } }));
  return domain;
}

async function makeCampaign(brandId: string, platformId: string, isDefault = false) {
  const campaign = await prisma.campaign.create({
    data: {
      brandId,
      platformId,
      name: unique("Campaign"),
      slug: unique("campaign"),
      paybigUrl: "https://paybig.example/lane",
      isDefault,
    },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: campaign.id } }));
  return campaign;
}

async function makeSocialAccount(brandId: string, platformId: string) {
  const account = await prisma.socialAccount.create({
    data: { brandId, platformId, handle: unique("@handle") },
  });
  cleanup.push(() => prisma.socialAccount.delete({ where: { id: account.id } }));
  return account;
}

async function makeTrackingLink(brandId: string, domainId: string) {
  const link = await prisma.trackingLink.create({
    data: { label: unique("Link"), token: unique("token"), brandId, domainId },
  });
  cleanup.push(() => prisma.trackingLink.delete({ where: { id: link.id } }));
  return link;
}

async function makeExperiment(brandId: string) {
  const experiment = await prisma.experiment.create({ data: { brandId, name: unique("Experiment") } });
  cleanup.push(() => prisma.experiment.delete({ where: { id: experiment.id } }));
  return experiment;
}

async function makeExperimentArm(experimentId: string) {
  const arm = await prisma.experimentArm.create({
    data: { experimentId, name: unique("Arm"), weight: 50 },
  });
  cleanup.push(() => prisma.experimentArm.delete({ where: { id: arm.id } }));
  return arm;
}

type PublishOverrides = {
  pathType?: PathType;
  socialAccountId?: string | null;
  experimentId?: string | null;
  experimentArmId?: string | null;
};

async function publishVersion(
  adminId: string,
  linkId: string,
  campaignId: string,
  overrides: PublishOverrides = {},
) {
  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersion(
      tx,
      {
        trackingLinkId: linkId,
        campaignId,
        socialAccountId: overrides.socialAccountId ?? null,
        pathType: overrides.pathType ?? PathType.DIRECT,
        destinationUrl: "https://paybig.example/checkout",
        ageGateEnabled: false,
        experimentId: overrides.experimentId ?? null,
        experimentArmId: overrides.experimentArmId ?? null,
      },
      adminId,
    ),
  );
  assert.equal(result.ok, true, "test fixture publish should succeed");
  if (!result.ok) throw new Error("unreachable");

  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: result.versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: linkId }, data: { currentVersionId: null } }));
  if (overrides.experimentArmId) {
    cleanup.push(() =>
      prisma.experimentArm.update({
        where: { id: overrides.experimentArmId! },
        data: { trackingLinkVersionId: null },
      }),
    );
  }
  return result.versionId;
}

async function deleteClick(clickId: string) {
  await prisma.funnelEvent.deleteMany({ where: { clickId } });
  await prisma.click.delete({ where: { id: clickId } });
}

async function makeClick(data: {
  trackingLinkId: string;
  trackingLinkVersionId: string;
  brandId: string;
  platformId?: string | null;
  socialAccountId?: string | null;
  campaignId?: string | null;
  clickedAt: Date;
}) {
  const click = await prisma.click.create({
    data: {
      trackingLinkId: data.trackingLinkId,
      trackingLinkVersionId: data.trackingLinkVersionId,
      brandId: data.brandId,
      platformId: data.platformId ?? null,
      socialAccountId: data.socialAccountId ?? null,
      campaignId: data.campaignId ?? null,
      clickedAt: data.clickedAt,
    },
  });
  cleanup.push(() => deleteClick(click.id));
  return click;
}

async function addEvent(clickId: string, stepType: FunnelStepType) {
  await prisma.funnelEvent.create({ data: { clickId, stepType } });
}

// A distinctive far-future window so this suite's rows are trivially
// separable from anything else running against the same shared dev database
// (see the "unmatched conversions ignores brand/campaign filters" case,
// which can't scope itself down to this fixture's brand/campaign ids).
const WINDOW_START = new Date("2031-06-14T00:00:00Z");
const WINDOW_MID = new Date("2031-06-15T00:00:00Z");
const WINDOW_END = new Date("2031-06-16T00:00:00Z");

async function deleteConversion(paybigConversionId: string) {
  await prisma.conversion.deleteMany({ where: { paybigConversionId } });
}

test("buildAttributionReport: click/funnel metrics respect filter granularity; signup metrics respect the campaign-level ceiling", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaign = await makeCampaign(brand.id, platform.id);
  const defaultCampaign = await makeCampaign(brand.id, platform.id, true);
  const socialAccount = await makeSocialAccount(brand.id, platform.id);
  const experiment = await makeExperiment(brand.id);
  const arm = await makeExperimentArm(experiment.id);

  const directLink = await makeTrackingLink(brand.id, domain.id);
  const directVersionId = await publishVersion(admin.id, directLink.id, campaign.id, {
    pathType: PathType.DIRECT,
    socialAccountId: socialAccount.id,
  });

  const aggregatorLink = await makeTrackingLink(brand.id, domain.id);
  const aggregatorVersionId = await publishVersion(admin.id, aggregatorLink.id, campaign.id, {
    pathType: PathType.AGGREGATOR,
    experimentId: experiment.id,
    experimentArmId: arm.id,
  });

  // Click 1: DIRECT path, tagged with the social account, age-gate accepted,
  // then an outbound redirect.
  const click1 = await makeClick({
    trackingLinkId: directLink.id,
    trackingLinkVersionId: directVersionId,
    brandId: brand.id,
    platformId: platform.id,
    socialAccountId: socialAccount.id,
    campaignId: campaign.id,
    clickedAt: WINDOW_MID,
  });
  await addEvent(click1.id, "AGE_GATE_ACCEPTED");
  await addEvent(click1.id, "OUTBOUND_PAYBIG_REDIRECTED");

  // Click 2: AGGREGATOR path, in the experiment arm, no social account,
  // viewed the aggregator page then redirected out.
  const click2 = await makeClick({
    trackingLinkId: aggregatorLink.id,
    trackingLinkVersionId: aggregatorVersionId,
    brandId: brand.id,
    platformId: platform.id,
    campaignId: campaign.id,
    clickedAt: WINDOW_MID,
  });
  await addEvent(click2.id, "AGGREGATOR_VIEWED");
  await addEvent(click2.id, "OUTBOUND_PAYBIG_REDIRECTED");

  // Conversions: one attributed to the real campaign, one landing on the
  // brand's default/catch-all campaign, one unmatched entirely.
  const matchedConvId = unique("conv-matched");
  const defaultConvId = unique("conv-default");
  const unmatchedConvId = unique("conv-unmatched");
  cleanup.push(() => deleteConversion(matchedConvId));
  cleanup.push(() => deleteConversion(defaultConvId));
  cleanup.push(() => deleteConversion(unmatchedConvId));

  await prisma.conversion.create({
    data: {
      paybigConversionId: matchedConvId,
      campaignId: campaign.id,
      brandId: brand.id,
      amount: "10.00",
      currency: "USD",
      occurredAt: WINDOW_MID,
      rawPayload: {},
    },
  });
  await prisma.conversion.create({
    data: {
      paybigConversionId: defaultConvId,
      campaignId: defaultCampaign.id,
      brandId: brand.id,
      amount: "5.00",
      currency: "USD",
      occurredAt: WINDOW_MID,
      rawPayload: {},
    },
  });
  await prisma.conversion.create({
    data: {
      paybigConversionId: unmatchedConvId,
      campaignId: null,
      brandId: null,
      amount: "1.00",
      currency: "USD",
      occurredAt: WINDOW_MID,
      rawPayload: {},
    },
  });

  // --- Unfiltered-by-path baseline, scoped to this fixture's campaign ---
  const baseline = await buildAttributionReport(prisma, { campaignId: campaign.id });
  assert.equal(baseline.funnel.clicks, 2);
  assert.equal(baseline.funnel.ageGateAccepts, 1);
  assert.equal(baseline.funnel.aggregatorViews, 1);
  assert.equal(baseline.funnel.telegramStarts, 0);
  assert.equal(baseline.funnel.outboundRedirects, 2);
  assert.equal(baseline.funnel.outboundRedirectRate, 1);
  assert.equal(baseline.signupAttribution.compatible, true);
  assert.equal(baseline.signupAttribution.signups, 1);
  assert.equal(baseline.signupAttribution.signupRatePerClick, 0.5);
  assert.equal(baseline.signupAttribution.signupRatePerOutboundRedirect, 0.5);

  // --- Narrowing by social account isolates click 1 only ---
  const bySocial = await buildAttributionReport(prisma, {
    campaignId: campaign.id,
    socialAccountId: socialAccount.id,
  });
  assert.equal(bySocial.funnel.clicks, 1);
  assert.equal(bySocial.funnel.ageGateAccepts, 1);
  assert.equal(bySocial.funnel.aggregatorViews, 0);
  assert.equal(bySocial.signupAttribution.compatible, false, "social-account filter breaks signup-rate compatibility");
  assert.equal(bySocial.signupAttribution.signups, 1, "signups are still reported at the campaign level");
  assert.equal(bySocial.signupAttribution.signupRatePerClick, null);
  assert.equal(bySocial.signupAttribution.signupRatePerOutboundRedirect, null);

  // --- Narrowing by path type isolates click 2 only ---
  const byPath = await buildAttributionReport(prisma, {
    campaignId: campaign.id,
    pathType: PathType.AGGREGATOR,
  });
  assert.equal(byPath.funnel.clicks, 1);
  assert.equal(byPath.funnel.aggregatorViews, 1);
  assert.equal(byPath.funnel.ageGateAccepts, 0);
  assert.equal(byPath.signupAttribution.compatible, false);

  // --- Narrowing by experiment / experiment arm isolates click 2 only ---
  const byExperiment = await buildAttributionReport(prisma, {
    campaignId: campaign.id,
    experimentId: experiment.id,
  });
  assert.equal(byExperiment.funnel.clicks, 1);
  assert.equal(byExperiment.funnel.aggregatorViews, 1);
  assert.equal(byExperiment.signupAttribution.compatible, false);

  const byArm = await buildAttributionReport(prisma, {
    campaignId: campaign.id,
    experimentArmId: arm.id,
  });
  assert.equal(byArm.funnel.clicks, 1);
  assert.equal(byArm.funnel.aggregatorViews, 1);

  // --- Brand/platform-only filters remain signup-compatible ---
  const byBrandPlatform = await buildAttributionReport(prisma, {
    campaignId: campaign.id,
    brandId: brand.id,
    platformId: platform.id,
  });
  assert.equal(byBrandPlatform.signupAttribution.compatible, true);
  assert.equal(byBrandPlatform.signupAttribution.signups, 1);

  // --- Default/catch-all conversions counted separately from the named campaign ---
  const defaultReport = await buildAttributionReport(prisma, { campaignId: defaultCampaign.id });
  assert.equal(defaultReport.signupAttribution.signups, 1);
  assert.equal(defaultReport.signupAttribution.defaultConversions, 1);

  const namedReport = await buildAttributionReport(prisma, { campaignId: campaign.id });
  assert.equal(namedReport.signupAttribution.defaultConversions, 0);

  // --- Unmatched conversions: date-range scoped, ignores brand/campaign filters ---
  const unmatchedReport = await buildAttributionReport(prisma, {
    dateFrom: WINDOW_START,
    dateTo: WINDOW_END,
    campaignId: campaign.id, // deliberately irrelevant to the unmatched count
  });
  assert.equal(unmatchedReport.signupAttribution.unmatchedConversions, 1);

  const outsideWindow = await buildAttributionReport(prisma, {
    dateFrom: new Date("2031-01-01T00:00:00Z"),
    dateTo: new Date("2031-01-02T00:00:00Z"),
    campaignId: campaign.id,
  });
  assert.equal(outsideWindow.signupAttribution.unmatchedConversions, 0);
  assert.equal(outsideWindow.funnel.clicks, 0);
  assert.equal(outsideWindow.funnel.outboundRedirectRate, null);

  // --- Signups must never double-count an unmatched conversion: with no
  // campaign filter selected, the unmatched row must be excluded from
  // "signups" entirely (it's already reported separately above).
  const dateOnlyReport = await buildAttributionReport(prisma, {
    dateFrom: WINDOW_START,
    dateTo: WINDOW_END,
  });
  assert.equal(dateOnlyReport.signupAttribution.signups, 2);
  assert.equal(dateOnlyReport.signupAttribution.unmatchedConversions, 1);
});

test("buildAttributionReport returns zeros and null rates for filters matching nothing", async () => {
  const report = await buildAttributionReport(prisma, { campaignId: "does-not-exist" });
  assert.equal(report.funnel.clicks, 0);
  assert.equal(report.funnel.outboundRedirectRate, null);
  assert.equal(report.signupAttribution.signups, 0);
  assert.equal(report.signupAttribution.signupRatePerClick, null);
  assert.equal(report.signupAttribution.compatible, true);
});
