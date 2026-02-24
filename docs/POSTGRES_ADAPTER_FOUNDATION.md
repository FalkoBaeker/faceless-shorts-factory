# Postgres Adapter Foundation (Step 1 / Commit A)

This step introduces a practical Postgres adapter foundation without adding external packages.

## Added
- `apps/api/src/persistence/postgres-client.ts`
  - exposes `getPgClient()` metadata (`mode=stub-memory`) and current environment capability.
- `apps/api/src/persistence/postgres-project-repo.ts`
  - minimal project repo (`create/getById/list/setStatus`).
- `apps/api/src/persistence/postgres-job-repo.ts`
  - minimal job repo (`save/getById/list/appendEvent`).

## Important
- There is no real `pg` driver wired in this environment yet.
- Adapter state is in-process, intentionally, to keep migration incremental and testable.
- Existing memory backend remains default and authoritative for current simulations.
