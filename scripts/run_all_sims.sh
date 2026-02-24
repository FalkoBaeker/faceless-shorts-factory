#!/usr/bin/env bash
set -euo pipefail

OUT_BASE="/Users/falkobaeker/.openclaw/workspace/outputs"

node --experimental-strip-types apps/api/src/simulate.ts > "$OUT_BASE/sim_api_flow.json"
node --experimental-strip-types workers/pipeline/src/simulate-orchestration.ts > "$OUT_BASE/sim_orchestration.json"
node --experimental-strip-types apps/api/src/simulate-http.ts > "$OUT_BASE/sim_http_flow.json"
node --experimental-strip-types apps/api/src/simulate-http-failure.ts > "$OUT_BASE/sim_http_failure_flow.json"
node --experimental-strip-types apps/api/src/simulate-admin-publish.ts > "$OUT_BASE/sim_admin_publish.json"
node --experimental-strip-types apps/web/src/simulate-web-flow.ts > "$OUT_BASE/sim_web_flow.json"

echo "ALL_SIMS_OK"
