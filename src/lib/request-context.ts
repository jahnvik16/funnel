import { randomUUID } from "crypto";

// Reuses an upstream request id if a proxy/load balancer already set one
// (common on most hosting platforms), otherwise mints a fresh one. Used to
// correlate this codebase's structured log lines back to a single incoming
// HTTP request — not to be confused with Click.id, which already correlates
// a visitor's *journey* across the several separate HTTP requests
// `/l` → `/gate` → `/path` → `/out` naturally involves.
export function getOrCreateRequestId(headers: Headers): string {
  return headers.get("x-request-id") ?? randomUUID();
}
