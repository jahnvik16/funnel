# FunnelCore V1 — Release Checklist

Produced by a full QA pass: read CLAUDE.md, PRODUCT_SPEC.md, ARCHITECTURE.md, TEST_PLAN.md,
and DECISIONS.md, then exercised the complete system end to end (admin creation through
Telegram/Paybig/experiment attribution) against a real local Postgres and a real running dev
server, plus the automated suite. See DECISIONS.md D042 for the one bug this pass found and
fixed, and the QA session referenced there for the full list of scenarios and failure cases
exercised.

## 1. Implemented

**Admin configuration (CRUD, archive not delete):** Brand, Platform, SocialAccount, Domain,
Campaign, TrackingLink, TelegramBot, ApiConnection, Experiment/ExperimentArm — all behind
session-authenticated admin routes, all mutations audit-logged.

**Publishing & versioning:** `TrackingLinkVersion` is immutable once published; every publish
freezes a full snapshot (domain, token, brand, platform, campaign incl. Paybig URL, social
account, path type/config, age gate, experiment/arm) so later edits to any of those mutable
rows never retroactively change an already-published version's behavior. Validation
(`lib/tracking-link-publishing.ts`) runs before every publish and blocks it entirely on any
failure — no partial/invalid version can ever be created.

**Public funnel:** `GET /l/{token}` → optional `/gate/{clickId}` (18+ interstitial) →
`/path/{clickId}` (path-type branch: `direct` skips straight through, `aggregator` renders an
owned page, `telegram` mints a short-lived deep-link payload) → `/out/{clickId}` (single egress
point, idempotent). Every step writes a `FunnelEvent`; `Click` captures a full attribution
snapshot at click time that never changes afterward.

**Telegram funnel path:** live bot validation (`getMe`) populates the real `@username`
publishing requires; opaque, short-lived (15 min), unguessable start payloads that encode
nothing themselves; webhook resolves `/start`, logs `TELEGRAM_STARTED` idempotently, replies
with a CTA back into `/out`; webhook secret checked "as far as practical" (permissive until a
real secret is registered, exact-match once one is).

**Paybig conversion import:** admin-uploaded CSV (`conversion_id` optional, `conversion_time`,
`campaign_slug`, `amount`, `currency`), deduplicated by `conversion_id` (composite-key fallback
documented as a known limitation when absent), campaign-slug matched across all brands
(ambiguous or unmatched never guessed — the row is still recorded, just unattributed), one
audit-log entry per import batch with the full row-level summary.

**Attribution reporting:** filterable dashboard (date range, brand, platform, campaign, path,
social account, experiment, experiment arm) computing clicks/gate-accepts/aggregator-views/
telegram-starts/outbound-redirects at full filter precision, and signups at the campaign level
only — with a visible warning whenever a selected filter can't be honored by signup data, never
a silently-wrong number.

**Experiments (V1 scope — manually assigned, no automation):** an Experiment groups named
`ExperimentArm`s; an arm is wired to a tracking link only by publishing that link with the
experiment/arm selected (no separate "assign" step, no traffic-splitting execution, no
automatic winner selection). The per-arm dashboard shows precise funnel metrics per arm plus a
clearly-labeled, honestly-non-exclusive campaign-level signup figure.

**Security baseline:** bcrypt password hashing, DB-backed opaque session tokens (only a
SHA-256 hash persisted), AES-256-GCM field-level encryption for Telegram tokens/webhook
secrets/API credentials, constant-time webhook-secret comparison, timing-equalized login
(no email-enumeration via response time), audit logging enforced in a shared helper (not
optional per mutation), a partial DB-level unique index preventing duplicate one-time
`FunnelEvent`s even under genuine concurrency.

## 2. Tested

**Automated (`npm test`): 113 tests, 0 failures.** `npm run lint`, `npm run typecheck`, and
`npm run build` all pass clean. See TEST_PLAN.md for what each test file covers in detail.

**Manual end-to-end QA (this milestone), against a real running dev server and real Postgres —
every item below was exercised live, not just asserted in a unit test:**

- Full scenario: seed an admin → log in → Brand → Platform → SocialAccount → Domain → Campaign
  → Telegram bot → TrackingLink → Validate → Publish → real click through `/l` → `/gate`
  (18+ shown, accepted) → `/path` (aggregator view) → `/out` (Paybig redirect) — `Click` and
  every `FunnelEvent` verified directly in Postgres at each hop, not just via rendered pages.
- Telegram flow: deep-link payload minted, simulated webhook `/start` call resolved it,
  `TELEGRAM_STARTED` logged idempotently, `/out` reached via the CTA link.
- Paybig CSV import: golden path (matched, unmatched, default-campaign, and malformed rows in
  one file), re-uploading the identical file (zero new rows), and the same `conversion_id`
  reappearing with a different amount (original preserved, not overwritten).
- Attribution dashboard and per-arm experiment dashboard verified against known, hand-computed
  numbers from the exact clicks/conversions created during this session.
- **Critical invariant, verified live**: published `TrackingLinkVersion` v1, then edited the
  campaign's Paybig URL — v1's frozen snapshot was byte-for-byte unchanged, and a brand-new
  click through the *same, unrepublished* link still resolved through the old, frozen data.
- **Failure cases, all 17 named in the QA brief, exercised live**: unknown token, inactive
  (paused) tracking link, unpublished link, inactive (archived) campaign, missing Paybig URL,
  invalid path configuration (blank destination URL), invalid Telegram bot (malformed token
  format, and a not-yet-validated bot), expired Telegram payload, duplicate conversion,
  duplicate import, unmatched conversion, campaign changed after publishing, unauthorized
  admin access (redirects to login), secret leakage (checked the rendered DOM *and* the raw
  RSC network payload for the Telegram bot token — neither ever appears), malformed CSV (an
  invalid-amount row, and a deliberately corrupted file with embedded NUL bytes — see D042),
  a live database outage (stopped Postgres mid-session: public route fails with a bare 500 and
  no leaked detail, `/api/health` correctly reports `database: unreachable`, the app reconnects
  on its own once Postgres is back, no restart needed), and an invalid webhook request
  (malformed JSON body → 400; unknown bot id → 200 no-op, exactly as designed).
- Secrets confirmed absent from the dev server's logs across the entire session (grepped for
  every bot token, the admin password, and ciphertext/passwordHash field names — zero matches).

**Not re-verified live (already covered by the automated suite, not worth re-deriving
manually):** Telegram webhook secret *mismatch* rejection (401) — `handleTelegramWebhook`'s
mocked-API tests cover this directly; setting up a real encrypted webhook secret by hand for a
live check would have added risk without adding confidence.

## 3. Bug found and fixed during this QA pass

**A NUL byte anywhere in an uploaded CSV crashed the entire import with an unhandled 500**,
instead of being reported as an invalid row. Even a row that fails validation (and so never
reaches `Conversion.create`) had its raw content embedded verbatim in the import's `AuditLog`
entry; Postgres's `text`/`jsonb` types reject a NUL byte outright, so that single write failed
and took the whole request down with it. The same would have happened to `Conversion.rawPayload`
itself for a row that *passed* validation but had a NUL byte in an ignored extra column. Fixed
by stripping NUL bytes at the CSV tokenizer, the same layer that already strips a leading UTF-8
BOM. Two regression tests added (`paybig-import.test.ts`); reproduced and re-verified fixed live
in the browser, not just in the test suite. See DECISIONS.md D042.

No other bugs were found. Every other failure case and invariant behaved exactly as documented
in ARCHITECTURE.md and DECISIONS.md.

## 4. Known limitations (by design, not oversights)

These are documented, reasoned V1 scope boundaries — see OPEN_QUESTIONS.md for the full
reasoning behind each:

- **No automatic traffic splitting, winner selection, or statistical inference for
  experiments.** Arms are wired to links entirely by hand; `ExperimentArm.weight` is stored and
  displayed but never acted on.
- **Signup attribution is campaign-level only.** Paybig's CSV only round-trips `campaign_slug`
  — never a click id — so click/path/social-account/experiment-level signup rates are
  structurally unavailable, not just unimplemented. The dashboard makes this explicit rather
  than estimating.
- **CSV import has no batching/streaming and a flat 10 MB upload cap.** Fine at the volumes
  tested; a much larger or more frequent export would need background job processing, which is
  out of V1 scope.
- **`AdminRole.VIEWER` is not enforced anywhere.** Currently unreachable in practice — there is
  no admin-user-management UI, so every account is provisioned by the seed script as `ADMIN`.
  If admin-user management is ever built, real role checks must land in the same change.
- **No login rate-limiting/lockout.** A timing side-channel that would have let an attacker
  enumerate valid admin emails was closed this milestone; brute-forcing a *known* email's
  password is not otherwise slowed down. A correct fix needs a persistent, shared attempt
  counter — real infrastructure, not a hardening tweak.
- **Pausing/archiving a tracking link only blocks new clicks.** A visitor already mid-funnel
  (holds a `clickId`) can still complete `/gate` → `/path` → `/out` after the link is paused,
  since those routes read only the frozen per-click snapshot by design. Whether that's the
  right behavior for "archived" (vs. "paused") is an open product question, not decided here.
- **`Campaign.isDefault`'s "at most one default per brand+platform" rule is application-enforced
  only**, not a DB constraint — a narrow concurrent-edit race could leave two campaigns flagged
  default. Reviewed this milestone; accepted as low-stakes (a data-quality nuisance, not
  attribution corruption).
- **No key-rotation support for `ENCRYPTION_KEY`.** Rotating it without re-encrypting existing
  ciphertext makes every existing secret undecryptable (a loud failure, by design — silent
  failure would be worse).
- **`/api/health` returns HTTP 200 even when the database is unreachable** (the body correctly
  reports `"database": "unreachable"`). A monitor that only checks status codes, not body
  content, would not detect a DB outage through this endpoint alone. Left as-is deliberately —
  choosing 503 here is a liveness-vs-readiness deployment decision this checklist shouldn't make
  unilaterally (see §5).

## 5. Required production credentials / configuration

All of the following are read from environment variables (see `.env.example`); none has a
usable default, and the app fails loudly at startup or first use if one is missing, never
silently:

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Must point at a real, reachable Postgres 16+ instance |
| `ENCRYPTION_KEY` | AES-256-GCM key for Telegram tokens/API credentials | Base64-encoded, must decode to exactly 32 bytes. **Generate a real random value for production** — never reuse the local dev value. No rotation mechanism exists (see §4) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First admin account, provisioned by `prisma db seed` | Password must be 8+ characters; the seed is an `upsert`, safe to re-run |
| `APP_BASE_URL` | Public base URL used to build the Telegram webhook URL and in-chat CTA links | Must be the real public HTTPS origin in production — `setWebhook` will not succeed against `http://localhost` or a non-public URL |
| `PAYBIG_API_BASE_URL` / `PAYBIG_API_KEY` / `PAYBIG_WEBHOOK_SECRET` | Reserved in `.env.example` | **Currently unused** — V1 ships Paybig conversions as an admin-uploaded CSV, not a live API/webhook integration (see OPEN_QUESTIONS.md). Do not treat their presence as required for V1 to function |

Real Telegram bot tokens and any real Paybig credentials are entered through the admin UI
(encrypted at rest immediately), never via environment variables or committed files.

## 6. Deployment requirements

- **Runtime**: Node.js compatible with the pinned `prisma`/`@prisma/client` 6.19.3 (see
  DECISIONS.md D010 — avoid npm-`latest` Prisma 7.x unless the engine-range gate has changed).
- **Database**: PostgreSQL 16+ reachable from the app at boot; run `prisma migrate deploy`
  (not `migrate dev`, which requires an interactive terminal) against it before first start.
  There are 7 migrations as of this release, the most recent adding a hand-authored partial
  unique index (not expressible in Prisma's schema DSL) — confirm it applied via
  `\d funnel_events` showing `funnel_events_singleton_step_unique`.
- **HTTPS with a real public hostname** is required before the Telegram integration can fully
  work (`setWebhook` needs to reach `APP_BASE_URL` from Telegram's servers) — the app itself
  runs fine without it, but Telegram bot validation will report a webhook-registration warning
  until the deployment has one.
- **One deployable** serves both the admin UI and the public funnel route (see ARCHITECTURE.md
  §7) — no separate service to stand up for V1.
- **Seed the first admin** (`npm run prisma:seed`) once, after migrations, before anyone can log
  in — there is no other way to create the first account.
- No background job runner, queue, or cron is required for anything currently built. If CSV
  import volume grows beyond what a single request can process (see §4), that would be new
  infrastructure, not a config change.

## 7. Remaining risks

Ranked by what would actually hurt if it went wrong in production, not by how it's phrased
above:

1. **A very large or very frequent Paybig CSV export** would exceed what the current row-by-row,
   single-request import can handle inside typical serverless/reverse-proxy request timeouts.
   The 10 MB cap fails fast rather than hanging, but doesn't solve the underlying scale
   question — unknown until real export volume is known (OPEN_QUESTIONS.md).
2. **No login lockout** means a leaked or weak admin password is the single point of failure for
   the entire system (every admin action, every secret, is reachable from one login). Strongly
   worth a real password and, longer-term, a real rate-limiting mechanism.
3. **`ENCRYPTION_KEY` loss or accidental rotation** makes every stored Telegram token and API
   credential permanently undecryptable, with no recovery path other than re-entering them
   through the admin UI. Back this value up like a credential, not like config.
4. **The Paybig CSV contract is still assumed, not confirmed against a real export.** Every test
   (automated and manual) uses synthetic CSVs built from the milestone's documented minimum-field
   spec. If Paybig's real export differs in column naming, encoding, or granularity, the import
   will likely surface it as "every row invalid" rather than a crash (per this milestone's fixes)
   — but the mapping itself hasn't been validated against a real file.
5. **A visitor mid-funnel isn't stopped by pausing/archiving their link** (§4) — low likelihood,
   but worth a conscious decision before it matters for a compliance-driven takedown.
6. **`Campaign.isDefault` and Telegram webhook message delivery both have narrow,
   already-reviewed concurrency edge cases** (see DECISIONS.md D034 for what *was* hardened, and
   OPEN_QUESTIONS.md for what wasn't) — neither corrupts attribution data, both are accepted
   V1 tradeoffs.

**Overall assessment: ready for a production pilot with a real admin password, a freshly
generated `ENCRYPTION_KEY`, and a real public HTTPS deployment — provided the operator
understands Paybig ingestion is a manual CSV upload, not a live integration, and that
experiment arms are wired up by hand.** Nothing found in this QA pass blocks release; the one
bug found was fixed and verified. The risks above are things to watch, not things to fix before
shipping.
