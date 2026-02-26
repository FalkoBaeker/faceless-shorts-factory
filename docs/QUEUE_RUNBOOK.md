# Queue + DLQ Runbook (Chunk 2)

## Runtime defaults
- Redis: `redis://127.0.0.1:6379`
- Postgres: `postgres://postgres:postgres@localhost:5432/openclaw_app`

## Persistent local infra
```bash
docker volume create openclaw_pg_data
docker volume create openclaw_redis_data

docker run --name openclaw-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=openclaw_app \
  -p 5432:5432 \
  -v openclaw_pg_data:/var/lib/postgresql/data \
  -d postgres:16

docker run --name openclaw-redis \
  -p 6379:6379 \
  -v openclaw_redis_data:/data \
  -d redis:7-alpine redis-server --appendonly yes
```

## Apply schema
```bash
docker exec -i openclaw-pg psql -U postgres -d openclaw_app < db/schema.sql
```

## Health checks
```bash
docker exec openclaw-pg pg_isready -U postgres -d openclaw_app
docker exec openclaw-redis redis-cli ping
```

## Dead-letter inspection
```bash
curl -s http://127.0.0.1:3001/v1/dlq | jq
```

## Replay failed item
```bash
curl -s -X POST http://127.0.0.1:3001/v1/dlq/<DLQ_ID>/replay | jq
```

## Failure semantics
- Final worker failure emits `FAILED_FINAL` (or status `FAILED` transition event)
- Credit is released exactly once if `RESERVED` exists and final state was not already written
- Failed payload is copied to DLQ queue for replay
