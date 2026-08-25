# FunnelCore

Configurable funnel and attribution system. Answers: **which brand/platform/path produced
actual paid signups?**

This repository is currently at the **foundation** milestone — scaffold, architecture, and
documentation only. See [docs/funnelcore/IMPLEMENTATION_PLAN.md](docs/funnelcore/IMPLEMENTATION_PLAN.md)
for what's built and what's next.

**Read [CLAUDE.md](CLAUDE.md) before making any changes to this repository.**

## Documentation

- [Product Spec](docs/funnelcore/PRODUCT_SPEC.md)
- [Architecture](docs/funnelcore/ARCHITECTURE.md)
- [Data Model](docs/funnelcore/DATA_MODEL.md)
- [Implementation Plan](docs/funnelcore/IMPLEMENTATION_PLAN.md)
- [Test Plan](docs/funnelcore/TEST_PLAN.md)
- [Decisions Log](docs/funnelcore/DECISIONS.md)
- [Open Questions](docs/funnelcore/OPEN_QUESTIONS.md)
- [Notes for AI Coding Agents](docs/funnelcore/AGENTS.md)

## Stack

Next.js (App Router) + TypeScript, PostgreSQL + Prisma, Tailwind CSS, shadcn/ui conventions.

## Running locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template and fill in local values:
   ```bash
   cp .env.example .env
   ```
3. Start local Postgres:
   ```bash
   docker compose up -d
   ```
4. Apply the schema:
   ```bash
   npm run prisma:migrate
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```
6. Visit [http://localhost:3000](http://localhost:3000), and confirm
   [http://localhost:3000/api/health](http://localhost:3000/api/health) reports
   `{"status":"ok","database":"connected"}`.
