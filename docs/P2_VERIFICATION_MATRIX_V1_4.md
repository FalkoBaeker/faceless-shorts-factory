# v1.4 P2 Verification Checklist / Command Matrix

Order locked to implementation plan: **T31 → T32 → T30 → T27 → T28 → T29 → T33**.

Stand: 2026-02-28

## 0) Fast baseline gates (run before/after each ticket)

| Area | Fastest reliable command | Pass signature | Fail signature |
|---|---|---|---|
| API lint (current placeholder) | `npm --prefix apps/api run lint` | exit 0 + `TODO: lint api` | non-zero exit |
| API build (current placeholder) | `npm --prefix apps/api run build` | exit 0 + `TODO: build api` | non-zero exit |
| API smoke (real useful) | `npm run sim:startframe-gate` | JSON contains `"check":"STARTFRAME_SELECTION_GATE"` + `"ok": true` | non-zero OR `EXPECTED_STARTFRAME_SELECTION_REQUIRED` / `CANDIDATES_TOO_SHORT` / `SELECTED_STARTFRAME_*` |
| Web lint | `npm --prefix apps/web run lint` | exit 0 | non-zero + Next/ESLint error output |
| Web build | `npm --prefix apps/web run build` | exit 0 + Next build summary | non-zero + compile/type/lint errors |
| Web smoke | `bash scripts/web_smoke_check.sh` | `WEB_SMOKE_OK` | grep/file check exit non-zero |

> Note: API lint/build are currently stubs; treat **API smoke sims** as enforcement until real lint/build is added.

---

## 1) Ticket-specific matrix (P2 order)

## T31 — Startframe precedence + clarity

### Commands
1. `npm run sim:startframe-gate`
2. `grep -n "setSelectedStartFrameCandidateId('')" apps/web/app/components/review-live-actions.tsx`
3. `grep -n "setUploadedStartFrame(null)" apps/web/app/components/review-live-actions.tsx`
4. `grep -n "Startframe fehlt\|Startframe gewählt" apps/web/app/components/review-live-actions.tsx`

### Expected pass
- Sim returns `"ok": true` and `gateError: STARTFRAME_SELECTION_REQUIRED`.
- Timeline includes selected startframe event (`SELECTED_STARTFRAME_*` checks pass).
- UI has explicit mutual exclusion code paths (upload clears candidate, candidate selection clears upload).
- UI exposes explicit state chip (`Startframe fehlt` / `Startframe gewählt`).

### Expected fail
- Missing required selection not rejected.
- Candidate count < 3.
- No `SELECTED_STARTFRAME` timeline signal.
- UI ambiguity (both sources active or no visible active-state cue).

---

## T32 — Human-first-frame policy preflight

### Commands (implementation verification)
1. `grep -RIn "STARTFRAME_POLICY\|FIRST_FRAME_POLICY\|POLICY_PREFLIGHT" apps/api/src apps/web/app`
2. `grep -RIn "preflight" apps/api/src/handlers.ts apps/api/src/services apps/api/src/providers`
3. Re-run: `npm run sim:startframe-gate` (must still pass as regression guard)

### Expected pass
- Dedicated policy-preflight error/event codes exist in API path.
- User-facing remediation text exists in web flow.
- Existing startframe-gate sim still passes (no regression).

### Expected fail
- No policy preflight markers in API/web code.
- Only generic failure surfaced (no actionable reason/remediation).
- T31 regression (gate sim fails).

---

## T30 — Hook engine (first-second impact)

### Commands
1. `node --experimental-strip-types --input-type=module -e "import { validateCreativeConsistency } from './apps/api/src/services/creative-consistency.ts'; const flat=validateCreativeConsistency({script:'Unser Service ist gut und solide.',conceptId:'concept_web_vertical_slice',moodPreset:'commercial_cta',startFrameStyle:'storefront_hero',creativeIntent:{effectGoals:[{id:'sell_conversion',weight:1}],narrativeFormats:[{id:'commercial',weight:1}],energyMode:'high'}}); const hook=validateCreativeConsistency({script:'Achtung: Nur heute sichern! Jetzt testen.',conceptId:'concept_web_vertical_slice',moodPreset:'commercial_cta',startFrameStyle:'storefront_hero',creativeIntent:{effectGoals:[{id:'sell_conversion',weight:1}],narrativeFormats:[{id:'commercial',weight:1}],energyMode:'high'}}); console.log(JSON.stringify({flatOk:flat.ok,flatReasons:flat.reasons,hookOk:hook.ok,hookReasons:hook.reasons},null,2));"`
2. `grep -RIn "HOOK_FIRST_SECOND_QUALITY\|HOOK_ENHANCER_APPLIED" apps/api/src`

### Expected pass
- Flat script fails hook check (`HOOK_FIRST_SECOND_QUALITY` in reasons).
- Hooked first sentence passes that gate.
- Hook events/rules are emitted or logged in runtime path.

### Expected fail
- Flat script passes unexpectedly under high-energy intent.
- Hook rule markers absent.

---

## T27 — Audio strategy modes (VO / Scene / Hybrid)

### Commands (post-implementation)
1. `grep -RIn "voiceover\|scene_audio\|hybrid" apps/api/src/contracts.ts apps/web/app/lib/api-client.ts apps/web/app/components`
2. `grep -RIn "audioMode\|audio_strategy\|duck" apps/api/src/orchestration apps/api/src/providers`
3. `npm run sim:startframe-gate` (regression guard)

### Expected pass
- API + web contract expose 3 explicit modes.
- Runtime/orchestration branches by mode (including hybrid ducking path).
- No regression on existing flow.

### Expected fail
- Mode exists only in UI or only in API (contract mismatch).
- Runtime ignores selected mode.

---

## T28 — Dialog-capable script schema

### Commands (post-implementation)
1. `grep -RIn "speaker\|line\|dialogTurn\|dialogue" apps/api/src/contracts.ts apps/web/app/lib/api-client.ts`
2. `grep -RIn "dialog" apps/api/src/services apps/api/src/providers/live-provider-runtime.ts`
3. `npm run sim:startframe-gate` (regression guard)

### Expected pass
- Schema includes explicit dialog structure (not only `dialogueHint`).
- Runtime consumes dialog structure in generation/caption path.

### Expected fail
- Only free-text hints remain; no typed dialog schema.
- Dialog data dropped before provider stage.

---

## T29 — Caption engine v2

### Commands
1. `npm run sim:final-sync`
2. `grep -RIn "CAPTION_SAFE_AREA_APPLIED\|caption" apps/api/src/providers/live-provider-runtime.ts apps/api/src/orchestration/queue-runtime.ts`
3. (optional deep smoke) `node --experimental-strip-types apps/api/src/simulate-live-provider-e2e.ts`

### Expected pass
- `sim:final-sync` outputs batch metrics with high tolerance/sentence-preservation rates.
- Caption pipeline markers remain present (safe-area + caption handling).
- Optional e2e reaches `READY` and includes caption/sync timeline signals.

### Expected fail
- Sync metrics below threshold or script errors.
- Missing caption timeline markers.

---

## T33 — Image model transparency + upgrade path

### Commands (post-implementation)
1. `grep -RIn "image_model_fallback\|startframe.*model\|modelUsed\|imageModel" apps/api/src apps/web/app`
2. `npm run sim:startframe-gate`
3. `grep -RIn "explainability\|diagnostics" apps/api/src/handlers.ts apps/web/app/components/job-runtime-panel.tsx`

### Expected pass
- Diagnostics expose startframe image model used (and fallback if triggered).
- Evidence visible in API response/timeline and UI diagnostics panel.
- Startframe selection flow still passes.

### Expected fail
- Model data only in server logs (not user diagnostics).
- No fallback traceability.

---

## 2) Minimal per-ticket execution loop

For each ticket in order:
1. Run baseline gates (API smoke + web lint/build/smoke at least once per ticket batch).
2. Run ticket-specific commands above.
3. Record: command, timestamp, pass/fail signature, commit hash.
4. Do not continue to next ticket with unresolved regressions.

If you want, this can be converted into a copy-paste `scripts/verify_p2.sh` runner with `set -euo pipefail` and signature checks.