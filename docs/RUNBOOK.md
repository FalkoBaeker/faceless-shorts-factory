# Runbook (Local Vertical Slice)

## API flow simulation
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate.ts
```

Expected:
- Project created
- Concept selected with `RESERVED`
- Job reaches `READY`
- Timeline length > 1

## Worker orchestration simulation
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types workers/pipeline/src/simulate-orchestration.ts
```

Expected for `MASTER_30`:
- `targetSeconds=30`
- `trimToSeconds=30`
- `taskCount=3` with segments `12,12,8`
- deterministic segment keys
