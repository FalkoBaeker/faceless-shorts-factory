# Postgres Driver Plan

## Current state
- `PERSISTENCE_BACKEND=postgres` is available in **stub-memory mode**.
- No external pg driver is installed in this environment.

## Goal
Enable real SQL execution against `db/schema.sql` without breaking memory backend simulations.

## Approval-safe sequence
1. Keep `memory` backend as default and continuously green (`npm run sim:report`).
2. Introduce SQL query templates + row mappers (done/in progress).
3. Add driver integration behind explicit runtime gate (no silent switch).
4. Validate parity with postgres probes and preserve current API behavior.

## Approval point
Before any external driver install or production DB connection, request explicit approval.
