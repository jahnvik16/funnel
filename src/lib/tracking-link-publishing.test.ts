// Integration tests against the real local Postgres (see docker-compose.yml).
// process.loadEnvFile() makes DATABASE_URL/ENCRYPTION_KEY available the same
// way prisma.config.ts does for the CLI — this file isn't run through the
// Prisma CLI, so it has to load .env itself.
try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. CI with vars injected directly) — fine.
}

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { PathType } from "@prisma/client";
import { prisma } from "./prisma";
import { validateTrackingLinkConfig, publishTrackingLinkVersion } from "./tracking-link-publishing";

function unique(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

// Every row created by this suite, tracked so `after` can delete it
// regardless of which tests passed/failed — this suite runs against the
// real dev database, not a throwaway one.
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

async function makeCampaign(brandId: string, platformId: string, paybigUrl: string) {
  const campaign = await prisma.campaign.create({
    data: {
      brandId,
      platformId,
      name: unique("Campaign"),
      slug: unique("campaign"),
      paybigUrl,
    },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: campaign.id } }));
  return campaign;
}

async function makeTrackingLink(brandId: string, domainId: string) {
  const link = await prisma.trackingLink.create({
    data: { label: unique("Link"), token: unique("token"), brandId, domainId },
  });
  cleanup.push(() => prisma.trackingLink.delete({ where: { id: link.id } }));
  return link;
}

async function makeTelegramBot(brandId: string, botUsername: string | null) {
  const bot = await prisma.telegramBot.create({
    data: { brandId, name: unique("Bot"), botTokenCiphertext: "test.ciphertext.value", botUsername },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: bot.id } }));
  return bot;
}

async function setupBasicFixture() {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaign = await makeCampaign(brand.id, platform.id, "https://paybig.example/lane/original");
  const link = await makeTrackingLink(brand.id, domain.id);
  return { admin, brand, platform, domain, campaign, link };
}

test("CRITICAL INVARIANT: editing a campaign's Paybig URL never changes an already-published version's snapshot", async () => {
  const { admin, campaign, link } = await setupBasicFixture();

  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersion(
      tx,
      {
        trackingLinkId: link.id,
        campaignId: campaign.id,
        socialAccountId: null,
        pathType: PathType.DIRECT,
        destinationUrl: "https://acme.example/offer",
        ageGateEnabled: false,
        experimentId: null,
        experimentArmId: null,
      },
      admin.id,
    ),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // `link.currentVersionId` now points at this version, so clear that FK
  // before the version can be deleted, and delete the version before `link`.
  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: result.versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: link.id }, data: { currentVersionId: null } }));

  const versionBefore = await prisma.trackingLinkVersion.findUniqueOrThrow({
    where: { id: result.versionId },
  });
  const snapshotBefore = versionBefore.snapshot as { campaign: { paybigUrl: string } };
  assert.equal(snapshotBefore.campaign.paybigUrl, "https://paybig.example/lane/original");

  // The campaign's Paybig URL changes "tomorrow" ...
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { paybigUrl: "https://paybig.example/lane/CHANGED" },
  });

  // ... the live campaign reflects the change ...
  const campaignAfter = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
  assert.equal(campaignAfter.paybigUrl, "https://paybig.example/lane/CHANGED");

  // ... but the already-published version's frozen snapshot must not.
  const versionAfter = await prisma.trackingLinkVersion.findUniqueOrThrow({
    where: { id: result.versionId },
  });
  const snapshotAfter = versionAfter.snapshot as { campaign: { paybigUrl: string } };
  assert.equal(snapshotAfter.campaign.paybigUrl, "https://paybig.example/lane/original");
  assert.deepEqual(versionAfter.snapshot, versionBefore.snapshot);
});

test("publish is rejected when the campaign is archived", async () => {
  const { admin, campaign, link } = await setupBasicFixture();
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "ARCHIVED" } });

  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersion(
      tx,
      {
        trackingLinkId: link.id,
        campaignId: campaign.id,
        socialAccountId: null,
        pathType: PathType.DIRECT,
        destinationUrl: "https://acme.example/offer",
        ageGateEnabled: false,
        experimentId: null,
        experimentArmId: null,
      },
      admin.id,
    ),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((i) => i.message.includes("Campaign is archived")));

  const versionCount = await prisma.trackingLinkVersion.count({ where: { trackingLinkId: link.id } });
  assert.equal(versionCount, 0, "no version should have been created");
});

test("validation rejects a Telegram path type with no active bot", async () => {
  const { campaign, link } = await setupBasicFixture();

  const result = await validateTrackingLinkConfig(prisma, {
    trackingLinkId: link.id,
    campaignId: campaign.id,
    socialAccountId: null,
    pathType: PathType.TELEGRAM,
    telegramBotId: null,
    ageGateEnabled: false,
    experimentId: null,
    experimentArmId: null,
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.field === "telegramBotId"));
});

test("validation rejects a Telegram bot that hasn't been validated (no username on file)", async () => {
  const { brand, campaign, link } = await setupBasicFixture();
  const bot = await makeTelegramBot(brand.id, null);

  const result = await validateTrackingLinkConfig(prisma, {
    trackingLinkId: link.id,
    campaignId: campaign.id,
    socialAccountId: null,
    pathType: PathType.TELEGRAM,
    telegramBotId: bot.id,
    ageGateEnabled: false,
    experimentId: null,
    experimentArmId: null,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((i) => i.field === "telegramBotId" && i.message.includes("not been validated")),
  );
});

test("publish succeeds for a TELEGRAM path once the bot is validated, and the snapshot carries its username", async () => {
  const { admin, brand, campaign, link } = await setupBasicFixture();
  const bot = await makeTelegramBot(brand.id, "acme_offers_bot");

  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersion(
      tx,
      {
        trackingLinkId: link.id,
        campaignId: campaign.id,
        socialAccountId: null,
        pathType: PathType.TELEGRAM,
        telegramBotId: bot.id,
        ageGateEnabled: false,
        experimentId: null,
        experimentArmId: null,
      },
      admin.id,
    ),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: result.versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: link.id }, data: { currentVersionId: null } }));

  const version = await prisma.trackingLinkVersion.findUniqueOrThrow({ where: { id: result.versionId } });
  const snapshot = version.snapshot as { telegramBot: { id: string; name: string; username: string } | null };
  assert.deepEqual(snapshot.telegramBot, { id: bot.id, name: bot.name, username: "acme_offers_bot" });
});

test("validation rejects a social account whose brand doesn't match the tracking link", async () => {
  const { campaign, link } = await setupBasicFixture();
  const otherBrand = await makeBrand();
  const platform = await makePlatform();
  const otherSocialAccount = await prisma.socialAccount.create({
    data: { brandId: otherBrand.id, platformId: platform.id, handle: unique("@handle") },
  });
  cleanup.push(() => prisma.socialAccount.delete({ where: { id: otherSocialAccount.id } }));

  const result = await validateTrackingLinkConfig(prisma, {
    trackingLinkId: link.id,
    campaignId: campaign.id,
    socialAccountId: otherSocialAccount.id,
    pathType: PathType.DIRECT,
    destinationUrl: "https://acme.example/offer",
    ageGateEnabled: false,
    experimentId: null,
    experimentArmId: null,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((i) => i.field === "socialAccountId" && i.message.includes("different brand")),
  );
});

test("validation rejects an experiment arm that doesn't belong to the selected experiment", async () => {
  const { brand, link } = await setupBasicFixture();
  const campaign2 = await makeCampaign(brand.id, (await makePlatform()).id, "https://paybig.example/lane/x");
  const experimentA = await prisma.experiment.create({
    data: { brandId: brand.id, trackingLinkId: link.id, name: unique("Experiment A") },
  });
  cleanup.push(() => prisma.experiment.delete({ where: { id: experimentA.id } }));
  const experimentB = await prisma.experiment.create({
    data: { brandId: brand.id, trackingLinkId: link.id, name: unique("Experiment B") },
  });
  cleanup.push(() => prisma.experiment.delete({ where: { id: experimentB.id } }));
  const armOfB = await prisma.experimentArm.create({
    data: { experimentId: experimentB.id, name: "control", weight: 50 },
  });
  cleanup.push(() => prisma.experimentArm.delete({ where: { id: armOfB.id } }));

  const result = await validateTrackingLinkConfig(prisma, {
    trackingLinkId: link.id,
    campaignId: campaign2.id,
    socialAccountId: null,
    pathType: PathType.DIRECT,
    destinationUrl: "https://acme.example/offer",
    ageGateEnabled: false,
    experimentId: experimentA.id,
    experimentArmId: armOfB.id,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((i) => i.field === "experimentArmId" && i.message.includes("does not belong")),
  );
});
