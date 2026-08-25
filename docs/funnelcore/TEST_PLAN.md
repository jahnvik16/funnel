# FunnelCore — Test Plan

## 1. Principles

- The public `/l/[token]` route and the attribution/conversion join are the highest-risk
  surfaces (they are the entire point of the product) and get the most test weight.
- Anything that touches the immutability/versioning guarantees
  ("historical attribution must not change") needs an explicit regression test, not just
  happy-path coverage.
- Anything that touches secrets (Telegram tokens, API credentials) needs a test asserting
  the plaintext value never appears in an API/Server Component response.

## 2. Layers

### Unit tests
- `lib/config` — resolving a token to a link and its current version; correct handling of
  paused/archived links (must not resolve).
- `lib/attribution` — Click snapshot construction from a version (correct copy of
  brand/platform/socialAccount/campaign ids at write time).
- `lib/crypto` — encrypt/decrypt round-trip; decrypted values never logged.
- Prisma schema constraints — unique constraints on `TrackingLink.token`,
  `Conversion.paybigConversionId`, `(trackingLinkId, versionNumber)`.

### Integration tests (against a real local Postgres via Docker Compose)
`src/lib/tracking-link-publishing.test.ts` runs these against the same dev database used by
`npm run dev` (there is no separate test database yet — each test creates uniquely-named
fixtures and deletes them in an `after` hook; see that file's comments before adding more).
- Publish flow: publishing a new `TrackingLinkVersion` updates `TrackingLink.currentVersionId`
  and leaves the previous version row byte-for-byte unchanged.
- **CRITICAL INVARIANT (implemented)**: publish a version, then change the campaign's
  `paybigUrl`; assert the published version's `snapshot.campaign.paybigUrl` is unchanged while
  the live `Campaign.paybigUrl` reflects the edit. Also assert the full `snapshot` JSON is
  byte-for-byte identical before and after (`assert.deepEqual`).
- Validation rejection coverage: archived campaign, missing/inactive Telegram bot for the
  `telegram` path type, social-account/tracking-link brand mismatch, experiment-arm/experiment
  mismatch — each asserts zero rows written and the specific issue surfaced.
- **Immutability regression**: create a click against version N, then publish version N+1;
  assert the original `Click` row's `trackingLinkVersionId` still points at N and reporting
  aggregates built from it are unchanged. *(Not yet implemented — no reporting queries exist
  yet to assert "unchanged" against; the underlying data (Click pinned to a version) is
  already covered by `recordClick copies attribution from the snapshot, not live config`.)*

`src/lib/public-routing.test.ts` covers the public funnel (same real-Postgres, same fixture
pattern — note its `deleteClick` helper, needed because `FunnelEvent` has a required FK to
`Click`):
- `resolveTrackingLinkVersion`: the happy path plus every failure reason (unknown domain,
  inactive domain, unknown token, paused link, unpublished link) — each asserted by its
  specific `reason` value, not just "fails."
- Full `DIRECT` and `AGGREGATOR` flows: exact `FunnelEvent` sequence asserted in order
  (`ROUTE_RESOLVED` → ... → `OUTBOUND_PAYBIG_REDIRECTED`), and the redirect destination
  matches the published `pathConfig.destinationUrl`.
- Age gate: shown → accepted (and, separately, shown → declined) — click context (the click
  id itself) is confirmed to still resolve after the gate step.
- Failure after a `Click` already exists: an unsupported (`TELEGRAM`) path type at `/path` and
  at `/out` both fail safely and write `ROUTE_FAILED`; a corrupted/missing destination URL at
  `/out` fails safely and writes `ROUTE_FAILED`.
- **Idempotency**: calling the `/out` logic three times for one click produces exactly one
  `OUTBOUND_PAYBIG_REDIRECTED` event and replays the same destination each time — this
  regression test exists because manual browser testing caught a real triplication (see
  DECISIONS.md D020).
- Conversion ingestion idempotency: posting the same `paybigConversionId` twice results in
  one `Conversion` row, not two.
- Audit logging: every CRUD mutation path produces exactly one `AuditLog` row with the
  correct before/after payload.

### Security-focused tests
- A Server Action or API route that returns `TelegramBot` or `ApiConnection` data to a client
  never includes `botTokenCiphertext` / `credentialsCiphertext` in the response shape, even
  if a future field gets added carelessly (assert on an explicit allow-list of returned
  fields, not just "doesn't crash").
- Unauthenticated requests to any admin route/Server Action are rejected.
- Conversion ingestion endpoint validates/authenticates the caller (mechanism TBD — see
  OPEN_QUESTIONS.md) and rejects unverified payloads.

### End-to-end / manual (per UI change, per the project's UI-testing rule in CLAUDE.md)
- Admin: create a Brand → Platform → SocialAccount → Domain → Campaign → TrackingLink →
  publish → confirm it appears correctly in list/detail views.
- Public: visit a live tracking link in a real browser for each path type; confirm the
  redirect actually happens and a `Click` + `FunnelEvent` row appears.
- Confirm editing a published link's destination does not retroactively change how already-
  logged clicks report.

## 3. What "done" looks like per phase

Each phase in IMPLEMENTATION_PLAN.md should not be considered complete until:
1. Unit + integration tests for that phase's new code pass locally (`npm test` and against
   the Docker Compose Postgres).
2. For any UI change, the feature was exercised in a real browser per the golden path and at
   least one edge case (per the root CLAUDE.md rule on testing UI changes).
3. No secret value appears in any client-visible payload, log line, or committed file.

## 4. Out of scope for now

- Load/performance testing of the public route — deferred until Phase 4 ships a working
  implementation to measure.
- Cross-browser/device matrix testing — deferred until there's a real UI to test beyond the
  admin shell.
