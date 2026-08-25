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
import { encryptSecret } from "./crypto";
import { publishTrackingLinkVersion } from "./tracking-link-publishing";
import { createTelegramStartPayload } from "./telegram-payload";
import { extractStartPayload, verifyWebhookSecret, handleTelegramWebhook } from "./telegram-webhook";

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

async function makeTelegramBot(
  brandId: string,
  overrides: { webhookSecret?: string; welcomeMessage?: string; ctaLabel?: string } = {},
) {
  const bot = await prisma.telegramBot.create({
    data: {
      brandId,
      name: unique("Bot"),
      botTokenCiphertext: encryptSecret("123456789:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK"),
      botUsername: unique("bot"),
      welcomeMessage: overrides.welcomeMessage,
      ctaLabel: overrides.ctaLabel,
      webhookSecretCiphertext: overrides.webhookSecret ? encryptSecret(overrides.webhookSecret) : null,
    },
  });
  cleanup.push(() => prisma.telegramBot.delete({ where: { id: bot.id } }));
  return bot;
}

async function deleteClick(clickId: string) {
  await prisma.funnelEvent.deleteMany({ where: { clickId } });
  await prisma.telegramStartPayload.deleteMany({ where: { clickId } });
  await prisma.click.delete({ where: { id: clickId } });
}

async function setupFixture(botOverrides: { webhookSecret?: string } = {}) {
  const admin = await makeAdmin();
  const brand = await makeBrand();
  const platform = await makePlatform();
  const domain = await makeDomain(brand.id);
  const campaign = await makeCampaign(brand.id, platform.id);
  const bot = await makeTelegramBot(brand.id, {
    ...botOverrides,
    welcomeMessage: "Welcome to Acme!",
    ctaLabel: "See the offer",
  });
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

  return { admin, brand, bot, link, versionId: publishResult.versionId, click };
}

type MockCall = { url: string; body: Record<string, unknown> };

function mockFetch(calls: MockCall[] = []): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : {} });
    return { json: async () => ({ ok: true, result: {} }) } as Response;
  }) as typeof fetch;
}

async function eventSequence(clickId: string) {
  const events = await prisma.funnelEvent.findMany({ where: { clickId }, orderBy: { occurredAt: "asc" } });
  return events.map((e) => e.stepType);
}

// --- Pure parsing/verification -----------------------------------------------

test("extractStartPayload parses `/start <token>`", () => {
  assert.equal(extractStartPayload({ message: { text: "/start abc123", chat: { id: 1 } } }), "abc123");
});

test("extractStartPayload handles the /start@botname form", () => {
  assert.equal(
    extractStartPayload({ message: { text: "/start@acme_offers_bot abc123", chat: { id: 1 } } }),
    "abc123",
  );
});

test("extractStartPayload returns null for a bare /start with no payload", () => {
  assert.equal(extractStartPayload({ message: { text: "/start", chat: { id: 1 } } }), null);
});

test("extractStartPayload returns null for unrelated text or no message", () => {
  assert.equal(extractStartPayload({ message: { text: "hello", chat: { id: 1 } } }), null);
  assert.equal(extractStartPayload({}), null);
});

test("verifyWebhookSecret is permissive when no secret is on file yet", () => {
  assert.equal(verifyWebhookSecret(null, null), true);
  assert.equal(verifyWebhookSecret(null, "anything"), true);
});

test("verifyWebhookSecret requires an exact match once a secret is configured", () => {
  assert.equal(verifyWebhookSecret("real-secret", "real-secret"), true);
  assert.equal(verifyWebhookSecret("real-secret", "wrong"), false);
  assert.equal(verifyWebhookSecret("real-secret", null), false);
});

// timingSafeEqual (used internally for the constant-time comparison) throws
// on mismatched buffer lengths — this proves the length pre-check actually
// guards that, rather than crashing the webhook route on a short/long header.
test("verifyWebhookSecret rejects a header of a different length without throwing", () => {
  assert.doesNotThrow(() => verifyWebhookSecret("real-secret", "short"));
  assert.equal(verifyWebhookSecret("real-secret", "short"), false);
  assert.doesNotThrow(() => verifyWebhookSecret("real-secret", "real-secret-but-much-longer"));
  assert.equal(verifyWebhookSecret("real-secret", "real-secret-but-much-longer"), false);
});

// --- Full webhook flow --------------------------------------------------------

test("handleTelegramWebhook: happy path resolves the payload, logs telegram_started, and sends the CTA", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);
  const calls: MockCall[] = [];

  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: `/start ${payloadToken}`, chat: { id: 555 } } },
    null,
    mockFetch(calls),
  );

  assert.deepEqual(result, { ok: true, clickId: click.id, alreadyStarted: false });
  assert.deepEqual(await eventSequence(click.id), ["TELEGRAM_STARTED"]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, 555);
  assert.equal(calls[0].body.text, "Welcome to Acme!");
  assert.deepEqual(calls[0].body.reply_markup, {
    inline_keyboard: [[{ text: "See the offer", url: `${process.env.APP_BASE_URL}/out/${click.id}` }]],
  });
});

test("handleTelegramWebhook is idempotent: a repeated /start does not duplicate telegram_started", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);
  const update = { message: { text: `/start ${payloadToken}`, chat: { id: 555 } } };

  const first = await handleTelegramWebhook(prisma, bot.id, update, null, mockFetch());
  const second = await handleTelegramWebhook(prisma, bot.id, update, null, mockFetch());

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.alreadyStarted, false);
  assert.equal(second.alreadyStarted, true);

  const events = await eventSequence(click.id);
  assert.equal(events.filter((e) => e === "TELEGRAM_STARTED").length, 1);
});

test("handleTelegramWebhook rejects a mismatched secret when one is configured", async () => {
  const { click, bot } = await setupFixture({ webhookSecret: "correct-secret" });
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: `/start ${payloadToken}`, chat: { id: 1 } } },
    "wrong-secret",
    mockFetch(),
  );

  assert.deepEqual(result, { ok: false, reason: "unauthorized" });
  assert.deepEqual(await eventSequence(click.id), []);
});

test("handleTelegramWebhook accepts the correct secret when one is configured", async () => {
  const { click, bot } = await setupFixture({ webhookSecret: "correct-secret" });
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: `/start ${payloadToken}`, chat: { id: 1 } } },
    "correct-secret",
    mockFetch(),
  );

  assert.equal(result.ok, true);
});

test("handleTelegramWebhook fails safely for an unknown bot id", async () => {
  const result = await handleTelegramWebhook(
    prisma,
    "nonexistent-bot-id",
    { message: { text: "/start whatever", chat: { id: 1 } } },
    null,
    mockFetch(),
  );
  assert.deepEqual(result, { ok: false, reason: "bot_not_found" });
});

test("handleTelegramWebhook is a no-op for a message with no /start payload", async () => {
  const { bot } = await setupFixture();
  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: "hello", chat: { id: 1 } } },
    null,
    mockFetch(),
  );
  assert.deepEqual(result, { ok: false, reason: "no_start_payload" });
});

test("handleTelegramWebhook fails safely for an unknown payload token", async () => {
  const { bot } = await setupFixture();
  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: "/start does-not-exist", chat: { id: 1 } } },
    null,
    mockFetch(),
  );
  assert.deepEqual(result, { ok: false, reason: "payload_not_found" });
});

test("handleTelegramWebhook fails safely for an expired payload", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);
  await prisma.telegramStartPayload.update({
    where: { payloadToken },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const result = await handleTelegramWebhook(
    prisma,
    bot.id,
    { message: { text: `/start ${payloadToken}`, chat: { id: 1 } } },
    null,
    mockFetch(),
  );
  assert.deepEqual(result, { ok: false, reason: "payload_expired" });
});

test("handleTelegramWebhook never logs the decrypted bot token", async () => {
  const { click, bot } = await setupFixture();
  const { payloadToken } = await createTelegramStartPayload(prisma, click.id, bot.id);

  const logged: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));

  try {
    await handleTelegramWebhook(
      prisma,
      bot.id,
      { message: { text: `/start ${payloadToken}`, chat: { id: 1 } } },
      null,
      mockFetch(),
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  for (const line of logged) {
    assert.ok(!line.includes("123456789:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK"));
  }
});
