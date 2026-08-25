-- Guards against a genuine concurrency race: two truly-simultaneous requests
-- for the same click (e.g. Telegram redelivering a webhook update while the
-- first delivery is still being processed) can both pass an application-level
-- "does this event already exist?" check before either has committed its
-- write, producing two rows for a step that must only ever happen once per
-- click. A partial unique index makes the database itself the source of
-- truth for these specific step types; lib/public-routing.ts's
-- writeFunnelEvent() treats the resulting unique-constraint violation as
-- "already recorded," not an error. Not expressible via Prisma's schema DSL
-- (no partial-index support), so this is a hand-authored migration — see
-- DECISIONS.md.
--
-- ROUTE_RESOLVED, AGE_GATE_SHOWN, and AGGREGATOR_VIEWED are deliberately
-- excluded: those represent genuine repeat views, not a completed one-time
-- state transition (see DECISIONS.md D020).
CREATE UNIQUE INDEX "funnel_events_singleton_step_unique" ON "funnel_events" ("clickId", "stepType")
WHERE "stepType" IN ('AGE_GATE_ACCEPTED', 'AGE_GATE_DECLINED', 'TELEGRAM_STARTED', 'OUTBOUND_PAYBIG_REDIRECTED');
