#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory"

[ -f "$ROOT/apps/web/app/layout.tsx" ]
[ -f "$ROOT/apps/web/app/page.tsx" ]
[ -f "$ROOT/apps/web/app/review/page.tsx" ]

grep -q "Wizard Start" "$ROOT/apps/web/app/page.tsx"
grep -q "Review Preview" "$ROOT/apps/web/app/review/page.tsx"

echo "WEB_SMOKE_OK"
