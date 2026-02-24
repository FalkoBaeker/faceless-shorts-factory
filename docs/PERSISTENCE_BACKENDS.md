# Persistence Backends

`PERSISTENCE_BACKEND` supports:
- `memory` (default): existing in-memory behavior (used by simulations)
- `postgres`: explicit skeleton path (`POSTGRES_SKELETON_NOT_IMPLEMENTED:*`)

## Why this step
This gives a safe backend switch and repo-wiring touch points before wiring a real DB client.

## Verification
- `PERSISTENCE_BACKEND=memory npm run sim:report` must stay green.
- `PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-postgres-skeleton.ts` must return `ok: true` with a `POSTGRES_SKELETON_NOT_IMPLEMENTED:*` message.
