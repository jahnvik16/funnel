# FunnelCore — Decisions Log

Append-only. Each entry is a decision made and the reasoning at the time. Don't edit past
entries when a decision changes later — add a new entry that supersedes it and link back.

---

## D001 — Stack: Next.js App Router + TypeScript + PostgreSQL + Prisma + Tailwind + shadcn/ui
**Date:** 2026-08-25
One deployable serves both the authenticated admin UI and the public `/l/[token]` route,
avoiding a second service for V1. Prisma gives typed access to Postgres and clean migration
history, which matters given how much this project depends on schema-level correctness
(immutability, uniqueness constraints). See ARCHITECTURE.md §7.

## D002 — Path types are a fixed enum, not a workflow graph
**Date:** 2026-08-25
The brief is explicit: "Do NOT build a generic workflow builder." `PathType` is
`DIRECT | AGGREGATOR | TELEGRAM` in the schema (an enum, i.e. a developer-owned concept set).
What's configurable per link is the *data* passed to a path type (destination URL, bot
reference, gate on/off), not the *set* of possible behaviors. Adding a 4th path type is a
migration + new handler, not an admin action.

## D003 — Campaign, Brand, Platform, SocialAccount, Domain are tables, never enums
**Date:** 2026-08-25
Directly required by the brief ("do not hardcode brands/platforms/campaigns/social
accounts/domains"). `provider` on `ApiConnection` is a free-form string for the same reason —
adding a new external integration's *credential storage* should never require a schema
change, even though building the integration logic itself still does.

## D004 — Attribution data is copied at write time, not resolved via live joins
**Date:** 2026-08-25
`Click` denormalizes `brandId`/`platformId`/`socialAccountId`/`campaignId` from the
`TrackingLinkVersion` that was current at click time, and `TrackingLinkVersion` rows are
immutable once published. This directly implements the brief's requirement that "historical
attribution must not change because someone edits current configuration." The tradeoff is
some denormalization/redundancy in `Click`, accepted deliberately — see DATA_MODEL.md §4.

## D005 — TrackingLinkVersion holds structural FKs (campaign, socialAccount, telegramBot) but path-specific fields as JSON
**Date:** 2026-08-25
`campaignId`, `socialAccountId`, and `telegramBotId` are real foreign keys on
`TrackingLinkVersion` because they're queried/joined directly in reporting and need
referential integrity. Fields that only make sense for one path type (e.g. a destination URL
for `direct`/`aggregator`, a start-param template for `telegram`) live in a `pathConfig Json`
column instead of as nullable columns per path type, to avoid a wide table of
mostly-null columns. Tradeoff: the DB does not enforce pathConfig's shape — validated at the
application layer. See OPEN_QUESTIONS.md.

## D006 — Secrets are ciphertext columns, decrypted only server-side at point of use
**Date:** 2026-08-25
`TelegramBot.botTokenCiphertext` and `ApiConnection.credentialsCiphertext` are the only
places secrets live, and there is no plaintext secret column anywhere in the schema. Directly
required by the brief. Encryption key comes from an environment variable
(`ENCRYPTION_KEY`, see `.env.example`), never committed.

## D007 — Soft lifecycle (`ACTIVE`/`ARCHIVED`/`PAUSED`), no hard deletes for config entities
**Date:** 2026-08-25
Hard-deleting a `Brand`/`Campaign`/`TrackingLink` etc. would orphan historical `Click`/
`Conversion` rows that reference it, breaking the audit trail and historical attribution.
Config entities are archived, never deleted, at the application layer.

## D008 — Phase 0 (this milestone) builds foundation only — no admin UI, no public route yet
**Date:** 2026-08-25
Explicit instruction from the brief: "For now, DO NOT build the entire product... STOP after
this milestone." IMPLEMENTATION_PLAN.md phases the remaining work; Phase 0 is the only phase
authorized so far.

## D009 — Added `Session`, `ExperimentArm`, `TelegramStartPayload`; database-backed opaque session tokens
**Date:** 2026-08-25
The Phase 1 milestone ("database foundation, migrations, admin authentication, base admin
application") explicitly required `ExperimentArm` and `TelegramStartPayload` as core entities,
and required "HTTP-only session" + "logout" for admin auth:
- `ExperimentArm` is split out of `Experiment.variantConfig` into its own table because arms
  need to be queried/joined directly (which version does this arm serve, what's its weight)
  once traffic-split execution is built — the same reasoning as D005's structural-FK-vs-JSON
  split. `Experiment.variantConfig` remains as free-form experiment-level metadata only.
- `TelegramStartPayload` models the deep-link token that will let a Telegram bot start event
  be traced back to a `Click` (see OPEN_QUESTIONS.md "Telegram"). It is schema-only in this
  milestone — nothing writes to it until the telegram path executor exists (Phase 4).
- `Session` was not in the original core entity list, but "HTTP-only session" + "logout" as
  stated requirements imply something server-side that can be invalidated on demand — a
  signed-stateless-cookie approach can't truly revoke a session before its cookie expires.
  Sessions are database-backed: the cookie holds a random opaque token; only its SHA-256 hash
  is stored (`Session.tokenHash`), mirroring how passwords and API credentials are never
  stored in a form usable straight out of the database. Logout sets `revokedAt` rather than
  deleting the row, so session history stays inspectable for security review — consistent
  with this project's soft-lifecycle default (D007), even though `Session` isn't a
  config entity, and there's no attribution reason to keep it forever, so a future
  scheduled cleanup of long-expired/revoked rows is reasonable and does not conflict with
  anything else in this document.

## D010 — Pinned Prisma/`@prisma/client` to 6.19.3, not the npm-`latest` 7.x
**Date:** 2026-08-25
`prisma@7.9.1` (npm `latest` at the time) hard-fails its own preinstall check on Node
v23.11.1 — the machine's installed runtime — because Prisma 7's supported engine ranges
(`^20.19 || ^22.12 || >=24.0`) exclude the entire v23 line. `prisma@6.19.3` only declares
`node >=18.18` with no upper-bound gate and installs cleanly. This is a pin to keep local
dev working, not an architectural preference for 6.x over 7.x — revisit once the local/CI
Node version moves to 22 LTS or 24, or once a Prisma 7.x patch relaxes the gate.
