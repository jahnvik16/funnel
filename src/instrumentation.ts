// Runs once when the server starts (both `next dev` and `next start`),
// before any request is handled — the standard Next.js hook for startup
// checks. See lib/env-validation.ts for what's actually checked and why.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("@/lib/env-validation");
  validateEnv();
}
