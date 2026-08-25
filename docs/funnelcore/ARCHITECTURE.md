# FunnelCore — Architecture

## 1. Guiding principle

**The backend executes published configuration. It does not encode business logic that
belongs in configuration.**

Concretely: "which brands exist", "which platforms exist", "what does tracking link X do",
"which Telegram bot does brand Y use" are all data, stored in Postgres, edited through the
admin, and versioned. Application code implements the *mechanics* of executing that data
(resolve a token → load a version → run one of three path-type handlers), never the
*specifics* of any single brand/campaign/link.

This is not a generic workflow engine. The set of path types is fixed and small
(`direct | aggregator | telegram`) and lives in code. What varies per tracking link is the
*configuration* passed to whichever path type it uses, not the set of available behaviors.

## 2. System overview

```
                         ┌────────────────────────┐
                         │       Admin UI          │
                         │  (Next.js App Router,   │
                         │  authenticated)         │
                         └───────────┬─────────────┘
                                     │ Server Actions / API routes
                                     ▼
                         ┌────────────────────────┐
                         │   Application layer      │
                         │  - config CRUD           │
                         │  - publish/versioning    │
                         │  - audit logging         │
                         │  - credential encryption │
                         └───────────┬─────────────┘
                                     │ Prisma
                                     ▼
                         ┌────────────────────────┐
                         │      PostgreSQL          │
                         └───────────┬─────────────┘
                                     ▲
                                     │ Prisma (read path)
                         ┌───────────┴─────────────┐
                         │   Public route layer     │
                         │  GET /l/{tracking_token}  │
                         │  - resolve link+version   │
                         │  - write Click            │
                         │  - run gate (optional)    │
                         │  - execute path type      │
                         │  - write FunnelEvent(s)   │
                         └───────────┬─────────────┘
                                     │ redirect
                                     ▼
                     direct / aggregator / Telegram deep link
                                     │
                                     ▼
                                  Paybig
                                     │  webhook / API pull (TBD)
                                     ▼
                         ┌────────────────────────┐
                         │  Conversion ingestion    │
                         │  - verify payload        │
                         │  - attribute to Click/   │
                         │    Campaign               │
                         └────────────────────────┘
```

## 3. Module boundaries

| Module | Responsibility | Must never |
|---|---|---|
| `app/(admin)` | Admin UI + Server Actions for CRUD, publish, audit view, reports | Contain per-brand/campaign conditional logic |
| `app/l/[token]`, `app/gate/[clickId]`, `app/path/[clickId]`, `app/out/[clickId]` | The public funnel — resolve, gate, execute path, egress (see §4) | Contain any hardcoded brand/campaign/link behavior; join a live mutable row when the frozen `snapshot` already has the answer |
| `app/api/telegram/webhook/[botId]` | Inbound Telegram webhook — `/start` handling (see §4a) | Require admin session auth (it's authenticated via the per-bot secret token instead); trust the payload without resolving it through `resolveTelegramStartPayload` |
| `app/api/conversions` | Inbound Paybig conversion ingestion (not built yet — Phase 5) | Trust unverified payloads; must attribute via Campaign/Click, never guess |
| `lib/public-routing` | Resolving `(domain, token)` → version, writing `Click`/`FunnelEvent`, the path/outbound decision logic | Depend on `next/headers` or any Next.js request/response type (must stay callable from tests without a request context, same reasoning as `lib/tracking-link-publishing`); re-query a live Campaign/SocialAccount/TelegramBot row when the snapshot already has what's needed |
| `lib/telegram` | Thin Telegram Bot API client (`getMe`, `setWebhook`, `sendMessage`) plus token format checking | Log a bot token or the request URL that embeds one; throw on a failed API call (returns a typed result instead) |
| `lib/telegram-payload` | Minting and resolving short-lived Telegram start payloads | Encode click/campaign/link ids into the payload token itself; skip the expiry check |
| `lib/telegram-webhook` | Webhook orchestration: verify secret, parse `/start`, resolve payload, log, reply | Hold a DB transaction open across the network call to Telegram's `sendMessage`; fail the whole webhook because the reply send failed |
| `lib/crypto` | Field-level encryption/decryption for secrets (Telegram tokens, webhook secrets, API credentials) | Ever return decrypted secrets to a client component or API response |
| `lib/audit` | Recording before/after diffs for admin mutations | Be optional / skippable by any mutation path |
| `lib/auth` | Password hashing/verification, session issuance/validation/revocation | Store a plaintext password or a raw (unhashed) session token; trust a cookie value without checking it against `Session` |
| `lib/tracking-link-publishing` | Validating a proposed TrackingLink configuration and, if valid, publishing an immutable `TrackingLinkVersion` with a frozen snapshot | Write anything when validation fails; depend on `next/headers`/`requireAdmin` (must stay callable from tests without a request context) |
| `prisma/` | Schema, migrations | Contain seed data that hardcodes real brands/campaigns |

## 4. Request flow: public click

Implemented as four route segments, each doing the minimum needed for its step
(`src/lib/public-routing.ts` holds the shared, framework-independent logic; every route file
is a thin wrapper):

1. **`GET /l/{token}`** (`app/l/[token]/route.ts`) — resolves the request's `Host` header to a
   `Domain`, then the `(domainId, token)` pair to a `TrackingLink` (see DECISIONS.md D015).
   Only an `ACTIVE` link with a published `currentVersion` resolves; anything else (unknown
   domain, unknown token, `PAUSED`/`ARCHIVED` link, no published version) returns the same
   generic "not available" response with **no `Click` created** — there's no version to
   attribute one to, so there's nothing to log. In one transaction: a `Click` row is created
   (attribution copied from the resolved version's frozen `snapshot` — brand, platform,
   social account, campaign ids — never re-derived from live config), then `ROUTE_RESOLVED`
   is written. The response redirects to `/gate/{clickId}` if the snapshot requires an age
   gate, otherwise straight to `/path/{clickId}`.
2. **`GET /gate/{clickId}`** (`app/gate/[clickId]/page.tsx`) — loads the `Click` + its frozen
   snapshot by id (the id itself is the only state carried forward; no cookie/session). Writes
   `AGE_GATE_SHOWN` and renders a neutral, non-explicit age-verification prompt. "Yes" (a
   Server Action) writes `AGE_GATE_ACCEPTED` — idempotently, see below — and redirects to
   `/path/{clickId}`. "No" writes `AGE_GATE_DECLINED` and redirects back to the same page with
   a decline message; no external navigation.
3. **`GET /path/{clickId}`** (`app/path/[clickId]/page.tsx`) — reads the snapshot's `pathType`:
   `DIRECT` redirects straight to `/out/{clickId}` (no interim page, no event of its own —
   the outbound event is logged at `/out`); `AGGREGATOR` writes `AGGREGATOR_VIEWED` and
   renders an owned, neutral page (brand/campaign name, a "Continue" link to
   `/out/{clickId}`); `TELEGRAM` mints a start payload and redirects into the bot (see §4a);
   anything else (defensive-only — the schema has no other real value) writes `ROUTE_FAILED`
   and renders a safe, generic unavailable message.
4. **`GET /out/{clickId}`** (`app/out/[clickId]/route.ts`) — the single canonical egress
   point for `DIRECT`, `AGGREGATOR`, and `TELEGRAM` alike. For `AGGREGATOR` it first writes
   `AGGREGATOR_CONTINUE_CLICKED`. It then resolves the destination URL — from the snapshot's
   `pathConfig` for `DIRECT`/`AGGREGATOR`, or from `snapshot.campaign.paybigUrl` for
   `TELEGRAM` (which has no `pathConfig.destinationUrl` field — see DECISIONS.md D019/D025) —
   and writes `OUTBOUND_PAYBIG_REDIRECTED` before redirecting externally. **This step is
   idempotent**: if a `OUTBOUND_PAYBIG_REDIRECTED` event already exists for the click (e.g. a
   client-side redirect retry — observed in manual testing), it replays the same destination
   from that event's metadata instead of writing a duplicate.

Downstream, the visitor may reach Paybig. Paybig eventually reports a conversion. Conversion
ingestion (not built yet — Phase 5) attributes it to a `Click` using whatever join key Paybig
provides; see OPEN_QUESTIONS.md.

## 4a. The Telegram funnel path

```
/l/{token} → Click created (pathType TELEGRAM)
           → /path/{clickId}: TelegramStartPayload minted, TELEGRAM_REDIRECTED written
           → redirect to t.me/{botUsername}?start={payloadToken}
           → visitor opens the bot in Telegram, which sends "/start {payloadToken}"
           → POST /api/telegram/webhook/{botId}  (Telegram calling us)
                → verify X-Telegram-Bot-Api-Secret-Token (if one is on file)
                → resolveTelegramStartPayload(payloadToken)
                → TELEGRAM_STARTED written (idempotent)
                → sendMessage(welcomeMessage, CTA button → {APP_BASE_URL}/out/{clickId})
           → visitor taps the CTA button inside Telegram
           → GET /out/{clickId}  (same egress point as direct/aggregator)
                → OUTBOUND_PAYBIG_REDIRECTED written
                → redirect to snapshot.campaign.paybigUrl
```

**The payload is opaque and carries nothing itself.** `TelegramStartPayload.payloadToken` is
a random string with no encoded meaning — resolving it (`lib/telegram-payload.ts`) is what
recovers `click_id`, `trackingLinkId`, `trackingLinkVersionId`, `campaignId`, and (via a
reverse lookup on `ExperimentArm.trackingLinkVersionId`) `experimentArmId`, all by joining
through the already-resolved `Click` → `TrackingLinkVersion`. This is deliberate: even if a
payload token leaked, it grants no information and (once expired or consumed past its TTL)
resolves to nothing. Payloads expire 15 minutes after creation — see DECISIONS.md D023.

**Publishing a `TELEGRAM` version requires a validated bot.** `TrackingLinkVersion.snapshot`
includes `telegramBot.username`, and publishing is rejected if the chosen bot's
`botUsername` is unset — i.e. the bot has never been successfully validated via the admin's
**Validate** action (a live `getMe` call). This means a `TELEGRAM` path can never be
published pointing at a bot whose real `@username` isn't known, which is what makes building
the `t.me/{username}?start=...` deep link possible without a live API call on every click.

**Webhook authenticity is checked "as far as practical", not enforced absolutely.**
`TelegramBot.webhookSecretCiphertext` is set only once the admin's Validate action
successfully calls `setWebhook` (which requires `APP_BASE_URL` to be a real, public HTTPS
URL — it will not succeed against `http://localhost:3000`). Until then, the webhook accepts
any request for that bot; once a secret is on file, the
`X-Telegram-Bot-Api-Secret-Token` header must match exactly or the request is rejected with
401. See DECISIONS.md D024.

## 5. Versioning & immutability model

- `TrackingLink` is the stable, addressable, mutable *pointer* (id, token, brand, current
  version pointer, status).
- `TrackingLinkVersion` is an immutable snapshot of "what should happen when this link is
  hit", created every time an admin publishes a change. Old versions are retained forever
  (soft, never deleted) so historical `Click` rows always resolve to the exact config that
  was live when the click happened.
- Publishing = insert a new `TrackingLinkVersion` + update `TrackingLink.currentVersionId`
  in a single transaction. Nothing else about a link is ever edited in place.
- The same pattern (append-only, reference the version at write time) applies anywhere else
  attribution-relevant config can change — this is the mechanism that satisfies "historical
  attribution must not change."

## 5a. Validation gate — a TrackingLink is executable only once it passes

`src/lib/tracking-link-publishing.ts` is a plain (non-`"use server"`) module with no
`next/headers`/`requireAdmin` dependency, so it can be exercised directly from integration
tests as well as from the admin Server Actions:

- `validateTrackingLinkConfig(db, input)` — read-only. Loads the tracking link, campaign,
  social account, Telegram bot, and experiment arm referenced by `input`, and returns every
  rule violation found (not just the first), covering: domain/brand/campaign/social-account/
  Telegram-bot/experiment-arm existence and active status, campaign↔link brand match,
  social-account↔campaign platform match, Telegram-bot requirement for the `telegram` path
  type, destination-URL validity for `direct`/`aggregator`, experiment-arm↔experiment
  membership, and token uniqueness within the link's domain. Backs the admin's **Validate**
  button.
- `publishTrackingLinkVersion(tx, input, publishedById)` — must be called inside a
  `$transaction`. Re-runs the same validation; if anything fails, returns the issues and
  writes nothing. If valid, it creates the immutable `TrackingLinkVersion` (with its frozen
  `snapshot`, see below), points `TrackingLink.currentVersionId` at it, forces
  `TrackingLink.status` to `ACTIVE`, links the chosen `ExperimentArm` if any, and writes the
  `PUBLISH` audit log entry — all atomically. Backs the admin's **Publish** button, which
  therefore can never produce a "live" version that failed validation.

**The frozen snapshot.** Every `TrackingLinkVersion.snapshot` captures domain, token, brand,
platform, campaign (including its Paybig destination URL), social account, path type/config,
age gate flag, and experiment/arm context, copied by value at publish time — never a live
reference. This is what makes the core invariant hold: **editing a campaign's Paybig URL (or
any other mutable config) tomorrow cannot change what an already-published version resolves
to.** See `src/lib/tracking-link-publishing.test.ts` for the test that proves this directly.
The snapshot deliberately contains no secrets (no ciphertext, no raw Telegram token) — see
CLAUDE.md rule 11/12.

## 6. Security model

- **Admin auth**: simple session-based auth (credentials in Postgres, hashed with a strong
  KDF — e.g. bcrypt/argon2). No public sign-up; accounts are provisioned directly. See
  OPEN_QUESTIONS.md for whether/when SSO is needed.
- **Secrets at rest**: `TelegramBot.botTokenCiphertext`, `TelegramBot.webhookSecretCiphertext`,
  and `ApiConnection.credentialsCiphertext` are stored as ciphertext (AES-256-GCM, key from
  `ENCRYPTION_KEY` env var, never committed). Decryption only happens server-side, only at
  the point of use (building a Telegram API call, or checking an inbound webhook's secret
  header), never in a response payload sent to any client, and never logged — see
  `lib/telegram.test.ts`/`lib/telegram-webhook.test.ts` for tests that assert this directly by
  spying on `console.*` during a failing call.
- **Secrets never reach the frontend**: Server Components/Server Actions load and use
  decrypted secrets in-process only; client components only ever see non-secret fields
  (e.g. bot username, not bot token).
- **Audit log**: every admin create/update/archive writes an `AuditLog` row with actor,
  entity type/id, action, and before/after JSON. Audit logging is not optional per-mutation —
  it is enforced in the shared mutation helper, not repeated ad hoc per Server Action.
- **PII handling**: click-time IP addresses are hashed before storage (see
  OPEN_QUESTIONS.md for retention/hashing scheme); raw IP is not retained long-term.

## 7. Why Next.js App Router for both admin and public route

A single deployable serves both surfaces:
- Admin pages/actions live under an authenticated route group.
- The public `/l/[token]` route is a thin, fast Server Component/route handler with no
  admin-only dependencies in its hot path.
This avoids standing up a second service for V1 while keeping the module boundary (Section 3)
clean enough to split later if the public path ever needs independent scaling.

## 8. What this architecture explicitly refuses to become

- A workflow builder where admins wire arbitrary steps into a DAG. Path types are fixed;
  only their configuration is data-driven.
- A place where "just this once" hardcoding of a brand/campaign/domain creeps into route
  handlers or Server Actions. If a value can only come from the database, it must.
