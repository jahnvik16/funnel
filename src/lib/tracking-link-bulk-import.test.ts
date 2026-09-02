// Integration tests against the real local Postgres (see docker-compose.yml).
try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. CI with vars injected directly) — fine.
}

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { importTrackingLinksCsv } from "./tracking-link-bulk-import";

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

async function makeValidatedBot(brandId: string) {
  const bot = await prisma.telegramBot.create({
    data: { brandId, name: unique("Bot"), botTokenCiphertext: "test.ciphertext.value", botUsername: unique("bot") },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: bot.id } }));
  return bot;
}

// Cleans up whatever a successful "created" row leaves behind. The `after`
// hook runs the global `cleanup` array in REVERSE, so this must push in the
// opposite order to the actual teardown sequence it needs (clear
// currentVersionId -> delete version -> delete link -> delete campaign),
// same convention as tracking-link-publishing.test.ts's cleanup for a
// published version.
function trackCreatedRowCleanup(trackingLinkId: string, versionId: string, campaignId: string, campaignIsNew: boolean) {
  if (campaignIsNew) {
    cleanup.push(() => prisma.campaign.delete({ where: { id: campaignId } }));
  }
  cleanup.push(() => prisma.trackingLink.delete({ where: { id: trackingLinkId } }));
  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: trackingLinkId }, data: { currentVersionId: null } }));
}

function buildCsv(header: string[], rows: string[][]): string {
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

const DIRECT_HEADER = [
  "brand_slug",
  "platform_slug",
  "campaign_name",
  "campaign_slug",
  "paybig_url",
  "domain_hostname",
  "tracking_link_label",
  "tracking_link_token",
  "path_type",
  "destination_url",
];

test("a valid direct row creates and publishes a Campaign + Tracking Link", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaignSlug = unique("camp");
  const token = unique("token");

  const csv = buildCsv(DIRECT_HEADER, [
    [
      brand.slug,
      platform.slug,
      "Test Campaign",
      campaignSlug,
      "https://paybig.example/lane/one",
      domain.hostname,
      "Test Link",
      token,
      "direct",
      "https://acme.example/offer",
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.totalRows, 1);
  assert.equal(summary.created, 1);
  assert.equal(summary.campaignsCreated, 1);
  assert.equal(summary.invalid.length, 0);

  const row = summary.rows[0];
  assert.equal(row.status, "created");
  if (row.status !== "created") return;
  trackCreatedRowCleanup(row.trackingLinkId, row.versionId, row.campaignId, true);

  const link = await prisma.trackingLink.findUniqueOrThrow({
    where: { id: row.trackingLinkId },
    include: { currentVersion: true },
  });
  assert.equal(link.currentVersion?.pathType, "DIRECT");
  assert.equal(link.status, "ACTIVE");

  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: row.campaignId } });
  assert.equal(campaign.slug, campaignSlug);
  assert.equal(campaign.paybigUrl, "https://paybig.example/lane/one");
});

test("a valid telegram row requires a validated bot and publishes with campaign.paybigUrl as the snapshot destination", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const bot = await makeValidatedBot(brand.id);
  const campaignSlug = unique("camp");

  const header = [...DIRECT_HEADER, "telegram_bot_name"];
  const csv = buildCsv(header, [
    [
      brand.slug,
      platform.slug,
      "Telegram Campaign",
      campaignSlug,
      "https://paybig.example/lane/tg",
      domain.hostname,
      "Telegram Link",
      unique("token"),
      "telegram",
      "", // no destination_url for telegram rows
      bot.name,
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.created, 1, JSON.stringify(summary.invalid));

  const row = summary.rows[0];
  assert.equal(row.status, "created");
  if (row.status !== "created") return;
  trackCreatedRowCleanup(row.trackingLinkId, row.versionId, row.campaignId, true);

  const version = await prisma.trackingLinkVersion.findUniqueOrThrow({ where: { id: row.versionId } });
  assert.equal(version.pathType, "TELEGRAM");
  const snapshot = version.snapshot as { campaign: { paybigUrl: string } };
  assert.equal(snapshot.campaign.paybigUrl, "https://paybig.example/lane/tg");
});

test("re-importing the same CSV skips rows whose tracking link already exists, without duplicating", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaignSlug = unique("camp");
  const token = unique("token");

  const csv = buildCsv(DIRECT_HEADER, [
    [
      brand.slug,
      platform.slug,
      "Repeat Campaign",
      campaignSlug,
      "https://paybig.example/lane/repeat",
      domain.hostname,
      "Repeat Link",
      token,
      "direct",
      "https://acme.example/offer",
    ],
  ]);

  const first = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(first.created, 1);
  const firstRow = first.rows[0];
  assert.equal(firstRow.status, "created");
  if (firstRow.status === "created") {
    trackCreatedRowCleanup(firstRow.trackingLinkId, firstRow.versionId, firstRow.campaignId, true);
  }

  const second = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(second.created, 0);
  assert.equal(second.skippedExisting, 1);

  const linkCount = await prisma.trackingLink.count({ where: { token, domainId: domain.id } });
  assert.equal(linkCount, 1, "re-importing must never create a second tracking link for the same token/domain");
});

test("a row referencing an existing campaign with a different paybig_url is rejected, not silently overwritten", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaignSlug = unique("camp");

  const existingCampaign = await prisma.campaign.create({
    data: { brandId: brand.id, platformId: platform.id, name: "Existing", slug: campaignSlug, paybigUrl: "https://paybig.example/lane/ORIGINAL" },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: existingCampaign.id } }));

  const csv = buildCsv(DIRECT_HEADER, [
    [
      brand.slug,
      platform.slug,
      "Existing",
      campaignSlug,
      "https://paybig.example/lane/DIFFERENT",
      domain.hostname,
      "New Link",
      unique("token"),
      "direct",
      "https://acme.example/offer",
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.created, 0);
  assert.equal(summary.invalid.length, 1);
  assert.match(summary.invalid[0].reason, /different paybig_url/);

  const campaignAfter = await prisma.campaign.findUniqueOrThrow({ where: { id: existingCampaign.id } });
  assert.equal(campaignAfter.paybigUrl, "https://paybig.example/lane/ORIGINAL", "must never overwrite an existing campaign's paybig_url");

  const linkCount = await prisma.trackingLink.count({ where: { brandId: brand.id } });
  assert.equal(linkCount, 0, "no tracking link should be created when the campaign match is rejected");
});

test("a row referencing an existing campaign with a matching paybig_url reuses it (counted as reused, not created)", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaignSlug = unique("camp");

  const existingCampaign = await prisma.campaign.create({
    data: { brandId: brand.id, platformId: platform.id, name: "Existing", slug: campaignSlug, paybigUrl: "https://paybig.example/lane/same" },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: existingCampaign.id } }));

  const csv = buildCsv(DIRECT_HEADER, [
    [
      brand.slug,
      platform.slug,
      "Existing",
      campaignSlug,
      "https://paybig.example/lane/same",
      domain.hostname,
      "New Link",
      unique("token"),
      "direct",
      "https://acme.example/offer",
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.created, 1);
  assert.equal(summary.campaignsCreated, 0);
  assert.equal(summary.campaignsReused, 1);

  const row = summary.rows[0];
  if (row.status === "created") {
    trackCreatedRowCleanup(row.trackingLinkId, row.versionId, row.campaignId, false);
    assert.equal(row.campaignId, existingCampaign.id);
  } else {
    assert.fail("expected row to be created");
  }
});

test("one invalid row (unknown brand_slug) does not block the other valid rows in the same file", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);

  const csv = buildCsv(DIRECT_HEADER, [
    [
      "no-such-brand-slug",
      platform.slug,
      "Bad Row",
      unique("camp"),
      "https://paybig.example/lane/bad",
      domain.hostname,
      "Bad Link",
      unique("token"),
      "direct",
      "https://acme.example/offer",
    ],
    [
      brand.slug,
      platform.slug,
      "Good Row",
      unique("camp"),
      "https://paybig.example/lane/good",
      domain.hostname,
      "Good Link",
      unique("token"),
      "direct",
      "https://acme.example/offer",
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.totalRows, 2);
  assert.equal(summary.created, 1);
  assert.equal(summary.invalid.length, 1);
  assert.equal(summary.invalid[0].rowNumber, 2); // first data row = row 2 (header is row 1)
  assert.match(summary.invalid[0].reason, /no brand with slug/i);

  const goodRow = summary.rows.find((r) => r.status === "created");
  if (goodRow?.status === "created") {
    trackCreatedRowCleanup(goodRow.trackingLinkId, goodRow.versionId, goodRow.campaignId, true);
  }
});

test("telegram row missing telegram_bot_name, and one referencing an unvalidated bot, are both rejected", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const unvalidatedBot = await prisma.telegramBot.create({
    data: { brandId: brand.id, name: unique("Bot"), botTokenCiphertext: "test.ciphertext.value", botUsername: null },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: unvalidatedBot.id } }));

  const header = [...DIRECT_HEADER, "telegram_bot_name"];
  const csv = buildCsv(header, [
    [
      brand.slug,
      platform.slug,
      "Missing Bot",
      unique("camp"),
      "https://paybig.example/lane/a",
      domain.hostname,
      "Link A",
      unique("token"),
      "telegram",
      "",
      "",
    ],
    [
      brand.slug,
      platform.slug,
      "Unvalidated Bot",
      unique("camp"),
      "https://paybig.example/lane/b",
      domain.hostname,
      "Link B",
      unique("token"),
      "telegram",
      "",
      unvalidatedBot.name,
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.created, 0);
  assert.equal(summary.invalid.length, 2);
  assert.match(summary.invalid[0].reason, /telegram_bot_name is required/);
  assert.match(summary.invalid[1].reason, /hasn't been validated yet/);
});

test("an invalid path_type and an invalid destination_url are both reported with the offending value", async () => {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);

  const csv = buildCsv(DIRECT_HEADER, [
    [
      brand.slug,
      platform.slug,
      "Bad Path Type",
      unique("camp"),
      "https://paybig.example/lane/a",
      domain.hostname,
      "Link A",
      unique("token"),
      "carrier-pigeon",
      "https://acme.example/offer",
    ],
    [
      brand.slug,
      platform.slug,
      "Bad Destination",
      unique("camp"),
      "https://paybig.example/lane/b",
      domain.hostname,
      "Link B",
      unique("token"),
      "direct",
      "not-a-url",
    ],
  ]);

  const summary = await importTrackingLinksCsv(prisma, csv, admin.id);
  assert.equal(summary.created, 0);
  assert.equal(summary.invalid.length, 2);
  assert.match(summary.invalid[0].reason, /Invalid path_type: "carrier-pigeon"/);
  assert.match(summary.invalid[1].reason, /Invalid destination_url: "not-a-url"/);
});
