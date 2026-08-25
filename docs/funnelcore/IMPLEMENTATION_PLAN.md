# FunnelCore — Implementation Plan

This plan is phased. **Only Phase 0 is authorized right now.** Do not begin Phase 1 without
explicit sign-off, even if it looks like the obvious next step — see root `CLAUDE.md`.

## Phase 0 — Foundation (this milestone)

Goal: a runnable, empty-but-correct skeleton with the architecture and documentation in place,
so every later phase has a stable base to build on.

- [x] Local git repo cloned into `Desktop/FunnelCore`, remote verified against
      `https://github.com/jahnvik16/funnel.git`.
- [x] Next.js (App Router) + TypeScript + Tailwind scaffold.
- [x] Prisma configured for PostgreSQL; schema for all V1 entities (no business logic yet).
- [x] `docker-compose.yml` for local Postgres.
- [x] `.env.example` with no real secrets.
- [x] Documentation set under `docs/funnelcore/` (this file included).
- [x] Root `CLAUDE.md` engineering rules.
- [x] Minimal runnable app (health-check route/page) so `npm run dev` works end to end.
- [x] Initial commit pushed to `origin/main` (the repo's first commit ended up bundling
      Phase 0 and Phase 1a together — Phase 0 was scaffolded but never committed before
      Phase 1a work started on the same checkout).

Explicitly **not** in Phase 0: admin UI, public `/l/[token]` route, authentication,
encryption implementation, any CRUD, any reporting.

## Phase 1a — Database foundation + admin auth + base admin shell (this milestone)

- Full V1 schema (all core entities, including `Session`, `ExperimentArm`,
  `TelegramStartPayload`) migrated via Prisma against local Postgres.
- Email/password admin authentication: bcrypt password hashing, database-backed HTTP-only
  session (see DECISIONS.md D009), protected `/admin` route group, login, logout.
- Seed script provisioning the first admin account from environment variables — no public
  registration.
- Minimal authenticated admin shell (logged-in-as header, logout, a read-only dashboard
  proving DB connectivity) — no entity CRUD yet.

Explicitly **not** in this milestone: entity CRUD, the public `/l/[token]` route, Telegram
webhook, Paybig ingestion, reporting, `lib/crypto` field-level encryption implementation
(the ciphertext columns exist in the schema; nothing encrypts/decrypts them yet).

## Phase 1b/2/3 — Full admin configuration CRUD (done together, not phased as originally planned)

The next milestone's brief asked for the complete admin control panel in one pass rather than
split across Brand/Platform/Domain → Campaigns/Telegram/API → TrackingLink as originally
sequenced here. Delivered together:

- [x] CRUD (create/edit/archive-or-deactivate) for `Brand`, `Platform`, `SocialAccount`,
      `Domain`, `Campaign`, `TelegramBot`, `ApiConnection`, `Experiment`, `ExperimentArm`.
- [x] `lib/audit.ts` shared mutation helper (`writeAuditLog` + `redactSecretFields`), called
      inside the same transaction as every create/update/archive across all entity actions.
- [x] `lib/crypto.ts` AES-256-GCM field-level encryption, wired into
      `TelegramBot.botTokenCiphertext` and `ApiConnection.credentialsCiphertext`. Neither
      ciphertext column is ever selected into a page/component (`selects.ts` per entity) or
      written into an `AuditLog` row unredacted.
- [x] `lib/telegram.ts` format-only bot token validation (see DECISIONS.md D012 — no live
      Telegram API call in this milestone).
- [x] `TrackingLink` CRUD (label/domain editable, brand/token fixed at creation — D013) plus a
      first-pass publish flow (superseded by Phase 3b below).
- [x] Admin nav shell linking all nine list pages.
- Not resolved by this milestone: the Paybig integration contract (still open — see
  OPEN_QUESTIONS.md); `Campaign.paybigCampaignRef` was replaced with `paybigUrl` (a direct
  destination URL) per the updated brief, which sidesteps needing that contract decided yet.

## Phase 3b — TrackingLink validation, publishing, versioning, and lifecycle (done)

- [x] `lib/tracking-link-publishing.ts` — a full validation rule set (domain/brand/campaign/
      social-account/Telegram-bot/experiment-arm existence and active status, cross-entity
      relationship checks, path-config validity, token-per-domain uniqueness) plus the publish
      transaction, kept framework-independent so it's directly testable.
- [x] `TrackingLinkVersion.snapshot` — a frozen, denormalized copy of everything routing needs
      (domain, token, brand, platform, campaign + Paybig URL, social account, path type/config,
      age gate, experiment/arm), captured at publish time. See DECISIONS.md D016.
- [x] `TrackingLink.token` uniqueness changed from global to per-domain (`@@unique([domainId,
      token])`) — see DECISIONS.md D015.
- [x] Admin UI: **Validate** (dry-run, shows every issue found) and **Publish** (validates,
      then writes) as two buttons over one form; **Activate**/**Pause**/**Archive** lifecycle
      buttons; a **Current published version** summary reading the frozen snapshot, alongside
      the existing full version-history table.
- [x] Publishing forces `TrackingLink.status = ACTIVE`; publishing is itself blocked by
      validation when the link is `ARCHIVED`.
- [x] `src/lib/tracking-link-publishing.test.ts` — integration tests against real Postgres,
      including the critical invariant test: editing a campaign's `paybigUrl` after publishing
      does not change the already-published version's snapshot.

## Phase 4 — Public route + click logging + funnel events (done except load testing)

- [x] `GET /l/[token]` → `/gate/[clickId]` (optional) → `/path/[clickId]` → `/out/[clickId]`,
      exactly as designed: resolve `(domain, token)` → current version → write `Click` →
      write `FunnelEvent`(s) at each step → redirect. Reads routing data from
      `TrackingLinkVersion.snapshot` (D016) rather than re-joining Campaign/SocialAccount/
      TelegramBot. See ARCHITECTURE.md §4 and DECISIONS.md D018.
- [x] `direct` and `aggregator` path executors, both terminating at `/out/[clickId]`.
- [x] Age gate UI: neutral, non-explicit interstitial; accept/decline both logged; no
      cookie/session — the click id in the URL is the only state carried through (simpler
      than the original "cookie/session remembered per visitor for a TTL" idea, and matches
      the brief's "do not add scene/session attribution").
- [x] Idempotency for `/out` and the gate's accept/decline (D020) — found via manual testing,
      not originally planned, but necessary for correct event counts.
- [x] `telegram` path executor — done in the Telegram funnel path milestone below (Phase 4a).
- [ ] Load test / sanity check the hot path for latency — not done. This is the one route
      real users hit directly from ads/social; do this before real traffic depends on it.

## Phase 4a — Telegram funnel path (done)

- [x] Live bot validation (`getMe`) replacing the format-only check from Phase 1b/2/3 — see
      DECISIONS.md D022. Admin **Validate** action populates `botUsername` and best-effort
      registers the webhook (`setWebhook`, D024).
- [x] `TelegramStartPayload` actually used: minted at `/path/[clickId]` for `pathType =
      TELEGRAM`, resolved by the webhook, opaque and short-lived (D023).
- [x] `POST /api/telegram/webhook/[botId]` — verifies the per-bot secret "as far as
      practical" (D024), parses `/start <payload>`, resolves attribution, logs
      `TELEGRAM_STARTED` (idempotent), replies with the bot's welcome message + a CTA button
      linking to `/out/{clickId}`.
- [x] `/out/[clickId]` extended to accept `TELEGRAM`, using `campaign.paybigUrl` as the
      destination (D025) since `TELEGRAM`'s `pathConfig` has no `destinationUrl` field.
- [x] Publishing a `TELEGRAM` version now requires a validated bot (`botUsername` set) —
      closes the gap where a `TELEGRAM` link could be published pointing at a bot with no
      known `@username`, which would have made the deep link impossible to build.
- [x] Verified against the real Telegram API in manual testing: `getMe` and `sendMessage`
      both returned genuine Telegram error responses for a deliberately fake token, proving
      the network integration itself (not just the mocked test suite) is wired correctly.
      `setWebhook` was not verified against a real reachable URL — see OPEN_QUESTIONS.md.

## Phase 5 — Conversion ingestion + attribution (done, as a CSV import — see below)

- [x] `lib/paybig-import.ts` — CSV parsing (hand-rolled, RFC4180-ish), row validation, dedup
      (`conversion_id` preferred, documented composite-key fallback — DECISIONS.md D027),
      `campaign_slug` matching against `Campaign.slug` across all brands (ambiguous/not-found
      both treated as unmatched, never guessed — D028), and a per-import summary (created/
      duplicates/invalid/unmatched/matched counts).
- [x] Admin UI: `/admin/conversions` — CSV upload form, inline import summary (invalid rows
      with reasons, unmatched `campaign_slug` values with reasons), recent-conversions table.
      One `AuditLog` row per import batch (`IMPORT` action), not per `Conversion` row.
- [x] Idempotent ingestion keyed on `paybigConversionId` (already `@unique` from Phase 0) —
      repeated imports of the same file create zero new rows the second time.
- Resolved: V1's actual answer to "what does Paybig's conversion data look like" is a
  **campaign-level** CSV export (`campaign_slug`, no click/sub-id). The `Conversion` → `Click`
  join anticipated in this phase's original brief never happens in V1 — `clickId` stays null
  for every CSV-imported row. See OPEN_QUESTIONS.md (updated) and DECISIONS.md D029.

## Phase 6 — Reporting (done)

- [x] `lib/attribution-report.ts` + `/admin/reports` — filters for date range, brand, platform,
      campaign, path, social account, experiment, and experiment arm.
- [x] Funnel metrics (clicks, age gate accepts, aggregator views, Telegram starts, outbound
      Paybig redirects, outbound redirect rate) computed from `Click`/`FunnelEvent` at full
      filter granularity.
- [x] Signup attribution (campaign-level): signups, signup rate per click, signup rate per
      outbound redirect, unmatched conversions, default/catch-all conversions — computed only
      at the campaign-level-compatible filters (date/brand/platform/campaign). Selecting a
      path/social-account/experiment/experiment-arm filter visibly flags the rate metrics as
      unavailable rather than silently showing a number the data can't support — see
      DECISIONS.md D029, the milestone's "critical attribution rule."

## Phase 7 — Aggregator vs Telegram experiment framework (done, manually assigned — see below)

The brief confirmed this milestone explicitly and drew a hard V1 line: manually assigned
tracking links/accounts, no automatic randomization, no automatic winner selection, no
statistical inference, no generic experimentation engine.

- [x] Schema: `Experiment.brandId` made optional, `Experiment.platformId` (optional) and
      `Experiment.successMetric` (required, a fixed enum mirroring the dashboard's metrics)
      added. `Experiment.trackingLinkId` — the old single-link scoping field, structurally
      incompatible with two arms needing two different path types/links — removed. See
      DECISIONS.md D030/D031.
- [x] Admin UI: experiment brand/platform/success-metric fields; simplified arm creation
      (name + weight only — a tracking link is wired to an arm exclusively by publishing that
      link with the experiment/arm selected, the existing Phase 3b mechanism, now the *only*
      path since the direct-assign shortcut on arm creation was removed).
      `lib/tracking-link-publishing.ts` gained a brand-match check between an arm's experiment
      and the publishing link, mirroring the existing social-account/telegram-bot checks.
- [x] `lib/attribution-report.ts`'s `buildExperimentArmReport` — one row per arm: clicks, gate
      accepts, aggregator views, Telegram starts, and outbound redirects computed precisely
      (scoped by `experimentArmId`, reusing the existing `buildAttributionReport`); a
      campaign-level signups figure shown honestly (not allocated/estimated per arm) with a
      clear label and a warning when two arms share a campaign. See DECISIONS.md D032.
- [x] Experiment detail page's new "Arm performance" table renders the above, plus the
      experiment's `successMetric` for reference (an extra warning appears when the chosen
      metric is `SIGNUPS`, since that one can never be measured per arm in V1).
- [x] Deliberately not built: traffic splitting/weighting execution (`ExperimentArm.weight` is
      stored and displayed only), winner selection, confidence intervals, or any generic
      experimentation abstraction beyond the fixed "grouping of arms" shape. See DECISIONS.md
      D033.

## Sequencing notes

- Each phase should ship with its own tests per TEST_PLAN.md before moving on.
- Phases 1–3 (config + versioning) must be solid before Phase 4 (public route) goes live,
  since Phase 4 depends on version resolution being correct and fast.
- Phase 5 (conversions) can only be finalized once Paybig's actual data contract is known —
  flagged in OPEN_QUESTIONS.md as a blocking unknown.
