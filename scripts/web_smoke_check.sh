#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory"

[ -f "$ROOT/apps/web/app/layout.tsx" ]
[ -f "$ROOT/apps/web/app/page.tsx" ]
[ -f "$ROOT/apps/web/app/review/page.tsx" ]

grep -q "Supabase Auth (MVP)" "$ROOT/apps/web/app/components/auth-panel.tsx"
grep -q "Review / Generate" "$ROOT/apps/web/app/review/page.tsx"
grep -q "Echten Video-Flow starten" "$ROOT/apps/web/app/components/review-live-actions.tsx"

echo "WEB_SMOKE_OK"
