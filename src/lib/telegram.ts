import { randomBytes } from "crypto";

// Format-only check: `<bot id>:<35-char secret>`, e.g. `123456789:AAF...`.
// Used as a cheap pre-check before spending an API call on `getBotInfo`.
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,15}:[A-Za-z0-9_-]{35}$/;

export function isValidTelegramBotTokenFormat(token: string): boolean {
  return TELEGRAM_BOT_TOKEN_PATTERN.test(token);
}

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramApiResult<T> =
  | { ok: true; result: T }
  | { ok: false; description: string };

type FetchLike = typeof fetch;

// Never logs `botToken` or the request URL (which embeds it) — only the
// method name and Telegram's own response description, on failure. Callers
// must keep following that discipline in whatever they do with the result.
export async function callTelegramApi<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<TelegramApiResult<T>> {
  try {
    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      return { ok: false, description: data.description ?? `Telegram API call to ${method} failed.` };
    }
    return { ok: true, result: data.result as T };
  } catch {
    return { ok: false, description: `Could not reach Telegram's API while calling ${method}.` };
  }
}

export type TelegramBotInfo = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export function getBotInfo(
  botToken: string,
  fetchImpl?: FetchLike,
): Promise<TelegramApiResult<TelegramBotInfo>> {
  return callTelegramApi<TelegramBotInfo>(botToken, "getMe", undefined, fetchImpl);
}

export function setWebhook(
  botToken: string,
  url: string,
  secretToken: string,
  fetchImpl?: FetchLike,
): Promise<TelegramApiResult<boolean>> {
  return callTelegramApi<boolean>(
    botToken,
    "setWebhook",
    { url, secret_token: secretToken },
    fetchImpl,
  );
}

export type TelegramCta = { label: string; url: string };

export function sendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  cta?: TelegramCta,
  fetchImpl?: FetchLike,
): Promise<TelegramApiResult<unknown>> {
  return callTelegramApi(
    botToken,
    "sendMessage",
    {
      chat_id: chatId,
      text,
      ...(cta
        ? { reply_markup: { inline_keyboard: [[{ text: cta.label, url: cta.url }]] } }
        : {}),
    },
    fetchImpl,
  );
}

// Telegram's secret_token must be 1-256 chars of A-Z, a-z, 0-9, _, - — hex
// satisfies that. Generated once per bot when validation registers a webhook.
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}
