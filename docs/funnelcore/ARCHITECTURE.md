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
| `app/l/[token]` | Public route: resolve token → version → execute path type | Contain any hardcoded brand/campaign/link behavior |
| `app/api/conversions` | Inbound Paybig conversion ingestion | Trust unverified payloads; must attribute via Campaign/Click, never guess |
| `lib/config` | Loading + resolving published configuration (link → version → path config) | Cache stale/unpublished data into the public path |
| `lib/attribution` | Click writing, FunnelEvent writing, conversion joining | Mutate historical Click/TrackingLinkVersion rows |
| `lib/crypto` | Field-level encryption/decryption for secrets (Telegram tokens, API credentials) | Ever return decrypted secrets to a client component or API response |
| `lib/audit` | Recording before/after diffs for admin mutations | Be optional / skippable by any mutation path |
| `lib/auth` | Password hashing/verification, session issuance/validation/revocation | Store a plaintext password or a raw (unhashed) session token; trust a cookie value without checking it against `Session` |
| `lib/tracking-link-publishing` | Validating a proposed TrackingLink configuration and, if valid, publishing an immutable `TrackingLinkVersion` with a frozen snapshot | Write anything when validation fails; depend on `next/headers`/`requireAdmin` (must stay callable from tests without a request context) |
| `prisma/` | Schema, migrations | Contain seed data that hardcodes real brands/campaigns |

## 4. Request flow: public click

1. Visitor requests `GET /l/{token}`.
2. Route loads `TrackingLink` by `token` (indexed, unique). If missing/inactive → 404.
3. Route loads the link's **current published** `TrackingLinkVersion` (immutable snapshot:
   path type + path config + gate config + campaign + social account references at publish
   time).
4. A `Click` row is written immediately, capturing: `trackingLinkId`,
   `trackingLinkVersionId`, `brandId`, `platformId`, `socialAccountId`, `campaignId`,
   IP hash, user agent, referrer, UTM params, timestamp. This is the attribution snapshot —
   later edits to the link/version never change this row.
5. If the version has an age gate configured, the visitor is shown the gate
   (`FunnelEvent: gate_shown`); on pass, `FunnelEvent: gate_passed` is written and the visitor
   continues. On fail, the flow stops.
6. The path type handler executes:
   - `direct` → redirect to the version's configured destination URL.
   - `aggregator` → redirect to the version's configured aggregator destination.
   - `telegram` → redirect to a deep link built from the version's configured `TelegramBot`
     + optional start payload (e.g. encoding the `clickId` for later attribution inside
     Telegram).
   A `FunnelEvent` is written for the redirect step (`redirect_direct` /
   `redirect_aggregator` / `redirect_telegram`).
7. Downstream, the visitor may reach Paybig. Paybig eventually reports a conversion.
8. Conversion ingestion attributes the conversion to a `Click` (and therefore to a `Campaign`,
   `TrackingLinkVersion`, `Brand`, `Platform`) using whatever join key Paybig provides
   (click id passed through the redirect chain, or a Paybig-side campaign/sub-id mapped back
   to our `Campaign`) — see OPEN_QUESTIONS.md for the exact join mechanism, which depends on
   Paybig's actual redirect/postback contract.

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
- **Secrets at rest**: `TelegramBot.botToken` and `ApiConnection.credentials` are stored as
  ciphertext (AES-256-GCM, key from `ENCRYPTION_KEY` env var, never committed). Decryption
  only happens server-side, only at the point of use (e.g. building a Telegram API call),
  never in a response payload sent to any client.
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
