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

The same file's `buildExperimentArmReport` tests cover the "aggregator vs Telegram" dashboard:
- A three-arm experiment (`AGGREGATOR` link, `TELEGRAM` link, and one arm never published to)
  returns one row per arm in creation order; each populated row's funnel metrics are precise
  (isolated to that arm's own clicks/events) and its `trackingLink`/`campaign` correctly
  identify what it's wired to; the never-published arm reports `trackingLink: null`,
  `campaign: null`, `campaignSignups: null`, and all-zero funnel metrics rather than erroring.
- **Regression-shaped case**: when two arms' links both publish against the *same* campaign,
  both rows report the *identical* `campaignSignups` figure — proving the dashboard shows an
  honest campaign-level number rather than fabricating a per-arm split Paybig data can't
  support (see DECISIONS.md D032).
- A second test with two arms on two *different* campaigns confirms `campaignSignups` is
  independent per row in that case (2 vs. 1), not a global figure.

`src/lib/tracking-link-publishing.test.ts` also covers the experiment/publish integration
points touched by this milestone: publishing accepts an experiment arm whose experiment has no
`brandId` restriction, and rejects one whose experiment's `brandId` doesn't match the
publishing link's brand (replacing the old, now-removed `experiment.trackingLinkId` check).

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

### Hardening audit (this milestone) — see DECISIONS.md D034–D041 for full rationale
- **Concurrency, not just sequential retries**: `public-routing.test.ts` fires several genuinely
  concurrent (`Promise.all`) `writeFunnelEvent` calls for the same click and a singleton step
  type, asserting exactly one row survives (D034) — and a companion test confirms a repeatable
  step type (`AGGREGATOR_VIEWED`) still allows real duplicates, so the fix's boundary is
  explicit, not assumed. `tracking-link-publishing.test.ts` does the same for two concurrent
  publishes of the same link, asserting version numbers never collide even when one request
  has to fail and retry (D041).
- **Timing side-channels**: `telegram-webhook.test.ts` proves `verifyWebhookSecret` doesn't
  throw on a mismatched-length header (the constant-time comparison's failure mode if the
  length pre-check were ever removed — D035). `lib/auth/password.test.ts` proves
  `DUMMY_PASSWORD_HASH` is inert (no real password matches it) and that comparing against it
  costs roughly the same as a real comparison, not a fast-path bypass (D036) — this doesn't
  assert exact timing equality (too flaky for a unit test), only that bcrypt's real cost is
  paid on both paths.
- **Malformed input**: `paybig-import.test.ts` covers a UTF-8-BOM-prefixed CSV header resolving
  correctly instead of every row reporting the first column missing (D038), and — found via the
  V1 QA pass, not written speculatively — a NUL byte anywhere in the file no longer crashes the
  whole import with an unhandled 500 (a unit test on `parseCsv`, plus an integration test
  proving `importPaybigCsv` imports a row cleanly even with a NUL in an ignored extra column;
  see D042).
- **Hung network calls**: `telegram.test.ts` proves `callTelegramApi` passes an `AbortSignal` to
  `fetch` and treats an abort like any other network failure, without waiting out a real
  timeout in the test itself (D040).
- **Case sensitivity**: `public-routing.test.ts` proves `getHostname` lowercases a mixed-case
  `Host` header (D037).
- Not unit tested (verified manually in a real browser instead, per the note in D039): the CSV
  upload size cap, since the check lives in a Server Action wrapper this suite's testing
  pattern doesn't reach into (route/action files are exercised manually, not unit tested — see
  `lib/` vs. `app/` throughout this document).

### Production hardening (this milestone) — see DECISIONS.md D044–D053 for full rationale
- `src/lib/auth/login-rate-limit.test.ts` (real Postgres): `isLockedOut` against `null`,
  future, and past `lockedUntil` relative to an injected `now`; `recordFailedLogin` increments
  below the threshold and locks (resetting the counter) exactly at `MAX_FAILED_LOGIN_ATTEMPTS`;
  `recordSuccessfulLogin` clears both fields.
- `src/lib/health.test.ts` (pure unit, fake `QueryableDb`): `checkDatabaseHealth` returns
  `"connected"` when the query succeeds and `"unreachable"` — without rethrowing — when it
  throws.
- `src/lib/env-validation.test.ts` (pure unit): a fully valid env passes; a missing
  `DATABASE_URL` or `ENCRYPTION_KEY` throws, naming both when both are missing; an
  `ENCRYPTION_KEY` that doesn't decode to exactly 32 bytes throws; a missing `APP_BASE_URL`
  does not throw (soft requirement, warns only).
- `src/lib/request-context.test.ts` (pure unit): `getOrCreateRequestId` reuses an existing
  upstream `x-request-id` header verbatim, and mints a fresh, distinct id on each call when one
  isn't present.
- `src/lib/paybig-import.test.ts` gained coverage for the optional `status` column (D048):
  accepted case-insensitively; missing/blank leaves an existing row's status untouched; an
  unrecognized value is rejected as invalid (both for a new row and for a re-imported existing
  `conversion_id`); a differing status on re-import updates the existing row and increments
  `ImportSummary.statusUpdated` rather than `duplicates`; a same-status re-import still counts
  as a duplicate.
- `src/lib/attribution-report.test.ts` gained a `trackingLinkId` filter test (D050): filtering
  by one of two tracking links isolates that link's click and reports
  `compatible: false`/`signupRatePerClick: null`, mirroring the existing path/social-account/
  experiment/experiment-arm cases.
- Not unit tested, verified live instead: the CSP nonce (D045; verified via curl showing the
  nonce header present, and via browser — login, an admin CRUD create action, and page
  rendering all worked with no CSP violations), the `instrumentation.ts` startup crash on a
  malformed `ENCRYPTION_KEY` (D046; verified by deliberately corrupting the key and observing
  `next dev` fail to boot with the exact error), `/api/health` returning 503 against a real
  Postgres outage (D047; verified via `docker stop`/`start funnelcore-postgres`), campaign-slug
  immutability including a direct hidden-field-tampering attempt (D049; verified live that the
  server-side check still rejects the change), and the structured log lines themselves for
  login/import/routing events (D053; verified via `grep` against the dev server's log output).

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
- Admin: create an experiment with two arms ("Aggregator", "Telegram"); publish one tracking
  link as `AGGREGATOR` and a second, different link as `TELEGRAM`, selecting the matching
  experiment/arm on each publish — confirm both links' published-version snapshots show the
  correct arm and that the experiment's arms table shows each arm wired to its own link (the
  scenario D030 exists to make possible). Manually insert `Click`/`FunnelEvent` rows for each
  arm's version and a `Conversion` against their shared campaign; confirm the "Arm performance"
  table shows each arm's funnel metrics correctly isolated while both rows show the *same*
  campaign-level signup count. Switch the experiment's success metric to Signups and confirm
  the extra warning banner appears.
- Hardening audit (this milestone): logged in with a nonexistent email (generic error, no
  behavior change) and with real credentials (still succeeds) to confirm the timing-equalization
  fix (D036) didn't break the login flow; uploaded a UTF-8-BOM-prefixed CSV through the real
  `/admin/conversions` form and confirmed it imported correctly rather than reporting every
  column missing (D038); published a new tracking-link version through the real form to confirm
  the publish action's new try/catch (D041) doesn't affect the normal, non-colliding path.

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
