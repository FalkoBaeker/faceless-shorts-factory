# Vertical Slice (Current Skeleton)

## Runtime flow in code
1. `createProjectHandler` creates in-memory project (`DRAFT`)
2. `selectConceptHandler` sets project `SELECTED`, starts job, reserves credit semantic response
3. `generateHandler` simulates async progression until `READY`
4. Worker `buildOrchestrationPlan` creates deterministic segment tasks with idempotency keys

## Included rules
- Segment policy: `SHORT_15 => 8+8 trim 15`, `MASTER_30 => 12+12+8 trim 30`
- Deterministic segment key: hash(project, variant, idx, model, seconds, size, prompt, input hash)
- State transitions protected by `allowedTransitions` + `isTransitionAllowed`

## Next implementation slice
- Move stores from in-memory maps to Postgres
- Wire BullMQ producers/consumers with retry/backoff
- Add Stripe ledger persistence (`RESERVED/COMMITTED/RELEASED`)
