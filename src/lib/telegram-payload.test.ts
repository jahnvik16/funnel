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
import { publishTrackingLinkVersion } from "./tracking-link-publishing";
import { createTelegramStartPayload, resolveTelegramStartPayload } from "./telegram-payload";

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

async function makeCampaign(brandId: string, platformId: string) {
  const campaign = await prisma.campaign.create({
    data: { brandId, platformId, name: unique("Campaign"), slug: unique("campaign"), paybigUrl: "https://paybig.example/lane/x" },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: campaign.id } }));
  return campaign;
}

async function makeTelegramBot(brandId: string) {
  const bot = await prisma.telegramBot.create({
    data: { brandId, name: unique("Bot"), botTokenCiphertext: "test.ciphertext.value", botUsername: unique("bot") },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: bot.id } }));
  return bot;
}

async function deleteClick(clickId: string) {
  await prisma.funnelEvent.deleteMany({ where: { clickId } });
  await prisma.telegramStartPayload.deleteMany({ where: { clickId } });
  await prisma.click.delete({ where: { id: clickId } });
}

async function setupFixture() {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaign = await makeCampaign(brand.id, platform.id);
  const bot = await makeTelegramBot(brand.id);
  const link = await prisma.trackingLink.create({
    data: { label: unique("Link"), token: unique("token"), brandId: brand.id, domainId: domain.id },
  });
  cleanup.push(() => prisma.trackingLink.delete({ where: { id: link.id } }));

  const publishResult = await prisma.$transaction((tx) =>
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
  assert.equal(publishResult.ok, true, "test fixture publish should succeed");
  if (!publishResult.ok) throw new Error("unreachable");
  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: publishResult.versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: link.id }, data: { currentVersionId: null } }));

  const click = await prisma.click.create({
    data: {
      trackingLinkId: link.id,
      trackingLinkVersionId: publishResult.versionId,
      brandId: brand.id,
      campaignId: campaign.id,
    },
  });
  cleanup.push(() => deleteClick(click.id));

  return { admin, brand, platform, domain, campaign, bot, link, versionId: publishResult.versionId, click };
}

test("createTelegramStartPayload mints an opaque, short-lived token", async () => {
  const { click, bot } = await setupFixture();

  const before = Date.now();
  const { payloadToken, expiresAt } = await createTelegramStartPayload(prisma, click.id, bot.id);

  assert.ok(payloadToken.length >= 16);
  assert.doesNotMatch(payloadToken, /[^A-Za-z0-9_-]/, "payload token must be URL-safe");
  // ~15 minute TTL, generous bounds to avoid flakiness.
  const ttlMs = expiresAt.getTime() - before;
  assert.ok(ttlMs > 10 * 60 * 1000 && ttlMs < 20 * 60 * 1000, `unexpected TTL: ${ttlMs}ms`);

  const row = await prisma.telegramStartPayload.findUniqueOrThrow({ where: { payloadToken } });
  assert.equal(row.clickId, click.id);
  assert.equal(row.telegramBotId, bot.id);
  assert.equal(row.consumedAt, null);
});

test("resolveTelegramStartPayload preserves attribution: click_id, tracking_link_id, tracking_link_version_id, campaign_id", async () => {
  const { click, bot, link, versionId, campaign } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  const resolution = await resolveTelegramStartPayload(prisma, payloadToken);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.alreadyConsumed, false);
  assert.equal(resolution.payload.clickId, click.id);
  assert.equal(resolution.payload.trackingLinkId, link.id);
  assert.equal(resolution.payload.trackingLinkVersionId, versionId);
  assert.equal(resolution.payload.campaignId, campaign.id);
  assert.equal(resolution.payload.experimentArmId, null);
  assert.equal(resolution.payload.snapshot.pathType, "TELEGRAM");
});

test("resolveTelegramStartPayload resolves experiment_arm_id when an arm is attached to the version", async () => {
  const { click, bot, link, versionId, brand } = await setupFixture();
  const experiment = await prisma.experiment.create({
    data: { brandId: brand.id, trackingLinkId: link.id, name: unique("Experiment") },
  });
  cleanup.push(() => prisma.experiment.delete({ where: { id: experiment.id } }));
  const arm = await prisma.experimentArm.create({
    data: { experimentId: experiment.id, name: "control", weight: 100, trackingLinkVersionId: versionId },
  });
  cleanup.push(() =>
    prisma.experimentArm.update({ where: { id: arm.id }, data: { trackingLinkVersionId: null } }).then(() =>
      prisma.experimentArm.delete({ where: { id: arm.id } }),
    ),
  );

  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);
  const resolution = await resolveTelegramStartPayload(prisma, payloadToken);
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;
  assert.equal(resolution.payload.experimentArmId, arm.id);
});

test("resolveTelegramStartPayload returns not_found for an unknown token", async () => {
  const resolution = await resolveTelegramStartPayload(prisma, "nonexistent-payload-token");
  assert.deepEqual(resolution, { ok: false, reason: "not_found" });
});

test("resolveTelegramStartPayload returns expired for a past-due payload", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);
  await prisma.telegramStartPayload.update({
    where: { payloadToken },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const resolution = await resolveTelegramStartPayload(prisma, payloadToken);
  assert.deepEqual(resolution, { ok: false, reason: "expired" });
});

test("resolveTelegramStartPayload is idempotent: resolving twice succeeds both times, second reports alreadyConsumed", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  const first = await resolveTelegramStartPayload(prisma, payloadToken);
  const second = await resolveTelegramStartPayload(prisma, payloadToken);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.alreadyConsumed, false);
  assert.equal(second.alreadyConsumed, true);
  assert.deepEqual(first.payload, second.payload);
});

test("payload token never encodes click/campaign/link ids directly", async () => {
  const { click, bot, link, campaign } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  for (const id of [click.id, link.id, campaign.id]) {
    assert.ok(!payloadToken.includes(id), `payload token unexpectedly embeds id ${id}`);
  }
});
