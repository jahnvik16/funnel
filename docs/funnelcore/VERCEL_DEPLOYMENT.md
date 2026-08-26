# FunnelCore — Vercel Deployment Guide

Exact configuration for deploying FunnelCore to Vercel. This is the Vercel-specific companion
to [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), which stays platform-agnostic — read
that document for the security/monitoring/backup/rollback checklists, and this one for what to
actually click and set in Vercel. See DECISIONS.md D055 for why this configuration looks the
way it does.

No application code, business logic, or architecture changed to produce this configuration —
only build/connection configuration (`vercel.json`, `prisma/schema.prisma`'s `directUrl`,
`package.json` scripts, `.env.example`).

## 1. Why Vercel needs different configuration than local dev

FunnelCore's public funnel routes and admin Server Actions run as short-lived serverless
functions on Vercel, not as one long-running Node process like `next dev`/`next start` locally.
Two consequences drove every change in this milestone:

1. **Connection pooling.** Each serverless invocation can open its own database connection.
   Under real traffic this can exhaust Postgres's connection limit fast — something a single
   local dev process never hits. The fix is a **pooled** connection string for the running app.
2. **Migrations need a direct connection.** `prisma migrate deploy` uses session-level Postgres
   features that most poolers (particularly transaction-mode PgBouncer) don't support, so it
   needs to run against a **direct**, unpooled connection — a different URL than the one the
   app uses at runtime.

Prisma's `directUrl` datasource field (prisma/schema.prisma) is the mechanism for this split:
the generated Prisma Client (used by the running app) only ever reads `DATABASE_URL`;
`directUrl`/`DIRECT_DATABASE_URL` is read only by the Prisma CLI, never by the app itself.

## 2. Database provider

Any managed Postgres 16+ provider that exposes **both** a pooled and a direct/unpooled
connection string works. Two common choices:

- **Neon** (also what Vercel's own "Vercel Postgres" integration is backed by): the dashboard
  gives you a pooled connection string (`-pooler` in the hostname) and a direct one.
- **Supabase**: the connection-string page gives you a "Transaction" (pooled, port 6543) and a
  "Session"/"Direct" (port 5432) connection string.

Map them like this:

| FunnelCore variable | Which connection string |
|---|---|
| `DATABASE_URL` | the **pooled** one |
| `DIRECT_DATABASE_URL` | the **direct/unpooled** one |

## 3. `vercel.json`

This repository's `vercel.json` overrides Vercel's default Build Command so migrations run
before the Next.js production build, per Vercel's documented `buildCommand` override
(Project Configuration → `vercel.json`):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run prisma:migrate:deploy && npm run build"
}
```

- `npm run prisma:migrate:deploy` runs `prisma migrate deploy` against `DIRECT_DATABASE_URL`
  (via `directUrl` in the schema) — applies any pending migrations, then exits. It never seeds
  data and never touches `DATABASE_URL`/the pooled connection.
- `npm run build` runs the normal `next build` — unchanged from local/CI builds.
- If migrations fail, the build fails, and Vercel does not promote the new deployment — the
  previous deployment keeps serving traffic. This is Vercel's normal build-failure behavior. It
  also means a broken migration cannot partially apply and then get orphaned mid-deploy; Prisma
  applies each migration inside its own transaction and stops at the first failure.

`npm run postinstall` (`prisma generate`) runs automatically after Vercel's install step, before
the build command above — this is npm's standard lifecycle hook, not Vercel-specific
configuration, so it needs no entry in `vercel.json`.

## 4. Environment variables to set in the Vercel dashboard

Project → Settings → Environment Variables, all scoped to **Production** (and Preview, if you
want preview deployments to hit a real — ideally separate — database):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooled connection string from your provider |
| `DIRECT_DATABASE_URL` | the direct/unpooled connection string from your provider |
| `ENCRYPTION_KEY` | a freshly generated key (`openssl rand -base64 32`) — never the local dev value |
| `APP_BASE_URL` | your real production URL, e.g. `https://yourdomain.com` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | only needed transiently, to run the seed manually once (see §6) — not required by the running app or the build |

Full descriptions of each variable are in [.env.example](../../.env.example), which is the
canonical reference kept in sync with what the code actually reads.

None of these are hardcoded anywhere in the codebase, and none should ever be committed —
`.gitignore` already excludes every `.env*` file except `.env.example`.

## 5. Node.js version

Next.js 16 requires Node.js ≥ 20.9. `package.json` now declares `"engines": { "node":
">=20.9.0" }`, which Vercel reads to select a compatible runtime. Confirm the Project Settings →
Node.js Version dropdown is set to a version satisfying that range (20.x or later) if your
project predates this and has an older version pinned there — the `engines` field alone does
not override an explicit dashboard setting.

## 6. First deploy — step by step

1. Import the GitHub repository into a new Vercel project (Framework Preset: Next.js —
   auto-detected).
2. Provision your Postgres database (§2) and grab both connection strings.
3. Set all environment variables from §4 in Vercel's dashboard, for the Production environment.
4. Deploy. Vercel runs `npm install` (triggering `postinstall` → `prisma generate`), then
   `vercel.json`'s `buildCommand` (`prisma migrate deploy` against `DIRECT_DATABASE_URL`, then
   `next build`).
5. Once the deployment is live, run the seed **manually, from your own machine**, pointed at the
   production database — do not add this to any automated build/deploy step (see
   PRODUCTION_READINESS.md §2 item 6 for why):
   ```bash
   DATABASE_URL="<production DATABASE_URL>" SEED_ADMIN_EMAIL="..." SEED_ADMIN_PASSWORD="..." npm run prisma:seed
   ```
6. Log in at `https://yourdomain.com/admin/login` with the seeded credentials, then change the
   password.
7. Add a `Domain` row in `/admin/domains` matching your real production hostname — tracking
   links resolve against this table, not against Vercel's own domain configuration.
8. If using Telegram, run each bot's **Validate** action from the admin UI once `APP_BASE_URL`
   is live and correct, to register the real webhook.
9. Run through PRODUCTION_READINESS.md §8's smoke tests before directing real traffic at any
   tracking link.

## 7. Subsequent deploys

Every push to the deployed branch re-runs the same `buildCommand` — `prisma migrate deploy`
only applies migrations that haven't already run (it's idempotent against an up-to-date
database), so routine deploys with no new migration are a safe no-op at that step. A deploy that
does include a new migration applies it automatically as part of the build, before the new code
that depends on it goes live.

## 8. What's still manual / not automated by this configuration

- **Seeding the first admin account** is deliberately a manual, one-time step — never wired
  into `vercel.json` or any automated hook. See §6 step 5.
- **Choosing and provisioning the database provider itself** — this configuration assumes one
  exists and exposes both a pooled and direct URL; it doesn't provision one.
- **DNS / custom domain setup** in Vercel's own dashboard, separate from adding the matching
  `Domain` row inside the app (§6 step 7) — both are required, for different reasons.
- **The Node.js Version dropdown** in Project Settings, if the project was created before
  `engines.node` was added — see §5.
- **Telegram webhook registration** — automatic once `APP_BASE_URL` is correct and an admin runs
  **Validate**, but that action itself is manual, per bot.
