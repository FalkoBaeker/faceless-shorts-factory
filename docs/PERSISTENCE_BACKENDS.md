# Persistence Backends

`PERSISTENCE_BACKEND` supports:
- `memory` (default): current in-memory simulation path.
- `postgres`: adapter-backed path currently in **stub-memory mode** (no external pg driver installed).

## What changed in Step 2 / Commit B
- Project/Job stores route to postgres repos when backend is `postgres`.
- Billing/Publish services route to postgres repos when backend is `postgres`.
- Admin snapshot continues to work through store/service APIs and is backend-agnostic.

## Verification gates
- `PERSISTENCE_BACKEND=memory npm run sim:report` must stay green.
- `PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-postgres-project-job.ts` must return `ok: true`.

## Note
This is an incremental migration stage. Real SQL execution will be added in a follow-up once driver/runtime policy is approved.
