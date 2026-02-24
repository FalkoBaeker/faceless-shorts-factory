# Admin + Publish Demo

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate-admin-publish.ts
```

Expected highlights:
- `publishedStatus = PUBLISHED`
- `publishTargets = ["tiktok","youtube"]`
- `jobStatus = PUBLISHED`
- `adminTotals.jobsPublished >= 1`
- `adminTotals.ledgerEntries >= 2`
