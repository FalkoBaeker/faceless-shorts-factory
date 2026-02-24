# Persistence Foundation

## Goal
Prepare migration from in-memory state to Postgres without breaking the current vertical-slice simulations.

## Added in Batch 1
- `db/schema.sql` with core entities:
  - organizations
  - projects
  - jobs
  - job_events
  - credit_ledger
  - publish_posts
- `packages/shared/src/repositories.ts` as canonical repository contracts.

## Migration Strategy
1. Keep `memory` backend as default for local fast iteration.
2. Introduce repository-backed store adapters.
3. Add `postgres` backend skeleton with explicit not-implemented errors.
4. Move handlers/services to backend-agnostic access path.

## Safety Rule
Any backend switch must keep `sim:report` green under `PERSISTENCE_BACKEND=memory`.
