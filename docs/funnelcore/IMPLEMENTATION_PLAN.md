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

## Phase 4 — Public route + click logging + funnel events (mostly done)

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
- [ ] `telegram` path executor — explicitly deferred; a Telegram-path click fails safely
      (`ROUTE_FAILED`, reason `unsupported_path_type`) rather than attempting a redirect with
      no real destination. Revisit alongside the Telegram integration work in
      OPEN_QUESTIONS.md.
- [ ] Load test / sanity check the hot path for latency — not done. This is the one route
      real users hit directly from ads/social; do this before real traffic depends on it.

## Phase 5 — Conversion ingestion + attribution

- Inbound endpoint for Paybig conversion data (webhook and/or scheduled pull — depends on
  what Paybig actually offers; see OPEN_QUESTIONS.md).
- Attribution join: `Conversion` → `Click` (via whatever key Paybig round-trips) → `Campaign`
  / `Brand` / `TrackingLinkVersion`.
- Idempotent ingestion keyed on `paybigConversionId`.

## Phase 6 — Reporting

- Clicks by brand/platform/campaign/tracking link, with date range filters.
- Funnel step drop-off (gate shown → passed → redirected → converted).
- Paid-conversion attribution report answering the core business question directly.

## Phase 7 — Experiment execution (if still needed)

`Experiment`/`ExperimentArm` CRUD and arm-to-version assignment already exist (Phase 1b/2/3).
What's still undone, and only worth building after Phase 6 ships and the team confirms it's
still wanted for V1: actually splitting public traffic across an experiment's arms inside the
`/l/[token]` route (currently that route doesn't exist yet — see Phase 4). Do not build a
generic experimentation framework speculatively.

## Sequencing notes

- Each phase should ship with its own tests per TEST_PLAN.md before moving on.
- Phases 1–3 (config + versioning) must be solid before Phase 4 (public route) goes live,
  since Phase 4 depends on version resolution being correct and fast.
- Phase 5 (conversions) can only be finalized once Paybig's actual data contract is known —
  flagged in OPEN_QUESTIONS.md as a blocking unknown.
