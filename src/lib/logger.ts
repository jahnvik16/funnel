// One structured JSON line per event, written to stdout/stderr. Deliberately
// minimal — no external logging service, no buffering, no log levels beyond
// what a hosting platform's own log collector already understands from
// stdout vs stderr.
//
// CRITICAL: never pass a secret (bot token, password, ciphertext, session
// token, decrypted API credential) as a field. This module does not attempt
// to redact anything — the discipline is the caller's, exactly like every
// other place secrets are handled in this codebase (see CLAUDE.md rule 11/12
// and lib/telegram.ts's "never logs" comment). Fields should be ids, counts,
// enums, booleans, and durations — never raw request/response bodies.
export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", event: string, fields: LogFields): void {
  const line = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => write("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => write("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => write("error", event, fields),
};
