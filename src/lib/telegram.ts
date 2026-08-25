// Format-only check: `<bot id>:<35-char secret>`, e.g. `123456789:AAF...`.
// This does NOT call Telegram's API (no live getMe verification) — that's
// integration work, explicitly out of scope for this milestone. See
// docs/funnelcore/OPEN_QUESTIONS.md "Telegram".
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,15}:[A-Za-z0-9_-]{35}$/;

export function isValidTelegramBotTokenFormat(token: string): boolean {
  return TELEGRAM_BOT_TOKEN_PATTERN.test(token);
}
