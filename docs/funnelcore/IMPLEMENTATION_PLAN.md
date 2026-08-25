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

## Phase 1b — Core config CRUD (Brand/Platform/Domain)

- CRUD (create/edit/archive) for `Brand`, `Platform`, `Domain`.
- Shared mutation helper that enforces `AuditLog` writes on every create/update/archive.
- Admin shell UI (list + detail + form) using shadcn/ui, built on the Phase 1a shell.

## Phase 2 — Social accounts, campaigns, Telegram bots, API connections

- CRUD for `SocialAccount`, `Campaign` (Paybig lane), `TelegramBot`, `ApiConnection`.
- Implement `lib/crypto` field-level encryption; wire it into `TelegramBot.botTokenCiphertext`
  and `ApiConnection.credentialsCiphertext`. No plaintext secret ever leaves the server.
- Decide and document the Paybig integration contract (see OPEN_QUESTIONS.md) enough to know
  what a `Campaign.paybigCampaignRef` needs to hold.

## Phase 3 — TrackingLink + versioning + publish flow

- CRUD for `TrackingLink` (create as draft, no live behavior until first publish).
- Publish flow: build a `TrackingLinkVersion` from the admin form, write it + update
  `TrackingLink.currentVersionId` in one transaction.
- Version history view (read-only list of past versions per link).

## Phase 4 — Public route + click logging + funnel events

- `GET /l/[token]` route handler: resolve link → current version → write `Click` →
  (optional) age gate → execute path type → write `FunnelEvent`(s) → redirect.
- Implement the three V1 path type executors: `direct`, `aggregator`, `telegram`.
- Age gate UI (simple interstitial, cookie/session remembered per visitor for a TTL — TBD).
- Load test / sanity check the hot path for latency (this is the one route real users hit
  directly from ads/social).

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

## Phase 7 — Experiments (if still needed)

- Only after Phase 6 ships and the team confirms experiments are still wanted for V1 — the
  `Experiment` entity is deliberately underspecified until there's a concrete use case (see
  OPEN_QUESTIONS.md). Do not build a generic experimentation framework speculatively.

## Sequencing notes

- Each phase should ship with its own tests per TEST_PLAN.md before moving on.
- Phases 1–3 (config + versioning) must be solid before Phase 4 (public route) goes live,
  since Phase 4 depends on version resolution being correct and fast.
- Phase 5 (conversions) can only be finalized once Paybig's actual data contract is known —
  flagged in OPEN_QUESTIONS.md as a blocking unknown.
