# HTTP Demo (Vertical Slice)

Run the local API simulation over real HTTP routes:

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate-http.ts
```

Expected output highlights:
- `projectStatus = DRAFT`
- `reservation = RESERVED`
- `generatedStatus = READY`
- `fetchedStatus = READY`
- `timelineLength >= 6`
