# FunnelCore — Open Questions

Unresolved items that need a real answer (from the business/Paybig/Telegram side, or a
deliberate product decision) before or during the phase noted. Not blocking Phase 0.

## Paybig integration (blocks Phase 2 & Phase 5)
- What does Paybig's actual conversion notification look like — webhook push, polling API,
  or a redirect-time postback? This determines the shape of `Conversion.rawPayload` and how
  `Conversion` attributes back to `Click`.
- What join key does Paybig round-trip to us? Options: we pass our `clickId` as a sub-id/
  click-id param through the redirect chain and Paybig echoes it back on conversion; or
  Paybig only gives us its own campaign/lane id and we attribute at the `Campaign` level
  (coarser — can't tie a conversion to one specific click, only to a campaign+time window).
- Does Paybig support a test/sandbox mode for verifying the integration without real spend?
- Authentication for the inbound conversion endpoint — shared secret header, IP allowlist,
  signed payload? Needs to be resolved before Phase 5's security tests can be written.

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
- What's the expected query volume/retention window for `Click`/`FunnelEvent`? Affects
  whether V1 needs any pre-aggregation or if direct Postgres queries over raw rows are
  sufficient for the reporting phase.
