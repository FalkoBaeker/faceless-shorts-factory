# Approval Request: Postgres Driver Integration

## Scope
Enable real SQL execution for `PERSISTENCE_BACKEND=postgres` by introducing a database driver + connection management layer, while preserving current memory backend behavior.

## What is already done
- Schema foundation exists in `db/schema.sql`.
- SQL templates + row mappers exist.
- Backend switch and driver-decision guardrail exist.
- Postgres path currently runs in `stub-memory` mode (no external driver).

## Why approval is needed
Integrating a real driver introduces:
- new runtime dependency,
- real DB connectivity,
- credential handling and operational risk.

## Risks
1. Runtime regressions in API state transitions.
2. Migration mismatch between SQL templates and table schema.
3. Credential or connection misconfiguration.
4. Partial writes if transaction boundaries are unclear.

## Rollback plan
- Keep default backend as `memory`.
- If SQL mode fails, set `PERSISTENCE_BACKEND=memory` and continue with proven simulation path.
- Revert the driver integration commits.

## Exact command plan (post-approval)
1. Add driver package and lockfile update.
2. Implement concrete SQL executor.
3. Wire project/job repos to concrete executor.
4. Run memory gate + postgres probes + end-to-end route simulations.

## Approval point (explicit)
Please approve before any of the following:
- installing new DB driver dependency,
- connecting to a non-local database,
- storing production credentials.
