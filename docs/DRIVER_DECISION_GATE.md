# Driver Decision Gate (Step 4 / Commit F)

## Purpose
Prevent accidental migration from `stub-memory` to real SQL without explicit approval.

## Rule
- If backend is `postgres` and no approved driver is available, decision stays `STAY_STUB` and `approvalRequired=true`.
- Real SQL mode (`ENABLE_SQL`) only after explicit approval + driver availability signal.

## Probe
```bash
PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-driver-decision.ts
```
