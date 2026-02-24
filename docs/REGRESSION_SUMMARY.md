# Regression Summary

Generated from `/Users/falkobaeker/.openclaw/workspace/outputs/sim_*.json`.

Overall: **PASS**

## Key checks
- API final status: `READY` (timeline `6`)
- Orchestration segments: `[12, 12, 8]` (tasks `3`)
- HTTP success: `READY` / ledger `['RESERVED', 'COMMITTED']`
- HTTP failure: `FAILED` / ledger `['RESERVED', 'RELEASED']`
- Publish status: `PUBLISHED` / job `PUBLISHED`
- Web flow: steps `8` / variant `MASTER_30`

## Assertions
- api_ready: PASS
- orch_master30_segments: PASS
- http_ready: PASS
- billing_commit_seen: PASS
- failure_released: PASS
- publish_done: PASS
- web_model_ok: PASS
