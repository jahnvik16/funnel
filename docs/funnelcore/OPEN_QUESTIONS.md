# FunnelCore — Open Questions

Unresolved items that need a real answer (from the business/Paybig/Telegram side, or a
deliberate product decision) before or during the phase noted. Not blocking Phase 0.

## Paybig integration — V1 shipped as CSV import; what remains open
- **Resolved for V1**: the conversion notification is an admin-uploaded CSV
  (`campaign_slug`, `conversion_time`, `amount`, `currency`, optionally `conversion_id`,
  optionally `status`) — not a webhook, polling API, or redirect-time postback.
  `lib/paybig-import.ts` + `/admin/conversions`; see DECISIONS.md D027, D048. **Reaffirmed
  (D043.5)**: this stays CSV-only until the business confirms Paybig actually offers a live
  API/webhook integration — `ApiConnection` remains an unused credential holder for now.
- **Resolved this milestone (D048)**: an optional `status` column
  (`pending`/`confirmed`/`reversed`) lets a re-imported row update an existing conversion's
  status — the previously-flagged gap where `ConversionStatus` existed in the schema but
  nothing ever set it beyond the default is closed. Only the `status` column is ever revisited
  on a re-import; amount/currency/campaign match are not.
- **Resolved for V1**: the join key Paybig round-trips is `campaign_slug` only — no click-id/
  sub-id. Attribution is therefore at the `Campaign` level, the coarser of the two options this
  file previously posed: a conversion can be tied to a campaign+time window, never to one
  specific click. `Conversion.clickId` stays null for every CSV-imported row in V1. The
  attribution dashboard (`lib/attribution-report.ts`, DECISIONS.md D029) makes this explicit
  rather than papering over it — signup metrics are only ever computed at the campaign level,
  and the UI visibly flags when a selected filter (path/social account/experiment/experiment
  arm) can't be honored by signup data.
- **Still open**: if Paybig later offers a real inbound mechanism (webhook/API) instead of a
  manual CSV export, or starts round-tripping a click-id/sub-id, revisit both the ingestion
  mechanism (currently admin-triggered upload, authenticated via the existing admin session —
  no separate inbound-endpoint auth was needed) and whether click-level signup attribution
  becomes possible. That would let `signupRatePerClick`/`signupRatePerOutboundRedirect` be
  computed precisely at any filter granularity instead of being suppressed under D029's
  compatibility rule.
- **Still open**: does Paybig support a test/sandbox export for verifying the CSV format
  without real spend? V1's tests use synthetic CSVs built from the milestone's documented
  minimum-field spec, not a real Paybig export sample.
- **Still open**: CSV delivery cadence/volume is unknown — `lib/paybig-import.ts` processes a
  file row-by-row with no batching/streaming, fine for the volumes tested so far but untested
  against a very large export. A flat 10 MB upload cap (DECISIONS.md D039) guards against the
  worst case but isn't a real answer to "what if Paybig's exports get much larger" — that would
  need background job processing, not a bigger cap.
- **Audited, not fixed**: the import's `AuditLog` row is written once, after every row has been
  processed, as a separate statement from the row-by-row import itself (not one shared
  transaction — see D027 for why: an import can be large, and one bad row shouldn't block the
  rest). If the process crashes between the last row committing and that audit write, the
  conversions are correctly imported but the batch has no audit trail entry. A narrow window,
  and the underlying data is still correct either way — only the audit record of *that specific
  import event* could go missing, not any conversion data.

## Telegram — implemented; what remains open
- **Resolved**: deep-link mechanics are `t.me/<bot>?start=<payload>` → Telegram sends
  `/start <payload>` to our webhook → we resolve the payload server-side and reply with a CTA
  linking back to `/out/{clickId}`. No separate bot process — a single Next.js webhook route
  handles it, matching "do not build a complex conversational bot."
- **Resolved**: one brand can have multiple bots (schema already supported this); nothing
  in this milestone changed or needed to change that.
- **Still open**: rate limits / Telegram API quirks under real volume — untested beyond
  manual single-request verification and the mocked-API test suite. If a brand's bot gets
  meaningful traffic, revisit `sendMessage` error handling (currently: log nothing, fail the
  send silently, keep the attribution event) for retry/backoff behavior.
- **Still open**: `setWebhook` requires a real public HTTPS `APP_BASE_URL` — verified against
  the real `getMe`/`sendMessage` endpoints in this milestone's testing (both returned genuine
  Telegram error responses for a fake token), but `setWebhook` itself was never exercised
  against a reachable URL, so the admin's "best-effort" webhook registration path is unverified
  against the real endpoint. Confirm once this app has a real deployment URL.
- **Still open**: no re-validation reminder/expiry — once `botUsername` is set, nothing
  prompts an admin to re-check it stays correct (e.g. if the bot is deleted in Telegram's
  BotFather). A stale `botUsername` would only surface as a broken deep link at click time.

## Age gate
- **Resolved for V1 (D043.2)**: the 18+ gate stays a click-through acknowledgement, not identity
  verification. AdultPrime remains authoritative; the gate stays configurable per tracking link
  as it already was, and will not grow date-of-birth capture or geo-enforcement.
- Should a passed gate be remembered (cookie/session) so repeat visitors from the same link
  don't see it again, and if so for how long? Still open — not addressed by D043.

## Attribution edge cases
- **Resolved for V1 (D043.3)**: attribution stays last-click, deterministic. No first-touch or
  multi-touch model will be built for V1.
- **Resolved for V1 (D043.7)**: click fraud / bot traffic is logged, never blocked. No
  traffic-blocking logic exists or is planned for V1. Reporting exposure for suspicious-behavior
  signals is deferred to a later milestone — there is no fraud-signal collection yet, so there is
  nothing to report on today.
- IP hashing scheme and retention period for raw IP (currently: `lib/public-routing.ts`'s
  `hashIp` does an unsalted SHA-256 of the raw IP before it ever touches storage — satisfies
  "hash before storage, no raw IP retention" but has no salt/rotation policy; a determined
  attacker with a candidate IP list could still confirm membership. Revisit before this
  matters for compliance purposes).
- **`pathConfig.destinationUrl` vs. `campaign.paybigUrl` as the actual `/out` redirect
  target** (see DECISIONS.md D019): the public route currently redirects to
  `pathConfig.destinationUrl`. Once Paybig's actual integration contract is known, confirm
  whether that's still correct or whether `campaign.paybigUrl` (possibly with click-id/sub-id
  parameters appended) should be the real destination instead.
- **Audited, not fixed**: `getClientIp` trusts `x-forwarded-for` with no verification that the
  request actually came through a trusted proxy — a direct client could set that header to
  claim any IP, which `hashIp` would then hash and store as if genuine. Since `ipHash` is
  purely descriptive analytics data today (not used for fraud detection, deduplication, or any
  decision that affects attribution correctness), spoofing it doesn't corrupt anything that
  currently matters — but it's part of the same unresolved "click fraud / bot traffic
  filtering" gap immediately above, not a new, separate problem.
- **Resolved (D043.1)**: pausing or archiving a `TrackingLink` blocking only *new* clicks
  (`resolveTrackingLinkVersion` checks `link.status` at `/l/[token]`) is confirmed as the
  permanent, intended behavior, not a gap — a visitor who already has a `clickId` mid-funnel
  will continue to complete `/gate` → `/path` → `/out` off the frozen snapshot (D016), and none
  of those three routes will be changed to re-check the link's live status. An emergency
  kill-switch that also stops in-flight visitors is explicitly deferred to a future, separate
  mechanism if compliance ever requires it — not built in this milestone.

## Auth / RBAC
- **Resolved for V1 (D043.4)**: RBAC stays single-role (`ADMIN`) for V1 — no Viewer/Manager
  permission model this milestone. The schema (`AdminRole: ADMIN | VIEWER`) is already
  extensible for this; if specific brands ever need scoped access (an admin who can only manage
  Brand X), that would still need a new join table (`AdminUser` ↔ `Brand` with role) — not
  modeled, and out of scope until RBAC itself is revisited.
- **Still open, unchanged by this milestone**: `AdminRole.VIEWER` is not enforced anywhere —
  every Server Action that mutates data calls `requireAdmin()`, which only checks "is logged
  in," never "is this account actually an ADMIN." A VIEWER account could perform every mutation
  an ADMIN can. Not fixed because there is currently no way to create a VIEWER account at all
  (no admin-user-management UI exists; the only `AdminUser.create` call in the codebase is the
  seed script, which always assigns ADMIN) — the gap exists in the code but has no live
  exploitation path today. If admin-user management is ever built, wiring real role checks into
  every mutating action must happen in the same change, not after.
- SSO requirement? Currently assumes email/password with a hashed credential in Postgres.
- **Resolved this milestone (D044)**: login now has DB-backed rate limiting/lockout —
  `AdminUser.failedLoginAttempts`/`lockedUntil`, 5 failures locks the account for 15 minutes.
  Chosen DB-backed (not in-memory) specifically so it survives a restart and works correctly
  across multiple app instances. Distinct from the timing side-channel closed in DECISIONS.md
  D036 (D036 stops an attacker from learning *which emails exist*; D044 slows down guessing a
  known email's password).

## Domains
- Is a `Domain` row expected to correspond to real DNS + TLS provisioning that FunnelCore
  automates, or is DNS/TLS handled manually outside the app and `Domain` is just a config
  record for routing? Affects whether Phase 1 needs any external DNS/certificate API calls.

## Experiments — V1 "aggregator vs Telegram" framework shipped; what remains open
- **Resolved for V1**: the concrete use case is manually-assigned arms (e.g. one arm's link
  published as `AGGREGATOR`, another arm's link published as `TELEGRAM`) with per-arm funnel
  reporting — see IMPLEMENTATION_PLAN.md Phase 7 and DECISIONS.md D030–D033.
  `ExperimentArm.weight` and `successMetric` are stored/displayed but do not drive any
  behavior; there is no traffic splitting, winner selection, or statistical inference, per the
  milestone's explicit exclusions.
- **Still open**: if traffic-split execution is ever wanted (the public `/l/[token]` route
  actually randomizing which of an experiment's arms/links a visitor lands on, rather than an
  admin distributing two links by hand), that's new work in `lib/public-routing.ts` — not
  attempted here, and only worth doing if V1's manual approach proves insufficient in practice.
- **Still open**: no re-validation/staleness warning when an arm's `trackingLinkVersionId`
  points at a version that's no longer that link's `currentVersionId` (i.e. the link was
  re-published without re-selecting the same arm) — the admin UI shows whatever the arm is
  currently wired to, without flagging that it may be stale. Acceptable for V1's "manually
  assigned" scope; revisit if this causes real confusion.
- **Still open**: no statistical significance/confidence-interval tooling exists or is planned
  for V1 — an admin comparing two arms' funnel numbers is doing so by eye. Explicitly out of
  scope per the milestone brief ("do not build... complex statistical inference").

## `pathConfig` / `telegramBotId` consistency — resolved
- Decided in the Phase 1b/2/3 admin CRUD milestone: enforced at the application layer only
  (a Zod `superRefine` in the publish Server Action requires `destinationUrl` for
  `direct`/`aggregator` and `telegramBotId` for `telegram`), not a Postgres `CHECK`
  constraint. No DB-level enforcement exists — a direct SQL write could still violate this.

## Reporting
- `/admin/reports` (Phase 6) runs direct Postgres `count()` queries over raw `Click`/
  `FunnelEvent`/`Conversion` rows per request, no pre-aggregation — untested at real traffic
  volume. What's the expected query volume/retention window? Affects whether V1 eventually
  needs pre-aggregated rollups instead of counting raw rows on every dashboard load.
- The dashboard's date-range filter has no default bound (an all-time query if left blank) —
  fine at current data volumes, worth revisiting once there's enough `Click`/`Conversion`
  history for that to matter.
- **Resolved this milestone (D050)**: tracking link is now a filter dimension on
  `/admin/reports`, closing the gap against PRODUCT_SPEC.md's own reportable-dimensions list.
  Selecting one marks signup-rate metrics incompatible, same reasoning D029 already established
  for path/social-account/experiment/experiment-arm (a campaign can span more than one tracking
  link).
- **Resolved this milestone (D051)**: `/admin/conversions` now supports pagination and search
  by `paybigConversionId`, closing the "capped at 50 rows, no way to see older ones" gap.
- **Resolved this milestone (D052)**: `Click.brandId`/`platformId`/`socialAccountId` now have
  covering indexes, closing the previously-flagged missing-index gap for these dashboard filter
  columns.

## Production hardening audit — reviewed, deliberately left as-is
Findings from this milestone's full audit against CLAUDE.md that were reviewed and judged
correct as-is, not oversights. Recorded so a future audit doesn't have to re-derive the
reasoning from scratch. Fixes that came out of the same audit are DECISIONS.md D034–D041; the
VIEWER-role, login-lockout, IP-spoofing, paused-link, and CSV-audit-atomicity findings above are
part of this same review, just filed under their more specific sections.
- **`lib/crypto.ts`'s `decryptSecret` fails hard (throws) on any ciphertext it can't decrypt** —
  a corrupted value, or one encrypted under a different `ENCRYPTION_KEY` than the one currently
  configured (e.g. after a key rotation that didn't re-encrypt existing secrets). This surfaces
  as an unhandled 500 wherever it's called (Telegram webhook, bot validation, API connection
  use) rather than a graceful degradation. Kept as-is deliberately: silently treating an
  undecryptable secret as "absent" or "empty" would be worse — a wrong Telegram bot token
  silently failing to send is a much harder bug to notice than a loud, immediate failure. Key
  rotation itself isn't supported (there's no mechanism to re-encrypt existing ciphertext under
  a new key) — out of scope until it's actually needed.
- **`Campaign.isDefault`'s "at most one default per brand+platform" invariant is still only
  application-enforced, not DB-enforced** (D011) — re-reviewed during this audit given
  "concurrent requests" was an explicit focus area. Two admins concurrently setting *different*
  campaigns as the default for the same brand+platform can both pass the "demote the others"
  transaction before either commits, leaving two campaigns flagged default. Confirmed still
  acceptable: worst case is a data-quality nuisance (two "defaults" until an admin fixes it by
  hand), not corrupted attribution history — unlike the `FunnelEvent` singleton-step race fixed
  in D034, nothing here is written to a `Click`/`Conversion` row that becomes permanently wrong.
