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
- Validation rejection coverage: archived campaign, missing/inactive/unvalidated (no
  `botUsername`) Telegram bot for the `telegram` path type, social-account/tracking-link
  brand mismatch, experiment-arm/experiment mismatch — each asserts zero rows written and the
  specific issue surfaced. A companion positive test confirms publish succeeds once the bot
  *is* validated and that the snapshot's `telegramBot` carries the real username.
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
- `TELEGRAM` at `/path`: mints a start payload, returns the correct `t.me/{username}?start=`
  deep link, and logs `TELEGRAM_REDIRECTED`; a corrupted snapshot with `telegramBot: null`
  fails safely instead (defensive-only — publish-time validation should prevent this).
- `TELEGRAM` at `/out`: uses `campaign.paybigUrl` as the destination (it has no
  `pathConfig.destinationUrl`); a genuinely unrecognized `pathType` (forced via a type cast —
  not reachable through real code, since the enum only has 3 values) still fails safely.
- A corrupted/missing destination URL at `/out` fails safely and writes `ROUTE_FAILED`.
- **Idempotency**: calling the `/out` logic three times for one click produces exactly one
  `OUTBOUND_PAYBIG_REDIRECTED` event and replays the same destination each time — this
  regression test exists because manual browser testing caught a real triplication (see
  DECISIONS.md D020).
- Conversion ingestion idempotency: see `src/lib/paybig-import.test.ts` below — this ended up
  being CSV-import-shaped rather than a `Click`-adjacent concern, so it lives in its own file.
- Audit logging: every CRUD mutation path produces exactly one `AuditLog` row with the
  correct before/after payload.

`src/lib/telegram-payload.test.ts` covers payload creation, expiry, resolution, and
attribution preservation: token opacity (never embeds click/campaign/link ids, asserted by
substring check), TTL bounds, `not_found`/`expired` rejection, idempotent re-resolution, and
correct `experimentArmId` derivation when an arm is attached to the version.

`src/lib/telegram-webhook.test.ts` and `src/lib/telegram.test.ts` cover the Telegram API
integration itself — token validation with a mocked Telegram API, using an injectable
`fetch` implementation so no real Telegram credentials are needed for the automated suite:
- `/start` parsing (with and without the `@botname` suffix, bare `/start`, unrelated text).
- Webhook secret verification: permissive when unset, strict once configured.
- Full webhook flow: resolves the payload, logs `TELEGRAM_STARTED` exactly once even across
  repeated calls (Telegram may retry delivery), sends the CTA with the bot's configured
  welcome message/label and the correct `/out/{clickId}` URL.
- Failure paths: unknown bot, no `/start` payload, unknown/expired payload token.
- **Never logs the bot token**: both files spy on `console.log`/`.error`/`.warn` during a
  forced failure and assert none of the captured output contains the raw token — an
  executable proof, not just a code-review claim.

Manually verified against the *real* Telegram API in this milestone (see the session's
transcript): a live `getMe` call against a deliberately fake token returned Telegram's actual
`401 Unauthorized`, confirming the network integration itself works, not just the mocked
tests. The full local funnel (`/l` → `/path` → simulated webhook POST → `/out`) was also
exercised end-to-end with a manually-flagged "validated" bot, since no real bot token was
available in this environment.

`src/lib/paybig-import.test.ts` covers the CSV import pipeline (real Postgres for the
`importPaybigCsv` cases; the parsing/validation/key-computation functions are pure and tested
without a database):
- CSV parsing: a simple valid file, quoted fields with embedded commas and `""`-escaped
  quotes, CRLF line endings, a header-only file, and a fully empty file.
- Row validation: a fully valid row; a missing `conversion_id` treated as valid (it's the one
  optional field); missing/invalid `campaign_slug`, `conversion_time`, `amount`, and `currency`
  each rejected with a reason naming the offending field.
- Dedup key computation: `conversion_id` used directly when present; the composite fallback
  used when absent, proven stable across repeated calls for identical input and different
  across any single differing field (see DECISIONS.md D027 for the documented collision
  limitation this fallback accepts).
- `importPaybigCsv`: a full valid import creates one `Conversion` per row and matches
  campaigns by slug; a malformed row is reported without failing the rest of the import;
  **duplicates**: importing the same file twice (with `conversion_id`, and separately without
  it via the composite key) creates zero new rows the second time — the core "do not
  double-count repeated imports" requirement; **unmatched**: an unknown `campaign_slug` still
  creates a `Conversion` with `campaignId` null, reported with reason `not_found`;
  **ambiguous**: a slug shared by two brands' campaigns is treated as unmatched with reason
  `ambiguous` rather than guessed (D028), also with `campaignId` left null.

`src/lib/attribution-report.test.ts` covers the dashboard's aggregation logic against a real
fixture (brand, two campaigns — one flagged `isDefault` — a social account, an experiment/arm,
two published tracking-link versions of different path types, two clicks with distinct funnel
events, and three conversions: one attributed, one on the default campaign, one unmatched):
- Funnel metrics narrow correctly under every filter dimension (brand, platform, campaign,
  social account, path type, experiment, experiment arm) — each filter isolates exactly the
  click(s) it should.
- `signupAttribution.compatible` is `true` for date/brand/platform/campaign-only filter
  combinations and `false` the moment a path/social-account/experiment/experiment-arm filter
  is added; `signupRatePerClick`/`signupRatePerOutboundRedirect` are `null` whenever
  incompatible, and correctly computed when compatible.
- Signups are counted at the campaign level regardless of an incompatible filter (the count
  itself doesn't disappear, only the derived rates do).
- Unmatched conversions respect the date range but deliberately ignore brand/campaign filters
  (they have neither); default/catch-all conversions are counted separately from the named
  campaign's conversions.
- **Regression**: "signups" never double-counts a conversion also reported as "unmatched" —
  added after manual browser verification caught the two figures summing to more than the true
  total (see DECISIONS.md D029).
- A filter set matching nothing returns zeros and `null` rates rather than throwing or
  dividing by zero.

### Security-focused tests
- A Server Action or API route that returns `TelegramBot` or `ApiConnection` data to a client
  never includes `botTokenCiphertext` / `webhookSecretCiphertext` / `credentialsCiphertext` in
  the response shape, even if a future field gets added carelessly (assert on an explicit
  allow-list of returned fields, not just "doesn't crash").
- The Telegram webhook route rejects a mismatched `X-Telegram-Bot-Api-Secret-Token` once a
  secret is on file for that bot (401), and never processes the update in that case.
- Unauthenticated requests to any admin route/Server Action are rejected.
- Conversion ingestion (the CSV import Server Action) goes through the same `requireAdmin()`
  guard as every other admin mutation — resolved as "no separate inbound-endpoint auth needed"
  once V1 landed as an admin-triggered upload rather than a live webhook/API; see
  OPEN_QUESTIONS.md.

### End-to-end / manual (per UI change, per the project's UI-testing rule in CLAUDE.md)
- Admin: create a Brand → Platform → SocialAccount → Domain → Campaign → TrackingLink →
  publish → confirm it appears correctly in list/detail views.
- Public: visit a live tracking link in a real browser for each path type; confirm the
  redirect actually happens and a `Click` + `FunnelEvent` row appears.
- Confirm editing a published link's destination does not retroactively change how already-
  logged clicks report.
- Admin: upload a Paybig CSV covering the golden path (matched campaigns, a default-campaign
  row) and edge cases (an unknown `campaign_slug`, a malformed `amount`) in one file; confirm
  the on-screen summary counts and per-row reasons are correct, then re-upload the identical
  file and confirm it reports all-duplicates with zero new rows created (caught the signups/
  unmatched double-counting bug fixed in DECISIONS.md D029 during this exact check). Confirm
  the attribution dashboard's warning banner appears the moment a path/social-account/
  experiment/experiment-arm filter is selected, and disappears when cleared.

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
