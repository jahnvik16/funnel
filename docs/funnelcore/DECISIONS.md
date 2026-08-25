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
- `TelegramStartPayload` models the deep-link token that lets a Telegram bot start event be
  traced back to a `Click`. Schema-only as of this entry — it became load-bearing once the
  Telegram funnel path was actually built; see D023.
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

## D018 — Public route split into four segments (`/l`, `/gate`, `/path`, `/out`), not one handler
**Date:** 2026-08-25
The milestone's brief specified this shape directly, and it maps cleanly onto the funnel's
actual state machine: `/l/{token}` only ever runs once per click (resolve + create Click);
`/gate/{clickId}` is skippable (only visited when the version requires it); `/path/{clickId}`
is where path-type branching lives and is the only place that renders the owned aggregator
page; `/out/{clickId}` is the single place external egress happens, regardless of which path
type got you there. Splitting them means each route file stays small and each step's
`FunnelEvent` is written at the one place that step actually happens, rather than threaded
through a single handler's branches. `src/lib/public-routing.ts` holds the actual logic
(resolution, Click/event writing, the path/outbound decisions) so the four route files are
thin — the same "framework-independent core, thin route wrapper" split as
`lib/tracking-link-publishing.ts`.

## D019 — The public route redirects to `pathConfig.destinationUrl`, not `campaign.paybigUrl`
**Date:** 2026-08-25
Both fields exist on the resolved snapshot. `pathConfig.destinationUrl` is the field the
`direct`/`aggregator` publish form actually collects and validates as the link's destination
(carried over from Phase 0's original design); `campaign.paybigUrl` was added later
specifically to represent "the Paybig destination for this lane" as attribution metadata,
not necessarily as a literal redirect target admins configure per link. Given the milestone's
explicit instruction not to invent new admin-facing fields, `pathConfig.destinationUrl` is
used as the actual `/out` redirect target for both path types, and `OUTBOUND_PAYBIG_REDIRECTED`
fires regardless (the event name reflects "this is the funnel's terminal handoff step," not a
literal claim about which URL field was used). This is a judgment call, not a settled
requirement — flagged in OPEN_QUESTIONS.md for reconciliation once the real Paybig contract
is known.

## D020 — `/out` and the age-gate "accept"/"decline" actions are idempotent
**Date:** 2026-08-25
Manual browser testing surfaced this directly: accepting the age gate (a Server Action
redirecting to `/path`, which redirects to `/out`, which redirects externally) produced three
`OUTBOUND_PAYBIG_REDIRECTED` events for one click — the client re-issued the `/out` GET
multiple times (observed after the external redirect target failed to resolve; likely
browser/runtime retry behavior around a cross-origin redirect, not application code).
`executeOutbound` now checks for an existing `OUTBOUND_PAYBIG_REDIRECTED` event first and, if
found, replays its recorded `destinationUrl` without writing a new event or re-running the
`AGGREGATOR_CONTINUE_CLICKED` write. `acceptAgeGate`/`declineAgeGate` got the same guard via
the new `hasFunnelEvent` helper. `ROUTE_RESOLVED`, `AGE_GATE_SHOWN`, and `AGGREGATOR_VIEWED`
are deliberately *not* deduplicated — those represent genuine repeat views, not a completed
state transition. See `src/lib/public-routing.test.ts`'s idempotency test.

## D021 — `FunnelStepType` fully replaced, not extended
**Date:** 2026-08-25
The enum from Phase 0 (`GATE_SHOWN`, `REDIRECT_DIRECT`, `PAYBIG_REDIRECT`, `TELEGRAM_START`,
etc.) predated this milestone's exact event vocabulary and had zero rows written against it
(nothing had implemented the public route yet). Replaced outright with the milestone's named
events (`ROUTE_RESOLVED`, `AGE_GATE_SHOWN/ACCEPTED/DECLINED`, `AGGREGATOR_VIEWED`,
`AGGREGATOR_CONTINUE_CLICKED`, `OUTBOUND_PAYBIG_REDIRECTED`, `ROUTE_FAILED`) rather than kept
alongside them — safe only because the table was empty; would need a real data migration if
this ever needs to change again after real events exist. `TELEGRAM_START` was dropped rather
than kept unused — it can be reintroduced accurately once the Telegram path is actually
implemented (see CLAUDE.md "do not add a 4th path type" reasoning, applied here to unused
enum values as much as path types). *(It has since been reintroduced as `TELEGRAM_STARTED`,
alongside `TELEGRAM_REDIRECTED` — see D022 onward. The prediction above held: it came back
once the Telegram path was actually built, with real semantics rather than a placeholder.)*

## D022 — Telegram bot validation upgraded from format-only to a live `getMe` call
**Date:** 2026-08-25
D012 deliberately deferred live Telegram API validation as integration work out of scope for
the admin-config milestone. This milestone *is* that integration work: the admin's
**Validate** action now calls Telegram's `getMe` through `lib/telegram.ts`, and only a
successful call sets `TelegramBot.botUsername`. Publishing a `TELEGRAM`-path
`TrackingLinkVersion` is rejected unless the chosen bot has a non-null `botUsername` — so a
bot that has never been (or is no longer, post token-rotation) successfully validated can
never end up live in a published version. `lib/telegram.ts`'s API functions accept an
injectable `fetch` implementation specifically so `lib/telegram.test.ts` can exercise
success/failure/network-error paths against a mock instead of real Telegram credentials.

## D023 — Telegram start payloads are opaque, unguessable, and carry no encoded data
**Date:** 2026-08-25
The milestone's payload spec is explicit: "do not put sensitive information into the
Telegram payload" and "use a short opaque payload token that maps to server-side state."
`TelegramStartPayload.payloadToken` is 16 random bytes (base64url), with no click/campaign/
link id encoded into it anywhere — `resolveTelegramStartPayload` recovers `click_id`,
`trackingLinkId`, `trackingLinkVersionId`, `campaignId`, and `experimentArmId` entirely by
joining through the already-created `Click` row (and a reverse lookup on
`ExperimentArm.trackingLinkVersionId` for the arm). A leaked payload token therefore reveals
nothing on its own, and grants nothing once expired. Payloads expire 15 minutes after
creation (`PAYLOAD_TTL_MS` in `lib/telegram-payload.ts`) — long enough to open Telegram and
tap "Start", short enough that a stale/abandoned link can't be replayed indefinitely.
Resolution is idempotent (a second resolution of an already-consumed-but-unexpired payload
still succeeds, reporting `alreadyConsumed: true`) because Telegram may retry webhook
delivery.

## D024 — Webhook secret verification is "as far as practical", not an absolute requirement
**Date:** 2026-08-25
The brief says to verify webhook authenticity "as far as practical" rather than mandating a
specific mechanism. `TelegramBot.webhookSecretCiphertext` is populated only when the admin's
Validate action successfully calls `setWebhook` — which requires `APP_BASE_URL` to be a real,
public HTTPS URL Telegram can reach, something no local/dev environment has. Rather than
block all webhook processing until a secret exists (which would make the Telegram path
untestable locally), `verifyWebhookSecret` is permissive when no secret is on file yet and
strict once one is: real deployments get real verification the moment `setWebhook` succeeds;
local development can still exercise the full flow via a direct POST to the webhook route
(see `lib/telegram-webhook.test.ts` and the manual verification in this milestone's session).

## D025 — TELEGRAM's `/out` destination is `campaign.paybigUrl`, extending D019's open question
**Date:** 2026-08-25
D019 flagged that `pathConfig.destinationUrl` (used by `direct`/`aggregator`) vs.
`campaign.paybigUrl` as the real Paybig redirect target was an open call, to be reconciled
once Paybig's contract is known. `TELEGRAM`'s `pathConfig` has no `destinationUrl` field at
all (it only ever holds an optional `startParamTemplate`), so there was no ambiguity to
preserve: `executeOutbound` uses `snapshot.campaign.paybigUrl` for `TELEGRAM` specifically.
This doesn't resolve D019's open question for `direct`/`aggregator` — that ambiguity still
stands — but it does mean two of the three path types (`aggregator`, and now the `telegram`
precedent) lean toward `campaign.paybigUrl` as the more likely eventual answer.

## D026 — The webhook handler doesn't hold a DB transaction open across the call to Telegram
**Date:** 2026-08-25
`handleTelegramWebhook` accepts a `Prisma.TransactionClient`-shaped `db` (so it composes with
the rest of the codebase's transaction-friendly typing) but is deliberately *not* wrapped in
an explicit `prisma.$transaction(...)` by its caller. Resolving the payload and writing
`TELEGRAM_STARTED` happen as ordinary statements, then the reply is sent via a real network
call to Telegram's `sendMessage` API. Holding a Postgres transaction open for the duration of
that network round-trip (with no upper bound if Telegram is slow) is worse than the small,
idempotency-guarded risk of a duplicate `TELEGRAM_STARTED` write under concurrent webhook
retries. A failed `sendMessage` is treated as best-effort and does not fail the webhook —
the attribution event is already durable by that point regardless.

## D027 — Paybig conversions arrive as an admin-uploaded CSV; dedup prefers `conversion_id`, falls back to a documented composite key
**Date:** 2026-08-25
The milestone's V1 input is explicitly "Paybig CSV," not a live webhook or polling
integration — `lib/paybig-import.ts` implements a hand-rolled RFC4180-ish parser (quoted
fields, embedded commas/newlines, `""` escaping) rather than adding a dependency, since the
shape is small and fully test-covered. No new schema was needed: `Conversion.paybigConversionId`
was already `@unique` and `clickId`/`campaignId`/`brandId` were already nullable, from Phase 0.

Deduplication prefers the row's real `conversion_id` as the storage key, matching that unique
constraint directly. When a row has no `conversion_id`, `computeStorageKey` falls back to
`composite:{campaign_slug}|{conversion_time}|{amount}|{currency}`. **Documented limitation**:
two genuinely distinct conversions that share all four of those values are indistinguishable
under the fallback and collide — the second is dropped as a duplicate rather than
double-counted. This is a deliberate bias (never inflate signups on a repeated import) at the
cost of occasionally under-counting an edge case that real `conversion_id`s avoid entirely; see
OPEN_QUESTIONS.md. The import itself is admin-triggered (upload → parse → summary), not an
inbound endpoint, so the "authentication for the inbound conversion endpoint" open question
does not apply to this milestone — it already goes through `requireAdmin()` like every other
admin action.

## D028 — An unmatched or ambiguous `campaign_slug` still creates a Conversion row; FunnelCore never guesses the campaign
**Date:** 2026-08-25
`Campaign.slug` is unique per brand (`@@unique([brandId, slug])`), not globally, so a bare
`campaign_slug` from a CSV row can legitimately match campaigns in more than one brand.
`importPaybigCsv` treats that ambiguous case the same as "not found" — it never guesses which
brand's campaign was meant. Per CLAUDE.md rule 8 ("Paybig is authoritative for signups"),
neither case drops the row: a Conversion is still created with `campaignId`/`brandId` left
null and the full raw row preserved in `rawPayload`, so a real reported signup is never lost
just because our internal attribution couldn't resolve it — it shows up in the "unmatched
conversions" report metric instead, with the reason (`not_found` vs `ambiguous`) visible in the
import summary for diagnosis.

## D029 — The attribution dashboard computes funnel metrics at full filter granularity, signup metrics only at the campaign-level ceiling
**Date:** 2026-08-25
This directly implements the milestone's "do not claim precision the underlying data does not
support" rule. `Click`/`FunnelEvent` carry real click-level attribution (brand, platform,
social account, campaign, path type, experiment arm — all copied from the resolved
`TrackingLinkVersion` snapshot), so clicks/age-gate-accepts/aggregator-views/telegram-starts/
outbound-redirects in `lib/attribution-report.ts` are precise at whatever combination of
filters is selected. `Conversion` rows from a Paybig CSV only ever carry `campaignId`/`brandId`
— no path, social account, or experiment information exists to filter by.

`isSignupAttributionCompatible` is false whenever a path, social-account, experiment, or
experiment-arm filter is active. When false, the dashboard still shows a real signups count
(computed against the campaign-level-compatible filters only: date/brand/platform/campaign,
ignoring the incompatible ones) but forces `signupRatePerClick` and
`signupRatePerOutboundRedirect` to `null` — computing those rates against a filtered click
count from a different attribution granularity than the signup numerator would produce an
actively wrong number, not merely an imprecise one, so they're suppressed rather than shown
with a caveat. The admin UI renders a visible warning banner in this state rather than a silent
`N/A`, so the distinction is obvious at a glance, not just present in a tooltip. "Signups" is
also deliberately defined as *attributed* signups (`campaignId IS NOT NULL`) so it never
double-counts a row already reported under the separate "unmatched conversions" metric — an
inconsistency the manual browser verification for this milestone caught before the fix landed
(the two counts summed to more than the true total).
