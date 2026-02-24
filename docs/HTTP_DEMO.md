# HTTP Demo (Vertical Slice)

## Success path (reserve -> commit)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate-http.ts
```

Expected highlights:
- `generatedStatus = READY`
- `timelineLength >= 6`
- `ledgerTypes` contains `RESERVED,COMMITTED`
- `ledgerBalance = -1`

## Failure path (reserve -> release)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate-http-failure.ts
```

Expected highlights:
- `generatedStatus = FAILED`
- `ledgerTypes` contains `RESERVED,RELEASED`
- `ledgerBalance = 0`
