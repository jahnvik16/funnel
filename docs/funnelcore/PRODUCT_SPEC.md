# FunnelCore — Product Spec

## 1. What this is

FunnelCore is an internal, configuration-driven funnel and attribution system. It lets a
non-developer admin define the entities that make up a traffic funnel — brands, platforms,
social accounts, domains, Paybig campaigns, tracking links, Telegram bots, API connections,
and experiments — and have the backend execute that configuration for public traffic without
any code changes per account, campaign, or path.

The system exists to answer one question reliably:

> **Which brand/platform/path produced actual paid signups?**

Everything in this spec is scoped to making that question answerable, auditable, and
historically stable (i.e. answers don't change retroactively because someone edited a
config today).

## 2. Who uses it

- **Admin / growth operator**: configures brands, platforms, social accounts, domains,
  campaigns, tracking links, Telegram bots, and experiments through an admin UI. Publishes
  changes. Reviews attribution/conversion reports.
- **Public visitor**: never sees the admin. Interacts only with `/l/{tracking_token}` links
  shared on social platforms, in bios, in ads, or in Telegram.
- **Paybig** (external system): the paid-acquisition platform that is authoritative for
  signups/conversions. FunnelCore receives conversion data from Paybig and joins it back to
  click-level attribution.
- **Future: developer/agent** extending the system — see [AGENTS.md](AGENTS.md) and the root
  `CLAUDE.md` for the rules that govern that work.

## 3. Core business question

**"Which brand/platform/path produced actual paid signups?"**

This requires joining three layers that must never be conflated:

1. **Intent** — a click happened, from a specific brand/platform/social account/campaign,
   via a specific tracking link configuration, at a specific point in time.
2. **Behavior** — the visitor moved through the funnel (gate shown/passed, redirected to
   direct/aggregator/Telegram, reached Paybig).
3. **Outcome** — Paybig reports a conversion (signup, deposit, etc.) that must be traced back
   to the click(s) that produced it.

Click records are authoritative for clicks. Paybig is authoritative for signups. FunnelCore's
job is the durable, correct join between them — not to second-guess either source.

## 4. Public traffic flow (V1)

```
/l/{tracking_token}
  → click logging (Click row written, attribution context captured at click time)
  → optional 18+ age gate
  → configured path execution:
      - direct      → redirect straight to an operator-configured destination URL
      - aggregator  → redirect to an aggregator/listing destination
      - telegram    → redirect into a configured Telegram bot/channel deep link
  → (eventually) Paybig
  → conversion attribution / reporting
```

Every step that materially changes visitor state emits a `FunnelEvent` row, so the funnel can
be reconstructed and drop-off can be measured stage by stage.

## 5. V1 scope

### In scope
- Admin CRUD (create/edit/archive, not hard delete) for: Brand, Platform, SocialAccount,
  Domain, Campaign (Paybig lane), TrackingLink, TelegramBot, ApiConnection, Experiment.
- Publishing model: editing a TrackingLink creates a new immutable `TrackingLinkVersion`;
  the public route always resolves to whichever version was "current" at click time for
  historical clicks, and to the current published version for new clicks.
- Public route `/l/{tracking_token}` that resolves configuration and executes exactly one of
  the three V1 path types: `direct`, `aggregator`, `telegram`.
- Optional 18+ interstitial gate, configurable per tracking link.
- Click logging with full attribution context snapshot.
- Funnel step event logging.
- Conversion ingestion from Paybig (format TBD — see
  [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)) and attribution back to clicks/campaigns.
- Basic reporting: clicks, funnel step conversion rates, and paid-conversion attribution by
  brand/platform/campaign/tracking link.
- Simple admin authentication (single role to start — see OPEN_QUESTIONS.md for RBAC).
- Audit logging of all admin configuration changes.
- Encryption at rest for Telegram bot tokens and third-party API credentials.

### Explicitly out of scope for V1
- A generic/visual workflow builder. Path types are a **fixed, small enum**
  (`direct | aggregator | telegram`), not a user-composable graph. Adding a new path type is
  a developer change to the ARCHITECTURE; configuring which existing path type a link uses is
  an admin change.
- Multi-tenant SaaS billing/self-serve signup — this is an internal tool.
- Real-time streaming analytics (a queryable Postgres-backed report is sufficient for V1).
- Client-side tracking pixels / browser fingerprinting beyond what's needed for basic
  attribution (IP, UA, referrer, UTM params).
- Automatic Paybig campaign creation (Campaign rows are linked to Paybig lanes, not
  provisioned into Paybig by FunnelCore in V1).

## 6. Non-negotiable business rules

- Nothing about a **brand**, **platform**, **campaign**, **social account**, or **domain** is
  hardcoded in application code. They are rows created via the admin.
- A **TrackingLink** is the executable public route object — the public route handler does
  nothing but resolve a token to a link, resolve the link to its current published version,
  and execute that version's path type.
- A **Campaign** represents Paybig lane attribution — it is how a click/conversion is tied to
  a specific paid-acquisition lane in Paybig.
- **TrackingLinkVersion** rows are immutable once published. Editing a link's behavior always
  creates a new version; existing versions are never mutated.
- **Click** rows capture a full attribution snapshot (which version, which campaign, which
  social account, etc.) at the moment of the click. A click's attributed context must not
  change if the underlying config is edited later.
- **Historical attribution must not change** because someone edits current configuration.
  This is the reason TrackingLinkVersion and Click both snapshot state instead of referencing
  live, mutable rows for anything attribution-relevant.
- All admin changes are auditable (who changed what, when, before/after).
- Secrets (Telegram bot tokens, third-party API credentials) are never exposed to the
  frontend, and are encrypted at rest.

## 7. Success criteria for V1

- An admin can, without a developer, launch a new brand + platform + tracking link end to end
  and see clicks flow in.
- A report can answer "which brand/platform/tracking link drove paid signups in the last N
  days" using only Click + Conversion data joined through Campaign/TrackingLinkVersion.
- Editing a live tracking link's destination does not change how last week's clicks are
  attributed in reporting.
