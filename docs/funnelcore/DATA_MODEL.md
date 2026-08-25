# FunnelCore — Data Model

This is the authoritative description of the schema in [`prisma/schema.prisma`](../../prisma/schema.prisma).
If the two ever disagree, the Prisma schema is the source of truth for the database and this
file should be updated to match it.

## 1. Entity relationship overview

```
AdminUser ──< AuditLog
AdminUser ──< Session

Brand ──< SocialAccount >── Platform
Brand ──< Domain
Brand ──< Campaign
Brand ──< TelegramBot
Brand ──< ApiConnection
Brand ──< Experiment ──< ExperimentArm >── TrackingLinkVersion (optional)
Brand ──< TrackingLink >── Domain

TrackingLink ──< TrackingLinkVersion >── Campaign
                                     >── SocialAccount (optional)
                                     >── TelegramBot (optional, pathType = TELEGRAM)
                                     >── AdminUser (publishedBy)
TrackingLink 1───1 TrackingLinkVersion   (currentVersion pointer)

TrackingLinkVersion ──< Click >── Brand
                              >── Platform (optional)
                              >── SocialAccount (optional)
                              >── Campaign (optional)

Click ──< FunnelEvent
Click ──< Conversion (0 or 1 typical, modeled as one-to-many for safety)
Click ──< TelegramStartPayload >── TelegramBot

Campaign ──< Conversion
Brand ──< Conversion
```

## 2. Entities

### AdminUser
Backend administrators. No public self-signup.

| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | PK |
| email | String | unique |
| passwordHash | String | argon2/bcrypt hash, never plaintext |
| role | AdminRole | `ADMIN \| VIEWER` (see OPEN_QUESTIONS for full RBAC) |
| isActive | Boolean | disables login without deleting history |
| createdAt / updatedAt | DateTime | |

### Session
Server-side record backing an admin's HTTP-only session cookie. Not part of the original
core entity list, but a direct implementation requirement of "HTTP-only session" + "logout"
in the admin auth spec — see [DECISIONS.md](DECISIONS.md) D009.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| adminUserId | String | FK → AdminUser |
| tokenHash | String | unique, SHA-256 of the opaque cookie value — the raw token is never stored |
| createdAt | DateTime | |
| expiresAt | DateTime | fixed TTL from creation |
| revokedAt | DateTime? | set on logout; a revoked or expired session is treated as invalid |

### AuditLog
Immutable record of every admin mutation. Written by a shared mutation helper, not ad hoc
per Server Action, so it can't be skipped.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| actorId | String? | FK → AdminUser, nullable for system-originated changes |
| action | String | `CREATE \| UPDATE \| ARCHIVE \| PUBLISH` |
| entityType | String | e.g. `"TrackingLink"` |
| entityId | String | id of the affected row |
| beforeJson / afterJson | Json? | snapshot diff |
| createdAt | DateTime | |

### Brand
The top-level configurable tenant concept. Never hardcoded.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| name | String | |
| slug | String | unique |
| status | Status | `ACTIVE \| ARCHIVED` |
| createdAt / updatedAt | DateTime | |

### Platform
A traffic source type (e.g. Instagram, TikTok, Telegram Ads). A table, not an enum, so new
platforms never require a code change.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| name | String | |
| slug | String | unique |
| status | Status | |
| createdAt / updatedAt | DateTime | |

### SocialAccount
A specific handle/account on a Platform, owned by a Brand.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| brandId | String | FK → Brand |
| platformId | String | FK → Platform |
| handle | String | |
| displayName | String? | |
| status | Status | |
| createdAt / updatedAt | DateTime | |

Unique on `(brandId, platformId, handle)`.

### Domain
A hostname the public route layer can serve tracking links from.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| hostname | String | unique |
| brandId | String? | null = shared/multi-brand domain |
| isActive | Boolean | |
| createdAt / updatedAt | DateTime | |

### Campaign
Represents **Paybig lane attribution** — the link between our tracking config and a specific
paid-acquisition lane in Paybig.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| brandId | String | FK → Brand |
| platformId | String | FK → Platform |
| name | String | internal label |
| slug | String | unique per brand |
| paybigUrl | String | the Paybig destination URL for this lane |
| isDefault | Boolean | fallback campaign for this brand+platform — see below |
| status | Status | |
| createdAt / updatedAt | DateTime | |

Unique on `(brandId, slug)`. At most one `ACTIVE` campaign per `(brandId, platformId)` may have
`isDefault = true` — enforced at the application layer (setting a new default demotes any
existing one in the same transaction; archiving a default campaign clears its flag), not as a
DB constraint. See DECISIONS.md D011.

### TelegramBot
Telegram credentials are secrets and are encrypted at rest (see ARCHITECTURE.md §6).

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| brandId | String | FK → Brand |
| name | String | internal label |
| botUsername | String? | not secret; null until the real Telegram integration derives it via `getMe` |
| botTokenCiphertext | String | AES-256-GCM ciphertext; decrypted only server-side at point of use |
| welcomeMessage | String? | shown by the bot after `/start` (Phase 4) |
| ctaLabel | String? | button label used by the bot (Phase 4) |
| status | Status | |
| createdAt / updatedAt | DateTime | |

Bot tokens are validated for *format* only at admin-entry time (see DECISIONS.md D012) — no
live call to Telegram's API is made in this milestone.

### ApiConnection
Generic external API credential holder (Paybig today, others later) without hardcoding a
provider enum — `provider` is a free-form string precisely so new integrations are config,
not code.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| brandId | String? | null = account-wide connection |
| name | String | internal label |
| provider | String | e.g. `"paybig"` |
| baseUrl | String | base URL for the external API |
| authType | ApiConnectionAuthType | `NONE \| API_KEY_HEADER \| API_KEY_QUERY \| BEARER_TOKEN \| BASIC_AUTH` — a fixed enum, unlike `provider`, because the (not-yet-built) integration layer branches on it structurally |
| credentialsCiphertext | String | AES-256-GCM ciphertext of a JSON credential blob |
| status | Status | |
| createdAt / updatedAt | DateTime | |

### Experiment
Placeholder entity for A/B-style experimentation across tracking link versions. Intentionally
minimal in V1 — see OPEN_QUESTIONS.md. Per-variant detail lives in `ExperimentArm`;
`variantConfig` here is free-form experiment-level metadata only (e.g. hypothesis notes).

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| brandId | String | FK → Brand |
| trackingLinkId | String? | FK → TrackingLink, optional |
| name | String | |
| variantConfig | Json? | experiment-level metadata, shape TBD |
| status | Status | |
| startedAt / endedAt | DateTime? | |
| createdAt / updatedAt | DateTime | |

### ExperimentArm
A single variant within an Experiment. A real table (not JSON) because arms are queried/
joined directly once traffic-split execution is built.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| experimentId | String | FK → Experiment |
| name | String | e.g. `"control"`, `"variant-b"` |
| trackingLinkVersionId | String? | FK → TrackingLinkVersion — which version this arm serves |
| weight | Int | relative traffic allocation |
| status | Status | |
| createdAt / updatedAt | DateTime | |

Unique on `(experimentId, name)`.

### TrackingLink
**The executable public route object.** Public traffic to `/l/{token}` resolves exactly one
of these rows. The link itself is a stable pointer; behavior lives in its versions.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| label | String | human-readable name; not used in routing |
| token | String | routing key **within its domain**, immutable after creation (see DECISIONS.md D013, D015) |
| brandId | String | FK → Brand, immutable after creation |
| domainId | String | FK → Domain |
| currentVersionId | String? | FK → TrackingLinkVersion, null until first publish |
| status | LinkStatus | `ACTIVE \| PAUSED \| ARCHIVED` |
| createdAt / updatedAt | DateTime | |

Unique on `(domainId, token)` — not a global unique on `token` alone. See D015.

### TrackingLinkVersion
**Immutable published snapshot.** Created on every publish; never updated after creation.
Historical `Click` rows reference the exact version that was live when the click happened, so
editing a link later cannot change past attribution. Publishing is gated by validation — see
[ARCHITECTURE.md §5a](ARCHITECTURE.md) and `src/lib/tracking-link-publishing.ts`.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| trackingLinkId | String | FK → TrackingLink |
| versionNumber | Int | monotonically increasing per link |
| pathType | PathType | `DIRECT \| AGGREGATOR \| TELEGRAM` |
| campaignId | String | FK → Campaign (Paybig lane attribution) — structural FK for reporting joins |
| socialAccountId | String? | FK → SocialAccount — structural FK for reporting joins |
| telegramBotId | String? | FK → TelegramBot, set only when `pathType = TELEGRAM` |
| ageGateEnabled | Boolean | |
| pathConfig | Json | path-type-specific fields (destination URL for `direct`/`aggregator`; start-param template for `telegram`) |
| snapshot | Json | **frozen execution snapshot** — domain, token, brand, platform, campaign (incl. Paybig destination), social account, path type/config, age gate, experiment/arm context, all copied at publish time. Contains no secrets. See D016. |
| publishedAt | DateTime | |
| publishedById | String | FK → AdminUser |

Unique on `(trackingLinkId, versionNumber)`.

The `campaignId`/`socialAccountId`/`telegramBotId` FK columns and the `snapshot` JSON serve
different purposes and are both kept: the FKs exist for reporting joins (Phase 6) against
live rows; `snapshot` exists so routing execution never needs to join a mutable row at all,
which is what makes the "editing a campaign later can't change history" guarantee hold.

> **Note:** Prisma/Postgres do not enforce "`telegramBotId` is set if and only if
> `pathType = TELEGRAM`" as a DB constraint in V1 — this is validated at the application layer
> when a version is published. See OPEN_QUESTIONS.md.

### Click
**Authoritative record of a click**, with attribution context copied (not joined) from the
resolved version at click time.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| trackingLinkId | String | FK → TrackingLink |
| trackingLinkVersionId | String | FK → TrackingLinkVersion |
| brandId | String | snapshot copy |
| platformId | String? | snapshot copy |
| socialAccountId | String? | snapshot copy |
| campaignId | String? | snapshot copy |
| ipHash | String? | hashed, not raw IP |
| userAgent | String? | |
| referrer | String? | |
| utmParams | Json? | |
| countryCode | String? | |
| deviceType | String? | |
| clickedAt | DateTime | |

### FunnelEvent
Step-by-step record of a click's progression through the funnel. Written by
`src/lib/public-routing.ts` — see ARCHITECTURE.md §4 for exactly where each step fires.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| clickId | String | FK → Click |
| stepType | FunnelStepType | `ROUTE_RESOLVED \| AGE_GATE_SHOWN \| AGE_GATE_ACCEPTED \| AGE_GATE_DECLINED \| AGGREGATOR_VIEWED \| AGGREGATOR_CONTINUE_CLICKED \| OUTBOUND_PAYBIG_REDIRECTED \| ROUTE_FAILED` |
| metadata | Json? | e.g. `{pathType}` on `ROUTE_RESOLVED`, `{destinationUrl}` on `OUTBOUND_PAYBIG_REDIRECTED`, `{reason, pathType?}` on `ROUTE_FAILED` |
| occurredAt | DateTime | |

`OUTBOUND_PAYBIG_REDIRECTED` is written at most once per click — `executeOutbound` checks for
an existing one first and replays its `destinationUrl` rather than duplicating (a redirect to
an external host is a GET that a client/browser can legitimately retry). `AGE_GATE_ACCEPTED`
and `AGE_GATE_DECLINED` have the same guard. `ROUTE_RESOLVED`, `AGE_GATE_SHOWN`, and
`AGGREGATOR_VIEWED` are not deduplicated — repeat views are legitimate signal.

### TelegramStartPayload
An opaque token embedded in a `t.me/<bot>?start=<token>` deep link so a Telegram bot start
event can eventually be traced back to the `Click` that produced it. Written when the
telegram path executor runs (Phase 4) — schema only for now, nothing writes to this table yet.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| clickId | String | FK → Click |
| telegramBotId | String | FK → TelegramBot |
| payloadToken | String | unique, the opaque value placed in the deep link |
| createdAt | DateTime | |
| consumedAt | DateTime? | set once the bot's `/start` handler processes it |

### Conversion
**Paybig conversion data.** Paybig is authoritative for whether/when a signup happened;
FunnelCore's job is correct attribution, not correcting Paybig's numbers.

| Field | Type | Notes |
|---|---|---|
| id | String | PK |
| paybigConversionId | String | unique, dedup key from Paybig |
| clickId | String? | FK → Click, null if unattributed |
| campaignId | String? | FK → Campaign |
| brandId | String? | FK → Brand |
| amount | Decimal? | |
| currency | String? | |
| status | ConversionStatus | `PENDING \| CONFIRMED \| REVERSED` |
| occurredAt | DateTime | Paybig's event time |
| receivedAt | DateTime | when FunnelCore ingested it |
| rawPayload | Json | full original payload, for replay/debugging |

## 3. Enums

- `Status`: `ACTIVE`, `ARCHIVED` — generic lifecycle for config entities.
- `LinkStatus`: `ACTIVE`, `PAUSED`, `ARCHIVED` — TrackingLink-specific (needs a pausable
  state distinct from archived).
- `PathType`: `DIRECT`, `AGGREGATOR`, `TELEGRAM` — the fixed V1 path type set. Adding a new
  value is a developer/architecture change, not an admin action.
- `FunnelStepType`: see Click/FunnelEvent above.
- `ConversionStatus`: `PENDING`, `CONFIRMED`, `REVERSED`.
- `AdminRole`: `ADMIN`, `VIEWER`.

## 4. Design rules this schema follows

1. Nothing that should be admin-configurable is an enum (`Brand`, `Platform`, provider
   names). Only the fixed, small, developer-owned concept set is an enum (`PathType`,
   step/status enums).
2. Attribution-relevant data is **copied at write time** (`Click` snapshot fields,
   `TrackingLinkVersion` immutability) rather than resolved via live joins to mutable rows,
   so historical reporting is stable under future edits.
3. Secrets (`TelegramBot.botTokenCiphertext`, `ApiConnection.credentialsCiphertext`) are
   stored only as ciphertext columns; there is no plaintext secret column anywhere in the
   schema.
4. Every admin-facing entity carries `createdAt`/`updatedAt`, and mutations to them are
   expected to produce an `AuditLog` row (enforced in application code, not the DB).
