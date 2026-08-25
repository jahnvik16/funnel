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
import {
  resolveTrackingLinkVersion,
  recordClick,
  writeFunnelEvent,
  loadClickWithSnapshot,
  hasFunnelEvent,
  handlePathView,
  executeOutbound,
  extractDestinationUrl,
  extractUtmParams,
  hashIp,
  classifyDeviceType,
  getHostname,
  getClientIp,
} from "./public-routing";

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

async function makeDomain(brandId: string, overrides: Partial<{ isActive: boolean }> = {}) {
  const domain = await prisma.domain.create({
    data: { hostname: `${unique("links")}.example.test`, brandId, ...overrides },
  });
  cleanup.push(() => prisma.domain.delete({ where: { id: domain.id } }));
  return domain;
}

async function makeCampaign(brandId: string, platformId: string, paybigUrl: string) {
  const campaign = await prisma.campaign.create({
    data: { brandId, platformId, name: unique("Campaign"), slug: unique("campaign"), paybigUrl },
  });
  cleanup.push(() => prisma.campaign.delete({ where: { id: campaign.id } }));
  return campaign;
}

async function makeTrackingLink(brandId: string, domainId: string, token = unique("token")) {
  const link = await prisma.trackingLink.create({
    data: { label: unique("Link"), token, brandId, domainId },
  });
  cleanup.push(() => prisma.trackingLink.delete({ where: { id: link.id } }));
  return link;
}

async function makeTelegramBot(brandId: string, overrides: { botUsername?: string | null } = {}) {
  const bot = await prisma.telegramBot.create({
    data: {
      brandId,
      name: unique("Bot"),
      botTokenCiphertext: "test.ciphertext.value",
      botUsername: overrides.botUsername === undefined ? unique("bot") : overrides.botUsername,
    },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: bot.id } }));
  return bot;
}

type PublishOverrides = {
  pathType?: PathType;
  destinationUrl?: string;
  ageGateEnabled?: boolean;
  telegramBotId?: string | null;
};

async function publishVersion(
  adminId: string,
  linkId: string,
  campaignId: string,
  overrides: PublishOverrides = {},
) {
  const isTelegram = overrides.pathType === PathType.TELEGRAM;
  const result = await prisma.$transaction((tx) =>
    publishTrackingLinkVersion(
      tx,
      {
        trackingLinkId: linkId,
        campaignId,
        socialAccountId: null,
        pathType: overrides.pathType ?? PathType.DIRECT,
        destinationUrl: isTelegram ? undefined : (overrides.destinationUrl ?? "https://paybig.example/checkout"),
        telegramBotId: isTelegram ? overrides.telegramBotId : undefined,
        ageGateEnabled: overrides.ageGateEnabled ?? false,
        experimentId: null,
        experimentArmId: null,
      },
      adminId,
    ),
  );
  assert.equal(result.ok, true, "test fixture publish should succeed");
  if (!result.ok) throw new Error("unreachable");
  cleanup.push(() => prisma.trackingLinkVersion.delete({ where: { id: result.versionId } }));
  cleanup.push(() => prisma.trackingLink.update({ where: { id: linkId }, data: { currentVersionId: null } }));
  return result.versionId;
}

async function setupPublishedFixture(overrides: PublishOverrides = {}) {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaign = await makeCampaign(brand.id, platform.id, "https://paybig.example/lane/x");
  const link = await makeTrackingLink(brand.id, domain.id);
  await publishVersion(admin.id, link.id, campaign.id, overrides);
  return { admin, brand, platform, domain, campaign, link };
}

// FunnelEvent rows reference Click via a required FK — delete them first.
async function deleteClick(clickId: string) {
  await prisma.funnelEvent.deleteMany({ where: { clickId } });
  await prisma.click.delete({ where: { id: clickId } });
}

async function eventSequence(clickId: string) {
  const events = await prisma.funnelEvent.findMany({
    where: { clickId },
    orderBy: { occurredAt: "asc" },
  });
  return events.map((e) => e.stepType);
}

// --- Pure helper unit tests --------------------------------------------------

test("hashIp never returns the raw IP and is deterministic", () => {
  const hash = hashIp("203.0.113.5");
  assert.notEqual(hash, "203.0.113.5");
  assert.equal(hash, hashIp("203.0.113.5"));
  assert.notEqual(hash, hashIp("203.0.113.6"));
  assert.equal(hashIp(null), null);
});

test("classifyDeviceType distinguishes mobile from desktop", () => {
  assert.equal(classifyDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "mobile");
  assert.equal(classifyDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
  assert.equal(classifyDeviceType(null), null);
});

test("extractUtmParams captures only recognized utm_* params", () => {
  const params = new URLSearchParams("utm_source=ig&utm_medium=bio&other=x");
  assert.deepEqual(extractUtmParams(params), { utm_source: "ig", utm_medium: "bio" });
  assert.equal(extractUtmParams(new URLSearchParams("other=x")), undefined);
});

test("getHostname strips the port", () => {
  assert.equal(getHostname(new Headers({ host: "links.example.com:3000" })), "links.example.com");
  assert.equal(getHostname(new Headers({ host: "links.example.com" })), "links.example.com");
});

// Hostnames are case-insensitive (RFC 4343); Domain.hostname is stored
// lowercase (enforced by the admin form's validation), so the request side
// must normalize too, or a Host header sent in a different case would fail
// to resolve a link that genuinely exists.
test("getHostname lowercases the host", () => {
  assert.equal(getHostname(new Headers({ host: "Links.Example.COM:3000" })), "links.example.com");
});

test("getClientIp prefers x-forwarded-for's first entry, falls back to x-real-ip", () => {
  assert.equal(
    getClientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })),
    "203.0.113.5",
  );
  assert.equal(getClientIp(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(getClientIp(new Headers()), null);
});

test("extractDestinationUrl accepts a valid URL and rejects everything else", () => {
  assert.equal(extractDestinationUrl({ destinationUrl: "https://acme.example" }), "https://acme.example");
  assert.equal(extractDestinationUrl({ destinationUrl: "not-a-url" }), null);
  assert.equal(extractDestinationUrl({ startParamTemplate: "x" }), null);
  assert.equal(extractDestinationUrl(null), null);
  assert.equal(extractDestinationUrl("not-an-object"), null);
});

// --- resolveTrackingLinkVersion: happy + every failure reason ---------------

test("resolveTrackingLinkVersion resolves an active link with a published version", async () => {
  const { domain, link } = await setupPublishedFixture();
  const result = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.link.id, link.id);
  assert.equal(result.snapshot.domain.hostname, domain.hostname);
});

test("resolveTrackingLinkVersion fails safely for an unknown domain", async () => {
  const result = await resolveTrackingLinkVersion(prisma, "nonexistent.example.test", "whatever");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "domain_not_found");
});

test("resolveTrackingLinkVersion fails safely for an inactive domain", async () => {
  const brand = await makeBrand();
  const domain = await makeDomain(brand.id, { isActive: false });
  const link = await makeTrackingLink(brand.id, domain.id);
  const result = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "domain_inactive");
});

test("resolveTrackingLinkVersion fails safely for an unknown token on a known domain", async () => {
  const { domain } = await setupPublishedFixture();
  const result = await resolveTrackingLinkVersion(prisma, domain.hostname, "no-such-token");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "link_not_found");
});

test("resolveTrackingLinkVersion fails safely for a paused link", async () => {
  const { domain, link } = await setupPublishedFixture();
  await prisma.trackingLink.update({ where: { id: link.id }, data: { status: "PAUSED" } });
  const result = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "link_inactive");
});

test("resolveTrackingLinkVersion fails safely for a link with no published version", async () => {
  const brand = await makeBrand();
  const domain = await makeDomain(brand.id);
  const link = await makeTrackingLink(brand.id, domain.id);
  const result = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_published_version");
});

// --- Click attribution -------------------------------------------------------

test("recordClick copies attribution from the snapshot, not live config", async () => {
  const { domain, link, brand, campaign } = await setupPublishedFixture();
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: "203.0.113.5",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    referrer: "https://instagram.com/",
    searchParams: new URLSearchParams("utm_source=ig"),
  });
  cleanup.push(() => deleteClick(click.id));

  assert.equal(click.brandId, brand.id);
  assert.equal(click.campaignId, campaign.id);
  assert.equal(click.deviceType, "mobile");
  assert.notEqual(click.ipHash, "203.0.113.5");
  assert.deepEqual(click.utmParams, { utm_source: "ig" });
});

// --- Full funnel flows --------------------------------------------------------

test("DIRECT flow: route_resolved -> outbound_paybig_redirected, correct destination", async () => {
  const { domain, link } = await setupPublishedFixture({
    pathType: PathType.DIRECT,
    destinationUrl: "https://paybig.example/direct-offer",
  });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));
  await writeFunnelEvent(prisma, click.id, "ROUTE_RESOLVED");

  const loaded = await loadClickWithSnapshot(prisma, click.id);
  assert.ok(loaded);
  const pathResult = await handlePathView(prisma, click.id, loaded!.snapshot);
  assert.deepEqual(pathResult, { ok: true, render: "redirect_direct" });

  const outResult = await executeOutbound(prisma, click.id, loaded!.snapshot);
  assert.equal(outResult.ok, true);
  if (!outResult.ok) return;
  assert.equal(outResult.destinationUrl, "https://paybig.example/direct-offer");

  assert.deepEqual(await eventSequence(click.id), ["ROUTE_RESOLVED", "OUTBOUND_PAYBIG_REDIRECTED"]);
});

test("AGGREGATOR flow: route_resolved -> aggregator_viewed -> aggregator_continue_clicked -> outbound_paybig_redirected", async () => {
  const { domain, link } = await setupPublishedFixture({
    pathType: PathType.AGGREGATOR,
    destinationUrl: "https://paybig.example/aggregator-offer",
  });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));
  await writeFunnelEvent(prisma, click.id, "ROUTE_RESOLVED");

  const loaded = await loadClickWithSnapshot(prisma, click.id);
  const pathResult = await handlePathView(prisma, click.id, loaded!.snapshot);
  assert.deepEqual(pathResult, { ok: true, render: "aggregator" });

  const outResult = await executeOutbound(prisma, click.id, loaded!.snapshot);
  assert.equal(outResult.ok, true);
  if (!outResult.ok) return;
  assert.equal(outResult.destinationUrl, "https://paybig.example/aggregator-offer");

  assert.deepEqual(await eventSequence(click.id), [
    "ROUTE_RESOLVED",
    "AGGREGATOR_VIEWED",
    "AGGREGATOR_CONTINUE_CLICKED",
    "OUTBOUND_PAYBIG_REDIRECTED",
  ]);
});

test("age gate flow: route_resolved -> age_gate_shown -> age_gate_accepted, click context preserved", async () => {
  const { domain, link } = await setupPublishedFixture({ ageGateEnabled: true });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.snapshot.ageGateEnabled, true);

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));
  await writeFunnelEvent(prisma, click.id, "ROUTE_RESOLVED");

  // Simulates GET /gate/{clickId} then the "accept" action — the same click
  // id carries context through the gate, no session/cookie needed.
  await writeFunnelEvent(prisma, click.id, "AGE_GATE_SHOWN");
  const loadedAfterGate = await loadClickWithSnapshot(prisma, click.id);
  assert.equal(loadedAfterGate?.click.id, click.id);
  await writeFunnelEvent(prisma, click.id, "AGE_GATE_ACCEPTED");

  assert.deepEqual(await eventSequence(click.id), [
    "ROUTE_RESOLVED",
    "AGE_GATE_SHOWN",
    "AGE_GATE_ACCEPTED",
  ]);
});

test("age gate decline is logged distinctly from acceptance", async () => {
  const { domain, link } = await setupPublishedFixture({ ageGateEnabled: true });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));
  await writeFunnelEvent(prisma, click.id, "ROUTE_RESOLVED");
  await writeFunnelEvent(prisma, click.id, "AGE_GATE_SHOWN");
  await writeFunnelEvent(prisma, click.id, "AGE_GATE_DECLINED");

  assert.deepEqual(await eventSequence(click.id), [
    "ROUTE_RESOLVED",
    "AGE_GATE_SHOWN",
    "AGE_GATE_DECLINED",
  ]);
});

// --- Failure paths after a Click exists --------------------------------------

test("handlePathView fails safely against a corrupted TELEGRAM snapshot with no telegramBot", async () => {
  const { domain, link } = await setupPublishedFixture();
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  const corruptedSnapshot = { ...resolved.snapshot, pathType: PathType.TELEGRAM, telegramBot: null };
  const result = await handlePathView(prisma, click.id, corruptedSnapshot);
  assert.deepEqual(result, { ok: false, reason: "telegram_bot_missing" });
  assert.deepEqual(await eventSequence(click.id), ["ROUTE_FAILED"]);
});

test("handlePathView mints a start payload and returns a t.me deep link for TELEGRAM", async () => {
  const { brand, domain, link } = await setupPublishedFixture();
  const bot = await makeTelegramBot(brand.id, { botUsername: "acme_offers_bot" });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();

  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  const telegramSnapshot = {
    ...resolved.snapshot,
    pathType: PathType.TELEGRAM,
    telegramBot: { id: bot.id, name: bot.name, username: bot.botUsername! },
  };
  const result = await handlePathView(prisma, click.id, telegramSnapshot);
  assert.equal(result.ok, true);
  if (!result.ok || result.render !== "redirect_telegram") return assert.fail();
  assert.match(result.deepLinkUrl, /^https:\/\/t\.me\/acme_offers_bot\?start=/);

  assert.deepEqual(await eventSequence(click.id), ["TELEGRAM_REDIRECTED"]);

  const payloadToken = new URL(result.deepLinkUrl).searchParams.get("start")!;
  const payload = await prisma.telegramStartPayload.findUnique({ where: { payloadToken } });
  assert.ok(payload);
  assert.equal(payload!.clickId, click.id);
  assert.equal(payload!.telegramBotId, bot.id);
  cleanup.push(() => prisma.telegramStartPayload.delete({ where: { id: payload!.id } }));
});

test("executeOutbound fails safely when the snapshot has no valid destination URL", async () => {
  const { domain, link } = await setupPublishedFixture();
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  const corruptedSnapshot = { ...resolved.snapshot, pathConfig: { destinationUrl: "not-a-url" } };
  const result = await executeOutbound(prisma, click.id, corruptedSnapshot);
  assert.deepEqual(result, { ok: false, reason: "invalid_destination" });
  assert.deepEqual(await eventSequence(click.id), ["ROUTE_FAILED"]);
});

test("executeOutbound is idempotent: a repeated call replays the same destination without duplicate events", async () => {
  const { domain, link } = await setupPublishedFixture({
    pathType: PathType.AGGREGATOR,
    destinationUrl: "https://paybig.example/idempotent-offer",
  });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  const first = await executeOutbound(prisma, click.id, resolved.snapshot);
  const second = await executeOutbound(prisma, click.id, resolved.snapshot);
  const third = await executeOutbound(prisma, click.id, resolved.snapshot);

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal((first as { destinationUrl: string }).destinationUrl, "https://paybig.example/idempotent-offer");

  const events = await eventSequence(click.id);
  assert.equal(
    events.filter((e) => e === "OUTBOUND_PAYBIG_REDIRECTED").length,
    1,
    "only one outbound event should exist despite three calls",
  );
  assert.equal(
    events.filter((e) => e === "AGGREGATOR_CONTINUE_CLICKED").length,
    1,
    "the second/third call should not re-log the continue click either",
  );
});

test("executeOutbound uses the campaign's Paybig URL for TELEGRAM (no pathConfig.destinationUrl field exists for it)", async () => {
  const { brand, domain, link } = await setupPublishedFixture();
  const bot = await makeTelegramBot(brand.id, { botUsername: "acme_offers_bot" });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  const telegramSnapshot = {
    ...resolved.snapshot,
    pathType: PathType.TELEGRAM,
    pathConfig: { startParamTemplate: null },
    telegramBot: { id: bot.id, name: bot.name, username: bot.botUsername! },
  };
  const result = await executeOutbound(prisma, click.id, telegramSnapshot);
  assert.deepEqual(result, { ok: true, destinationUrl: resolved.snapshot.campaign.paybigUrl });
  assert.deepEqual(await eventSequence(click.id), ["OUTBOUND_PAYBIG_REDIRECTED"]);
});

test("executeOutbound fails safely for a truly unrecognized path type (defensive fallback)", async () => {
  const { domain, link } = await setupPublishedFixture();
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  // PathType only ever has 3 real values — this forces the defensive branch
  // that only matters if the schema/type ever drifts out of sync.
  const bogusSnapshot = { ...resolved.snapshot, pathType: "CARRIER_PIGEON" as PathType };
  const result = await executeOutbound(prisma, click.id, bogusSnapshot);
  assert.deepEqual(result, { ok: false, reason: "unsupported_path_type" });
  assert.deepEqual(await eventSequence(click.id), ["ROUTE_FAILED"]);
});

test("loadClickWithSnapshot returns null for a nonexistent click id (no context to lose)", async () => {
  const loaded = await loadClickWithSnapshot(prisma, "nonexistent-click-id");
  assert.equal(loaded, null);
});

test("hasFunnelEvent backs the gate's accept/decline idempotency guard", async () => {
  const { domain, link } = await setupPublishedFixture({ ageGateEnabled: true });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  assert.equal(await hasFunnelEvent(prisma, click.id, "AGE_GATE_ACCEPTED"), false);
  await writeFunnelEvent(prisma, click.id, "AGE_GATE_ACCEPTED");
  assert.equal(await hasFunnelEvent(prisma, click.id, "AGE_GATE_ACCEPTED"), true);
});

// hasFunnelEvent-then-writeFunnelEvent (used by every one-time-event caller:
// age gate accept/decline, Telegram start, outbound redirect) is a
// check-then-write race under truly concurrent requests, not just sequential
// retries — two calls can both see "no event yet" before either commits. The
// partial unique index (migration 20260825200000_funnel_event_singleton_steps)
// is what actually prevents two rows; this proves it holds under a real
// concurrent write, not just sequential ones (which the existing
// executeOutbound idempotency test above already covers).
test("writeFunnelEvent survives a genuine concurrent race: only one row wins for a singleton step type", async () => {
  const { domain, link } = await setupPublishedFixture();
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  await Promise.all([
    writeFunnelEvent(prisma, click.id, "OUTBOUND_PAYBIG_REDIRECTED", { destinationUrl: "https://a.example" }),
    writeFunnelEvent(prisma, click.id, "OUTBOUND_PAYBIG_REDIRECTED", { destinationUrl: "https://a.example" }),
    writeFunnelEvent(prisma, click.id, "OUTBOUND_PAYBIG_REDIRECTED", { destinationUrl: "https://a.example" }),
  ]);

  const rows = await prisma.funnelEvent.findMany({
    where: { clickId: click.id, stepType: "OUTBOUND_PAYBIG_REDIRECTED" },
  });
  assert.equal(rows.length, 1);
});

// Repeatable step types (AGGREGATOR_VIEWED, per D020) are explicitly not
// covered by the partial unique index — this documents that boundary rather
// than assuming it.
test("writeFunnelEvent still allows genuine repeats for step types that aren't singletons", async () => {
  const { domain, link } = await setupPublishedFixture({ pathType: PathType.AGGREGATOR });
  const resolved = await resolveTrackingLinkVersion(prisma, domain.hostname, link.token);
  if (!resolved.ok) return assert.fail();
  const click = await recordClick(prisma, resolved.link, resolved.versionId, resolved.snapshot, {
    ip: null,
    userAgent: null,
    referrer: null,
    searchParams: new URLSearchParams(),
  });
  cleanup.push(() => deleteClick(click.id));

  await writeFunnelEvent(prisma, click.id, "AGGREGATOR_VIEWED");
  await writeFunnelEvent(prisma, click.id, "AGGREGATOR_VIEWED");

  const rows = await prisma.funnelEvent.findMany({
    where: { clickId: click.id, stepType: "AGGREGATOR_VIEWED" },
  });
  assert.equal(rows.length, 2);
});
