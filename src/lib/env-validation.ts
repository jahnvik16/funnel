// Run once at server startup (see src/instrumentation.ts) so a misconfigured
// deployment fails loudly before serving any traffic, instead of lazily the
// first time a secret happens to be encrypted/decrypted (which is how
// ENCRYPTION_KEY was validated before this — lib/crypto.ts's own check is
// left in place as defense-in-depth, this just moves the failure earlier).
export class EnvValidationError extends Error {}

const REQUIRED_VARS = ["DATABASE_URL", "ENCRYPTION_KEY"] as const;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new EnvValidationError(
      `Missing required environment variable(s): ${missing.join(", ")}. See .env.example.`,
    );
  }

  const decodedKeyLength = Buffer.from(env.ENCRYPTION_KEY as string, "base64").length;
  if (decodedKeyLength !== 32) {
    throw new EnvValidationError(
      "ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded). See .env.example.",
    );
  }

  // Not a hard requirement — lib/telegram-bots' actions and
  // lib/telegram-webhook.ts already fall back to http://localhost:3000 — but
  // that fallback silently produces broken Telegram deep links/webhook
  // registration in any real deployment, so it's worth a loud warning rather
  // than a silent one.
  if (!env.APP_BASE_URL) {
    console.warn(
      "[startup] APP_BASE_URL is not set — Telegram deep links and webhook registration will " +
        "fall back to http://localhost:3000, which will not work for real Telegram traffic.",
    );
  }
}
