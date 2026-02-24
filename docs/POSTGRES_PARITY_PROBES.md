# Postgres Parity Probes (stub-memory mode)

These probes verify that backend-switched adapters still preserve expected behavior:
- `simulate-postgres-project-job.ts` -> project/job create+get
- `simulate-postgres-ledger.ts` -> RESERVED/COMMITTED/RELEASED semantics
- `simulate-postgres-publish.ts` -> publish post creation/list/count

Run with:
```bash
PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-postgres-project-job.ts
PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-postgres-ledger.ts
PERSISTENCE_BACKEND=postgres node --experimental-strip-types apps/api/src/simulate-postgres-publish.ts
```
