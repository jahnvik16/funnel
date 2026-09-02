# FunnelCore — Production Readiness Report

Produced at the end of the "Phase 1 → Production Pilot" hardening milestone (see DECISIONS.md
D043–D053), which followed a full read-only post-V1 audit against CLAUDE.md, PRODUCT_SPEC.md,
and RELEASE_CHECKLIST.md. This document is the pilot go-live reference: what's implemented and
verified, what an operator must configure, how to monitor and roll back, and what limitations
are accepted V1 scope rather than bugs. It supersedes RELEASE_CHECKLIST.md §4–§7 for anything
this milestone changed; RELEASE_CHECKLIST.md remains the record of the V1 feature-complete QA
pass itself.

No architectural change was made in this milestone beyond the seven decisions ratified in
DECISIONS.md D043 (most notably: campaign slugs become immutable after first publish). Tracking
link pause/archive behavior, the funnel route structure, campaign-level signup attribution, and
row-by-row CSV import are all unchanged from V1.

## 1. Security checklist

| Item | Status | Notes |
|---|---|---|
| Passwords hashed (bcrypt), never stored/logged in plaintext | ✅ Done (V1) | |
| Sessions are opaque, DB-backed, HTTP-only, SHA-256 hash persisted (not the raw token) | ✅ Done (V1) | |
| Secrets (Telegram tokens, API credentials) encrypted at rest (AES-256-GCM) | ✅ Done (V1) | No key-rotation mechanism — see §7 |
| Timing-safe login (no email-enumeration via response time) | ✅ Done (V1, D036) | |
| Login rate limiting / account lockout | ✅ Done (this milestone, D044) | 5 failed attempts locks an account 15 minutes; DB-backed so it survives restarts and works across instances |
| Security response headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`) | ✅ Done (this milestone, D045) | Static, via `next.config.ts` |
| Content-Security-Policy | ✅ Done (this milestone, D045) | Nonce-based via `src/proxy.ts` (renamed from `middleware.ts`, D054 — same behavior), not static — a static CSP broke Next.js hydration (see D045). `'unsafe-eval'` only outside production |
| Startup validation of `ENCRYPTION_KEY` / required env vars | ✅ Done (this milestone, D046) | Fails loud at boot via `src/instrumentation.ts`, not lazily on first use |
| Webhook secret verification (Telegram) | ✅ Done (V1, D035) | Constant-time comparison; permissive until a secret is registered |
| CSRF | ✅ Inherent | All mutations are Next.js Server Actions (same-origin POST only, framework-enforced) — no separate CSRF token needed |
| Secrets never sent to the client | ✅ Done (V1) | Asserted by explicit allow-list tests, not just "doesn't crash" |
| Secrets never appear in logs | ✅ Done (V1 + this milestone) | `lib/logger.ts`'s own docstring enforces this discipline for the new structured logging added this milestone |
| `AdminRole.VIEWER` enforcement | ❌ Not done | Unreachable today (no way to create a VIEWER account); see §7 |
| RBAC scoping (brand-level admin access) | ❌ Not built | Single-role V1 by ratified decision (D043.4) |
| Click-fraud blocking | ❌ Not built, by decision | Logging/reporting only, deferred to a later milestone (D043.7) — no fraud signal collection exists yet |

## 2. Deployment checklist

Platform-agnostic checklist. **For Vercel specifically, see
[VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for the exact `vercel.json`/environment-variable
configuration** — this section stays generic since FunnelCore isn't tied to one host.

1. Provision PostgreSQL 16+, reachable from the app at boot. In any deployment where the app
   runs as short-lived/serverless functions (Vercel included), the app's own connection
   (`DATABASE_URL`) must be a **pooled** connection (PgBouncer, or your provider's built-in
   pooler — Neon and Supabase both provide one) — see D055. Migrations need a separate
   **direct** connection (`DIRECT_DATABASE_URL`) instead; see prisma/schema.prisma's
   `directUrl` field.
2. Set all required environment variables (§3) — a freshly generated `ENCRYPTION_KEY`
   (`openssl rand -base64 32`), never the local dev value.
3. Run `npm run prisma:migrate:deploy` (i.e. `prisma migrate deploy` — not `migrate dev`, which
   requires an interactive terminal), pointed at `DIRECT_DATABASE_URL`. There are 8 migrations
   as of this milestone; confirm the most recent two applied via `\d admin_users` (expect
   `failedLoginAttempts`/`lockedUntil` columns) and `\d clicks` (expect
   `clicks_brandId_idx`/`clicks_platformId_idx`/`clicks_socialAccountId_idx`).
4. Run `npx prisma generate` if not already run as part of install (the `postinstall` script
   does this automatically as of D055 — see package.json).
5. Run `npm run build`, then start with `npm run start` (or your platform's Next.js production
   entrypoint) — confirm `instrumentation.ts` runs (a malformed `ENCRYPTION_KEY` will crash the
   boot immediately with a named error; see §8's smoke test).
6. Run `npm run prisma:seed` once, manually, to create the first admin account — **never as
   part of an automated build/deploy step**, since the seed's `upsert` would otherwise silently
   reset the admin's password back to `SEED_ADMIN_PASSWORD` on every redeploy. Change that
   password after first login.
7. Point a real public HTTPS hostname at the deployment before registering the Telegram
   webhook — `setWebhook` will not succeed against `http://localhost` or a non-public URL.
8. Confirm `GET /api/health` returns `200 {"status":"ok","database":"connected"}`.
9. Run the production smoke tests in §8 before directing real traffic at tracking links.

## 3. Required environment variables

| Variable | Required | Purpose | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string the **running app** uses for every query | Validated at startup (D046); app refuses to boot without it. **Must be a pooled connection in any serverless/short-lived-process deployment** (D055) — see §2 |
| `DIRECT_DATABASE_URL` | Yes, for migrations | Direct (unpooled) Postgres connection used only by the Prisma CLI (`migrate deploy`/`dev`, `studio`) — see `directUrl` in prisma/schema.prisma | Not read by the running application at all (D055); `prisma generate` does not require it either, only actual migration commands do. In local dev (a single, unpooled Postgres instance) this is identical to `DATABASE_URL` |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for Telegram tokens/API credentials | Base64-encoded, must decode to exactly 32 bytes — validated at startup (D046), not just on first use. No rotation mechanism (see §7) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Yes, once | First admin account via `prisma db seed` | Password must be 8+ characters; the seed is an upsert, safe to re-run manually — but never wire it into an automated deploy step (see §2 item 6) |
| `APP_BASE_URL` | Strongly recommended | Public base URL for Telegram webhook registration and in-chat CTA links | Not enforced at startup (soft warning only, D046) since local dev has a working fallback — but Telegram integration will not function correctly without the real public HTTPS value in production |
| `PAYBIG_API_BASE_URL` / `PAYBIG_API_KEY` / `PAYBIG_WEBHOOK_SECRET` | No | Reserved for a future live Paybig integration | **Currently unused** — V1 ships Paybig conversions as an admin-uploaded CSV (ratified as staying CSV-only this milestone, D043.5). Do not treat as required |

Real Telegram bot tokens and any real Paybig API credentials are entered through the admin UI
(encrypted at rest immediately), never via environment variables or committed files. None of
the variables above are hardcoded anywhere in the codebase — every one is read via
`process.env`/`env()` at the point of use.

## 4. Monitoring checklist

- **New page, no forms/client state → check it isn't accidentally static (D057).** Any new
  route with no dynamic data dependency can get silently static-optimized by Next.js, which is
  incompatible with the nonce-based CSP (D045) — a real request only surfaces this against an
  actual CDN layer (confirmed on Vercel via `curl -sD - <url> | grep -E "X-Vercel-Cache|nonce"`:
  `X-Vercel-Cache: HIT` plus a *different* nonce on repeated requests means it's broken), not
  against local `next dev`/`next start`. If a new page needs to stay interactive, give it
  `export const dynamic = "force-dynamic"` from a Server Component file — see `/admin/login`'s
  `page.tsx`/`LoginForm.tsx` split for the pattern when the page itself is a Client Component.
- **Liveness/readiness**: poll `GET /api/health`. Returns `200 {"status":"ok","database":"connected"}`
  when healthy, `503 {"status":"degraded","database":"unreachable"}` when Postgres is unreachable
  (D047 — previously always returned 200 regardless of DB state). Point your platform's health
  check / load balancer probe at this endpoint.
- **Structured logs**: every server-side event is a single JSON line (`lib/logger.ts`,
  D053) with `level`, `event`, `timestamp`, and non-secret fields (ids, counts, enums,
  durations, booleans — never tokens, hashes, or passwords). Key events to alert or dashboard
  on:
  - `login_locked_out`, `login_failed` — repeated failures against one `adminUserId` may
    indicate a credential-stuffing attempt.
  - `route_crashed`, `outbound_redirect_failed`, `telegram_webhook_rejected` — unexpected
    failures in the public funnel or Telegram integration; these should be rare in steady state.
  - `paybig_import_completed` — one line per CSV import with `totalRows`, `created`,
    `duplicates`, `statusUpdated`, `invalidCount`, `unmatchedCount`; a high `invalidCount` or
    `unmatchedCount` on an import may indicate Paybig's export format has drifted.
- **Request correlation**: every request carries an `x-request-id` (generated in
  `src/proxy.ts` if not already present upstream, D053) and every log line from that
  request's handling shares it — use it to trace one request's full log trail. Note this is
  distinct from `Click.id`, which correlates one visitor's journey *across* the separately
  issued `/l → /gate → /path → /out` requests.
- **Error boundaries**: `src/app/error.tsx` and `src/app/global-error.tsx` (D053) catch
  unexpected render failures and log `client_error_boundary` with the error message only
  (never the full error object, to avoid leaking stack details client-side) — treat any
  occurrence as worth investigating, since it means a user saw a generic failure page.
- **No APM/metrics backend is wired up.** All observability here is log-based; if a hosting
  platform's log aggregation isn't already in place, stdout/stderr must be captured somewhere
  durable before these logs are useful for anything beyond `grep`-ing a live server.

## 5. Backup strategy

- **Database**: PostgreSQL is the sole source of truth for all configuration, click, funnel
  event, and conversion data. Use your hosting provider's or Postgres's own point-in-time
  recovery / scheduled `pg_dump` backups — no FunnelCore-specific backup tooling exists or is
  needed beyond standard Postgres practice. Back up before every `prisma migrate deploy`.
- **`ENCRYPTION_KEY`**: back this up like a credential, not like config (e.g. a secrets
  manager with its own durability guarantees), completely separate from the database backup.
  Losing it makes every stored Telegram token and API credential permanently undecryptable —
  there is no recovery path other than re-entering them through the admin UI (see §7). A
  database restore without the matching `ENCRYPTION_KEY` restores unusable ciphertext.
- **No automated backup verification exists.** Restoring a backup to a scratch environment and
  confirming the app boots against it (including that `ENCRYPTION_KEY` still decrypts existing
  secrets) is a manual operational practice to establish, not something this codebase automates.

## 6. Rollback strategy

- **Application code**: standard — redeploy the previous build/image. No FunnelCore-specific
  state is held outside the database, so a code rollback alone is safe as long as no migration
  from the newer version has been applied against the database yet.
- **Database migrations**: `prisma migrate deploy` only ever applies forward migrations; there
  is no automated down-migration tooling (standard for Prisma). Before applying a new
  migration in production, confirm it is additive (new tables/columns/indexes) rather than
  destructive — every migration in this project so far has been additive. If a migration ever
  needs to be reverted, that requires a hand-written down-migration reviewed with the same care
  as the original, plus a fresh backup taken immediately before applying the forward migration.
- **Feature-level rollback**: because this milestone's changes are additive (new columns, new
  optional CSV column, new admin-side checks), reverting the application code alone — without
  reverting the migration — leaves the database in a compatible state: the older code simply
  ignores the new `AdminUser.failedLoginAttempts`/`lockedUntil` columns and the new `Click`
  indexes, and never reads a `status` value from re-imported CSVs it doesn't know about. The one
  exception is campaign-slug immutability (D049): rolling back only the application code
  re-enables slug edits at the code level, but any campaign already locked by this milestone's
  logic simply becomes editable again — no data is at risk either way.
- **Telegram webhook**: if a deployment's `APP_BASE_URL` changes (e.g. rolling back to a
  different host), re-run the admin's bot **Validate** action for each Telegram bot to
  re-register `setWebhook` against the correct URL.

## 7. Known V1 limitations

Carried forward from RELEASE_CHECKLIST.md §4, updated for what this milestone closed and what
remains open (see OPEN_QUESTIONS.md for full reasoning on each):

**Closed this milestone** (previously listed as limitations in RELEASE_CHECKLIST.md, now fixed):
- No login rate-limiting/lockout → fixed (D044).
- `/api/health` always returned 200 regardless of DB state → fixed (D047).
- No tracking-link filter on the attribution dashboard despite PRODUCT_SPEC.md naming it as a
  reportable dimension → fixed (D050).
- `/admin/conversions` capped at 50 rows with no pagination/search → fixed (D051).
- `Click.brandId`/`platformId`/`socialAccountId` had no covering index → fixed (D052).
- `ConversionStatus` existed but nothing ever transitioned it → fixed for CSV-driven
  confirm/reverse (D048).
- Campaign slugs could be edited after publish, silently changing future Paybig-lane matching →
  fixed; now immutable after first publish (D049).
- Zero structured logging/observability, no error boundaries → fixed (D053).

**Still open, unchanged by this milestone (deliberate V1 scope, per DECISIONS.md D043):**
- **No automatic traffic splitting, winner selection, or statistical inference for
  experiments.** Arms are wired to links entirely by hand.
- **Signup attribution is campaign-level only.** Paybig's CSV only round-trips `campaign_slug`
  — never a click id — so more granular signup rates are structurally unavailable in V1.
- **Attribution stays last-click, deterministic.** No first-touch or multi-touch model.
- **CSV import has no batching/streaming and a flat 10 MB upload cap.** Fine at tested volumes;
  a much larger or more frequent Paybig export would need background job processing.
- **`AdminRole.VIEWER` is not enforced anywhere**, and RBAC stays single-role for V1. Currently
  unreachable in practice (no admin-user-management UI exists to create a VIEWER account).
- **Pausing/archiving a tracking link only blocks new clicks**, by ratified decision (D043.1) —
  a visitor already mid-funnel can still complete the funnel off the frozen snapshot. An
  emergency kill-switch is deferred to a future milestone if compliance requires it.
- **The 18+ gate is a click-through acknowledgement, not identity verification**, by ratified
  decision (D043.2) — AdultPrime remains authoritative.
- **Click fraud is logged, never blocked**, by ratified decision (D043.7) — and there is
  currently no fraud-signal collection to log yet; reporting exposure is deferred.
- **Paybig integration stays CSV import**, by ratified decision (D043.5), until the business
  confirms a live API/webhook is actually available.
- **`Campaign.isDefault`'s "at most one default" rule is application-enforced only**, not a DB
  constraint — a narrow concurrent-edit race could leave two campaigns flagged default. Accepted
  as a data-quality nuisance, not an attribution-correctness issue.
- **No key-rotation support for `ENCRYPTION_KEY`.** Rotating it without re-encrypting existing
  ciphertext makes every existing secret permanently undecryptable (a loud failure, by design).
- **The Paybig CSV contract is still assumed, not confirmed against a real export.** Every test
  (automated and manual) uses synthetic CSVs built from the documented minimum-field spec.
- **No CSV-import audit-trail atomicity.** The audit-log row is written once, after all rows
  are processed, as a separate statement — a crash between the last row committing and that
  write leaves the import's data correct but its audit-trail entry missing.

## 8. Production smoke tests

Run these against the real production (or a production-like staging) deployment before, and
periodically after, directing real traffic at it. Each is marked by how it can be verified in
this environment — several require infrastructure (a real domain, HTTPS, a real Paybig export)
that does not exist in this sandbox, so they are documented as manual post-deploy checks rather
than claimed as automated.

| # | Smoke test | Automated coverage | Manual post-deploy check required |
|---|---|---|---|
| 1 | Real domain routing (`/l/{token}` resolves via the production `Domain` row's real hostname) | `public-routing.test.ts` covers hostname resolution logic (incl. case-insensitivity, D037) against fixture domains | **Yes** — no real DNS exists in this sandbox; confirm a real tracking link resolves through the production domain once DNS is live |
| 2 | HTTPS (TLS termination, HSTS header takes effect) | `Strict-Transport-Security` header presence verified live via curl in this milestone | **Yes** — HSTS is inert over plain HTTP; confirm the production load balancer/proxy terminates TLS and the header is actually honored by a browser |
| 3 | Telegram webhook validation (`setWebhook` against the real public URL, real `/start` delivery) | `telegram-webhook.test.ts`/`telegram.test.ts` cover the handler logic against a mocked API; a real `getMe` call against a fake token was verified this environment | **Yes** — `setWebhook` itself was never exercised against a reachable production URL in this sandbox; run the admin's Validate action once deployed and send a real `/start` |
| 4 | Paybig import with a real sample file | `paybig-import.test.ts` covers parsing/validation/dedup/status-update against synthetic CSVs built from the documented spec | **Yes** — no real Paybig export has been obtained; import one real sample and confirm the on-screen summary matches expectations before trusting it for a real reconciliation |
| 5 | Conversion reversal (CSV `status=reversed` updates an existing conversion) | Fully covered — `paybig-import.test.ts` (D048) | No — automated coverage is sufficient |
| 6 | Login throttling (5 failed attempts locks the account for 15 minutes) | Fully covered — `login-rate-limit.test.ts` (D044), also verified live this milestone | No — automated + live verification already done |
| 7 | Health endpoint (`503` during a DB outage, `200` after recovery) | `health.test.ts` covers the pure logic; verified live against a real `docker stop`/`start` outage this milestone | No — already verified against a real outage, though re-confirming once against the production DB/network path post-deploy is reasonable due diligence |
| 8 | Tracking link pause (an in-flight visitor completes the funnel; a fresh visitor is blocked at `/l`) | `public-routing.test.ts` covers `resolveTrackingLinkVersion` rejecting a paused link's *new* resolution | No — this is the ratified, unchanged V1 behavior (D043.1); no new code to smoke-test |
| 9 | Immutable snapshots after campaign edits (editing a campaign post-publish never changes an already-published version's behavior) | `tracking-link-publishing.test.ts`'s critical-invariant test asserts byte-for-byte snapshot equality after a campaign edit; verified live in the V1 QA pass (RELEASE_CHECKLIST.md) | No — already covered by both automated test and live verification |

**Additional smoke tests specific to this milestone's changes, verified live during development
(not requiring production infrastructure, safe to re-run identically in production):**
- `GET /api/health` returns the 5 security headers plus a nonce-bearing `Content-Security-Policy`.
- Corrupting `ENCRYPTION_KEY` causes the app to fail to boot with a named error, rather than
  starting and failing later.
- Editing a campaign's slug after it has been used in a published tracking link is rejected,
  including a direct attempt to tamper with the admin form's hidden slug field.
- The reports page's tracking-link filter correctly narrows results and flags signup-rate
  incompatibility.
- `/admin/conversions` search and pagination return correct results and correct page counts.
