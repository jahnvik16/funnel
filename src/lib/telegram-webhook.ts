import type { Prisma } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { sendMessage, type TelegramCta } from "@/lib/telegram";
import { resolveTelegramStartPayload } from "@/lib/telegram-payload";
import { writeFunnelEvent, hasFunnelEvent } from "@/lib/public-routing";

type Db = Prisma.TransactionClient;
type FetchLike = typeof fetch;

export type TelegramUpdate = {
  message?: {
    text?: string;
    chat: { id: number };
  };
};

const START_COMMAND_PATTERN = /^\/start(?:@\w+)?(?:\s+(\S+))?$/;

// `t.me/<bot>?start=<token>` makes Telegram send `/start <token>` as the
// message text — this is the only "/start handling" implemented; anything
// else (plain `/start`, any other command or text) is ignored, per "do not
// build a complex conversational bot."
export function extractStartPayload(update: TelegramUpdate): string | null {
  const text = update.message?.text?.trim();
  if (!text) return null;
  const match = START_COMMAND_PATTERN.exec(text);
  return match?.[1] ?? null;
}

// A bot with no webhook secret on file (never successfully registered one)
// is treated permissively — "as far as practical" rather than an outright
// requirement, since local/dev environments can't complete real webhook
// registration against a non-public APP_BASE_URL. Once a secret is on file,
// the header must match exactly.
export function verifyWebhookSecret(storedSecret: string | null, headerValue: string | null): boolean {
  if (!storedSecret) return true;
  return headerValue === storedSecret;
}

export type TelegramWebhookResult =
  | { ok: true; clickId: string; alreadyStarted: boolean }
  | {
      ok: false;
      reason: "bot_not_found" | "unauthorized" | "no_start_payload" | "payload_not_found" | "payload_expired";
    };

// Deliberately does not wrap the resolve+log step and the reply send in one
// DB transaction — holding a transaction open across a network call to
// Telegram's API is worse than the (harmless, idempotency-guarded) chance of
// a duplicate under concurrent retries. See DECISIONS.md.
export async function handleTelegramWebhook(
  db: Db,
  botId: string,
  update: TelegramUpdate,
  secretHeader: string | null,
  fetchImpl?: FetchLike,
): Promise<TelegramWebhookResult> {
  const bot = await db.telegramBot.findUnique({ where: { id: botId } });
  if (!bot) return { ok: false, reason: "bot_not_found" };

  const storedSecret = bot.webhookSecretCiphertext ? decryptSecret(bot.webhookSecretCiphertext) : null;
  if (!verifyWebhookSecret(storedSecret, secretHeader)) {
    return { ok: false, reason: "unauthorized" };
  }

  const payloadToken = extractStartPayload(update);
  if (!payloadToken) return { ok: false, reason: "no_start_payload" };

  const resolution = await resolveTelegramStartPayload(db, payloadToken);
  if (!resolution.ok) {
    return {
      ok: false,
      reason: resolution.reason === "not_found" ? "payload_not_found" : "payload_expired",
    };
  }

  const { clickId } = resolution.payload;
  const alreadyStarted = await hasFunnelEvent(db, clickId, "TELEGRAM_STARTED");
  if (!alreadyStarted) {
    await writeFunnelEvent(db, clickId, "TELEGRAM_STARTED", { telegramBotId: bot.id });
  }

  const chatId = update.message?.chat.id;
  if (chatId !== undefined) {
    const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const cta: TelegramCta = {
      label: bot.ctaLabel ?? "Continue",
      url: `${appBaseUrl}/out/${clickId}`,
    };
    const botToken = decryptSecret(bot.botTokenCiphertext);
    // Best-effort: a failed send doesn't fail the webhook — the attribution
    // event above is already recorded, and Telegram will retry the update
    // if we ever return non-2xx, which we don't do for this step either way.
    await sendMessage(botToken, chatId, bot.welcomeMessage ?? "Thanks for reaching out!", cta, fetchImpl);
  }

  return { ok: true, clickId, alreadyStarted };
}
