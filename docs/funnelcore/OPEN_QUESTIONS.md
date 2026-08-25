# FunnelCore — Open Questions

Unresolved items that need a real answer (from the business/Paybig/Telegram side, or a
deliberate product decision) before or during the phase noted. Not blocking Phase 0.

## Paybig integration — V1 shipped as CSV import; what remains open
- **Resolved for V1**: the conversion notification is an admin-uploaded CSV
  (`campaign_slug`, `conversion_time`, `amount`, `currency`, optionally `conversion_id`) — not
  a webhook, polling API, or redirect-time postback. `lib/paybig-import.ts` +
  `/admin/conversions`; see DECISIONS.md D027.
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
  against a very large export.

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
- Is 18+ confirmation just a click-through interstitial (no real verification), or does
  compliance require something stronger (date-of-birth capture, geo-based enforcement)?
  Current schema (`ageGateEnabled Boolean` + generic `pathConfig`) assumes click-through only.
- Should a passed gate be remembered (cookie/session) so repeat visitors from the same link
  don't see it again, and if so for how long?

## Attribution edge cases
- Multi-touch: if a visitor clicks two different tracking links before converting, which one
  gets credit? Current model is last-click-per-Click-row; no multi-touch model designed yet.
- Click fraud / bot traffic filtering — not addressed in V1 schema at all. Needs a decision
  on whether to filter at ingestion or flag-and-report.
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

## Auth / RBAC
- V1 schema has `AdminRole: ADMIN | VIEWER`. Is that sufficient, or do specific brands need
  scoped access (an admin who can only manage Brand X)? Not modeled yet — would need a
  join table (`AdminUser` ↔ `Brand` with role) if required.
- SSO requirement? Currently assumes email/password with a hashed credential in Postgres.

## Domains
- Is a `Domain` row expected to correspond to real DNS + TLS provisioning that FunnelCore
  automates, or is DNS/TLS handled manually outside the app and `Domain` is just a config
  record for routing? Affects whether Phase 1 needs any external DNS/certificate API calls.

## Experiments
- No concrete use case has been specified yet beyond "admin should eventually configure
  experiments." Deliberately left minimal (`variantConfig Json`, no experiment execution
  logic) until there's a real scenario to design against — see IMPLEMENTATION_PLAN.md
  Phase 7. Do not build this out speculatively.

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
