# FunnelCore — Notes for AI Coding Agents

This file supplements the root `CLAUDE.md`. Read `CLAUDE.md` first — it has the binding
rules. This file is about how to navigate this specific repo's documentation and where to
look before writing code.

## Read this before touching code

1. Root `CLAUDE.md` — permanent engineering rules. Non-negotiable.
2. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — what FunnelCore is and V1 scope. Read this to know
   whether a feature you're about to build is even in scope.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — module boundaries and the config-driven execution
   model. Read this before adding a new module or route.
4. [DATA_MODEL.md](DATA_MODEL.md) — authoritative prose description of the schema. Cross-
   check against `prisma/schema.prisma` (the DB source of truth) before assuming a field
   exists.
5. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — current phase and what's authorized
   next. **Do not implement a later phase's work because it seems like a natural extension.**
   If asked to do something that spans phases, flag it rather than silently expanding scope.
6. [DECISIONS.md](DECISIONS.md) — why things are the way they are. Check here before
   "fixing" something that looks like an inconsistency; it may be a deliberate tradeoff.
7. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — known unknowns. If your task touches one of
   these, surface the open question to the user instead of guessing an answer and coding
   against it.
8. [TEST_PLAN.md](TEST_PLAN.md) — what needs test coverage and at what layer.

## Hard constraints specific to this codebase

- **Never hardcode a brand, platform, campaign, social account, or domain name/id** anywhere
  in application code, including "just for now" placeholders, seed data used in non-test
  contexts, or example values in comments that could be copy-pasted into real logic.
- **Never add a 4th path type without being explicitly asked.** `PathType` is
  `DIRECT | AGGREGATOR | TELEGRAM`. If a task seems to need a new path type, stop and ask —
  this is an architecture decision, not a routine change.
- **Never build generic/pluggable workflow abstractions** (step graphs, node editors, rule
  engines) even if it would make some future request easier. Re-read PRODUCT_SPEC.md §5 if
  tempted.
- **Never mutate a `TrackingLinkVersion` after creation.** If you find yourself writing an
  `UPDATE` against that table (outside of a brand-new-row `INSERT`-then-immediately-fix-typo
  scenario within the same publish transaction), stop — you're about to break historical
  attribution.
- **Never return `botTokenCiphertext` or `credentialsCiphertext` (or their decrypted values)
  from a Server Action, API route, or Server Component prop that reaches client code.**
  Select an explicit field allow-list; don't rely on excluding fields being remembered.
- **Every admin mutation (create/update/archive/publish) must produce an `AuditLog` row.**
  Use the shared mutation helper rather than writing `AuditLog` inserts ad hoc per action.
- **Config entities are archived, not hard-deleted**, to preserve referential integrity for
  historical `Click`/`Conversion` rows.

## When the brief and the docs disagree

If a new instruction from the user conflicts with something written in these docs (e.g. asks
you to hardcode a brand for expediency, or to skip audit logging for one endpoint), say so
explicitly and ask for confirmation rather than silently complying or silently refusing. The
docs encode decisions made deliberately; a one-off request may be a legitimate exception, but
it should be a conscious one, not a silent scope-creep.

## Keeping docs in sync

If you change the schema, update [DATA_MODEL.md](DATA_MODEL.md) in the same change. If you
make an architecturally significant choice, add an entry to [DECISIONS.md](DECISIONS.md)
rather than leaving the reasoning only in a commit message or PR description.
