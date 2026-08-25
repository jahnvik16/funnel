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

## D011 — Campaign default/fallback flag enforced at the application layer
**Date:** 2026-08-25
`Campaign.isDefault` should hold for at most one `ACTIVE` campaign per `(brandId, platformId)`.
Postgres has no native "unique where condition" support through Prisma's schema DSL (it would
need a raw-SQL partial unique index), so this is enforced in `tracking-links/../campaigns/
actions.ts`: setting a campaign's `isDefault` to true demotes any other campaign in the same
brand+platform inside the same transaction (with its own audit log entry), and archiving a
default campaign clears its flag. Same tradeoff class as D005's pathConfig/telegramBotId
consistency note — see OPEN_QUESTIONS.md.

## D012 — Telegram bot token validated for format only, not via a live Telegram API call
**Date:** 2026-08-25
The admin config milestone requires the backend to "validate the token." A live call to
Telegram's `getMe` endpoint is integration work, explicitly out of scope ("Do not implement
the actual external API integrations yet"). `lib/telegram.ts` checks the token against
Telegram's known format (`<digits>:<35-char secret>`) instead. `TelegramBot.botUsername` is
therefore nullable — it stays unset until a real integration derives it from the API. Revisit
when Phase 4 (public route / telegram path execution) is built.

## D013 — TrackingLink `token` and `brandId` are immutable after creation
**Date:** 2026-08-25
`token` is the public URL key — changing it after a link has been shared would break every
already-distributed link. `brandId` scopes which campaigns/social accounts/domains are valid
selections for the link; changing it after creation would silently invalidate previously
published versions' campaign/social-account references. Both are set once at creation and
shown read-only thereafter; `label`, `domainId`, and `status` remain editable.

## D014 — Prisma Server Action files can only export async functions; safe `select` shapes moved out
**Date:** 2026-08-25
Next.js rejects a `"use server"` file that exports anything other than an async function (a
build-time check). The `TELEGRAM_BOT_SAFE_SELECT` / `API_CONNECTION_SAFE_SELECT` constants
(the Prisma `select` shapes that guarantee `botTokenCiphertext`/`credentialsCiphertext` are
never fetched for any page/component — see ARCHITECTURE.md `lib/auth` row and CLAUDE.md rule
11) were moved into sibling `selects.ts` files rather than living alongside the actions that
use them. Purely a module-boundary consequence of the framework constraint, not a design
change to what the constants do.

## D015 — `TrackingLink.token` is unique per domain, not globally
**Date:** 2026-08-25
The validation milestone's explicit rule is "token is unique for that domain," not globally.
Changed `TrackingLink.token`'s constraint from a bare `@unique` to `@@unique([domainId,
token])`. This is a deliberate loosening: the same short token can now be reused across two
different domains (e.g. two white-labeled domains both serving a `"spring2026"` link),
matching how the public route's real routing key is the `(domain, token)` pair, not the token
alone. `validateTrackingLinkConfig` also checks this explicitly rather than only relying on
the DB constraint, so publishing gives a friendly error instead of a raw unique-violation.

## D016 — `TrackingLinkVersion.snapshot`: a frozen, denormalized copy for routing; FKs kept for reporting
**Date:** 2026-08-25
The milestone's core invariant ("editing a campaign's Paybig URL tomorrow must not change an
already-published version") cannot hold if the eventual public route resolves a version by
joining live Campaign/SocialAccount/TelegramBot rows — those rows are mutable by design.
`TrackingLinkVersion.snapshot` (JSON) copies everything routing needs — domain, token, brand,
platform, campaign incl. Paybig URL, social account, path type/config, age gate, experiment/
arm — by value at publish time. The existing `campaignId`/`socialAccountId`/`telegramBotId`
foreign keys are kept alongside it, not replaced: they exist for reporting joins against
current rows (Phase 6), a different job than freezing historical execution data. The snapshot
never includes ciphertext or raw secrets (CLAUDE.md rule 11/12) — only non-secret identifying
fields (e.g. `telegramBot: {id, name}`, never a token).

Because this is a genuinely new required column and the project has no production data yet
(only local dev/test fixtures), the migration adds `snapshot` as `NOT NULL` directly rather
than adding it nullable and backfilling via a data migration — the one pre-existing local test
row was deleted before migrating rather than backfilled. Revisit this simplification if a
migration is ever needed against a database that holds real `TrackingLinkVersion` rows.

## D017 — Validate and Publish share one form via a submitter-driven client handler, not `useActionState`
**Date:** 2026-08-25
The publish form needed two distinct behaviors (dry-run validate vs. write-and-redirect
publish) over the *same* field values, plus a list of validation issues rather than one error
string. `useActionState` binds a form to exactly one Server Action, and per-button
`formAction` overrides don't compose cleanly with it. Instead, `PublishVersionForm` uses a
plain `onSubmit` handler that reads `event.nativeEvent.submitter` to pick which of the two
imported Server Actions to call directly (both are plain async functions from the client's
perspective), wrapped in `useTransition` for pending state. Both actions return the same
`PublishFormState` shape (`{ error?, issues?, validated? }`) so one render path displays
either outcome.
