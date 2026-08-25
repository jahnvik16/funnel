# CLAUDE.md — FunnelCore Engineering Rules

**Read this file before every implementation task in this repo.** These are permanent
project rules, not suggestions. If a request conflicts with a rule here, say so and ask
before proceeding rather than silently complying or silently refusing.

Full context lives under [`docs/funnelcore/`](docs/funnelcore/) — in particular
[AGENTS.md](docs/funnelcore/AGENTS.md) (agent-specific navigation),
[PRODUCT_SPEC.md](docs/funnelcore/PRODUCT_SPEC.md),
[ARCHITECTURE.md](docs/funnelcore/ARCHITECTURE.md),
[DATA_MODEL.md](docs/funnelcore/DATA_MODEL.md),
[IMPLEMENTATION_PLAN.md](docs/funnelcore/IMPLEMENTATION_PLAN.md),
[DECISIONS.md](docs/funnelcore/DECISIONS.md), and
[OPEN_QUESTIONS.md](docs/funnelcore/OPEN_QUESTIONS.md). Read the relevant doc before
extending a module you haven't touched before.

## What FunnelCore is

A configuration-driven funnel and attribution system. It answers: **"Which brand/platform/
path produced actual paid signups?"** The backend executes published configuration
(brands, platforms, social accounts, domains, campaigns, tracking links, Telegram bots, API
connections, experiments); it never hardcodes any of that data. See
[PRODUCT_SPEC.md](docs/funnelcore/PRODUCT_SPEC.md) for full scope.

## Non-negotiable architectural rules

1. **Do not hardcode brands, platforms, campaigns, social accounts, or domains** anywhere in
   application code. If a value should be admin-configurable, it lives in the database, not
   in code, a constant, or an enum.
2. **Do not build a generic workflow builder.** V1 path types are a fixed, small set —
   `direct | aggregator | telegram` — implemented as three concrete handlers. What's
   configurable is the *data* each handler consumes, never the *set* of available behaviors.
3. **`TrackingLink` is the executable public route object.** The public route
   (`/l/{tracking_token}`) does nothing but resolve a token to a link, resolve the link to
   its current published version, and execute that version's path type. No per-brand/
   per-campaign conditional logic belongs in the route handler.
4. **`Campaign` represents Paybig lane attribution.** It is the join point between our
   tracking config and a specific paid-acquisition lane in Paybig.
5. **`TrackingLinkVersion` rows are immutable once published.** Editing a link's behavior
   always creates a new version via a publish transaction. Never `UPDATE` an existing
   version row.
6. **`Click` rows capture attribution context at click time** (brand/platform/social
   account/campaign, copied from the resolved version), and are authoritative for clicks.
   This data must never be recomputed from current/live config after the fact.
7. **`FunnelEvent` rows record step-by-step funnel progression.** Every state-changing step
   in the public flow (gate shown/passed, each redirect type, telegram start, paybig
   redirect) writes one.
8. **`Conversion` rows store Paybig conversion data. Paybig is authoritative for signups.**
   FunnelCore attributes conversions to clicks/campaigns; it does not second-guess or
   recompute what Paybig reports.
9. **Historical attribution must not change because someone edits current configuration.**
   This is the reason for rules 5 and 6. Any change that could cause a past `Click`'s
   reported attribution to shift when unrelated config is edited later is a bug.
10. **All admin changes must be auditable.** Every create/update/archive/publish through the
    admin writes an `AuditLog` row (actor, entity, before/after). Use the shared mutation
    helper — don't hand-roll audit writes per action, and don't skip it for "small" changes.
11. **Secrets must never be exposed to the frontend.** Telegram bot tokens and third-party
    API credentials are decrypted only server-side, only at the point of use. No Server
    Action, API response, or Server Component prop passed to client code may include a
    plaintext or ciphertext secret field.
12. **Telegram credentials and API credentials must be encrypted at rest.** Stored only as
    ciphertext columns (see `lib/crypto`); there is no plaintext secret column in the schema.

## Process rules

- **Follow the phased plan.** [IMPLEMENTATION_PLAN.md](docs/funnelcore/IMPLEMENTATION_PLAN.md)
  defines what's currently authorized. Don't implement a later phase's work just because it
  seems like a natural next step — confirm with the user first if a request seems to span
  phases.
- **Config entities are archived, not hard-deleted** (`Brand`, `Platform`, `SocialAccount`,
  `Domain`, `Campaign`, `TrackingLink`, `TelegramBot`, `ApiConnection`, `Experiment`), so
  historical `Click`/`Conversion` rows never lose their referenced context.
- **Schema changes require a matching doc update.** If `prisma/schema.prisma` changes,
  update [DATA_MODEL.md](docs/funnelcore/DATA_MODEL.md) in the same change.
- **Architecturally significant choices get a DECISIONS.md entry**, not just a commit
  message. Append-only; don't rewrite past entries.
- **Test per** [TEST_PLAN.md](docs/funnelcore/TEST_PLAN.md). The public route and the
  conversion attribution join are the highest-risk surfaces and need the most coverage.
- **For any UI change**, start the dev server and exercise the golden path plus at least one
  edge case in a real browser before reporting the task complete. Don't claim a UI feature
  works based on type-checking or unit tests alone.
- **No secrets in git.** Never commit real API keys, Telegram tokens, passwords, or
  connection strings. `.env.example` documents required variables with placeholder values
  only; real values go in a local, git-ignored `.env`.

## General engineering standards (this repo)

- TypeScript strict mode; no `any` used to route around a type error — fix the type.
- Prefer Server Components and Server Actions over client-side data fetching for admin CRUD.
- Keep the public `/l/[token]` route's hot path free of unnecessary work — it's the one
  route real end users hit directly from ads/social links.
- Don't add abstractions, config layers, or feature flags beyond what the current phase
  needs. Three similar path-type handlers are fine; a generic handler-registry system is not,
  unless a fourth path type is actually being added.
- Comments explain non-obvious *why* (a constraint, an invariant, a workaround), never *what*
  — identifiers and types should make the "what" obvious on their own.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
