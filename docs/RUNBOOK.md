# Runbook — Release-Readiness MVP (Auth + Export-First)

## Scope (current MVP)
- **In scope:** Supabase Auth (email), entitlement gating, generation pipeline to `READY`, export/assets via signed URLs, alerts (email via Gmail API/gog with logs fallback).
- **Out of scope for MVP:** live Stripe billing, live auto-publish to TikTok/Instagram/YouTube.

## 0) Preconditions
1. `docker` running (`openclaw-pg`, `openclaw-redis` healthy)
2. `.env` and `.env.providers` present (local only, never commit)
   - API loader resolves env files from current dir **or parent dirs** (helps when start command runs from subfolders)
3. `AUTH_REQUIRED=true` for real auth test
4. `ENABLE_AUTO_PUBLISH=false` for MVP mode
5. `ENABLE_FREE_PLAN_MVP=true` (default) so free customer can run end-to-end flow
6. `ENABLE_PREMIUM_60=false` by default (set `true` only when testing 60s premium path)
7. `NEXT_PUBLIC_ENABLE_PREMIUM_60=true` in web env only if you want the 60s option visible in UI

## 1) Local start

### API
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/main.ts
```

### Web
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npm run dev
```

Open:
- `http://localhost:3000/` (Auth + Wizard)
- `http://localhost:3000/review` (Live flow trigger)
- `http://localhost:3000/job-status` (runtime polling + export)

## 2) Auth smoke (Supabase)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
npm run sim:auth
```

Expected:
- signup endpoint reachable
- auth/me reachable with token (if email confirmation not required)
- entitlement response returned (allow/reason)

## 3) Free-customer E2E smoke (signup/verify/login → READY → download)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
npm run sim:free-customer
```

Expected:
- default smoke (`FREE_FLOW_PUBLIC_SIGNUP=false`) uses admin-created confirmed test user (bounce-safe)
- optional public signup check with `FREE_FLOW_PUBLIC_SIGNUP=true` (single run, valid inbox only)
- login works with confirmed user
- authenticated free user can run job (`reason=FREE_PLAN_MVP_ALLOWED`)
- script acceptance gate is satisfied before select/generate (`SCRIPT_ACCEPTANCE_REQUIRED` when missing)
- pipeline reaches `READY`
- `/v1/jobs/:jobId/assets` includes `final_video`
- signed URL probe returns HTTP 200

## 4) Script draft API smoke
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types --input-type=module -e "process.env.AUTH_REQUIRED='false'; const { startApiServer } = await import('./apps/api/src/server.ts'); const { server, port } = await startApiServer(0); const res = await fetch('http://127.0.0.1:'+port+'/v1/script/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic:'Rohr verstopft',variantType:'SHORT_15',moodPreset:'problem_solution'})}); console.log(await res.text()); server.close();"
```

Expected:
- status 200
- response includes `script`, `targetSeconds`, `estimatedSeconds`, `withinTarget`

## 5) Pipeline smoke (real provider runtime)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/simulate-live-provider-e2e.ts
```

Expected:
- final status `READY`
- asset timeline events exist (`ASSET_*`, `SCRIPT_DURATION_VALIDATED`, `SELECTED_MOOD`)
- signed URL probes return HTTP 200

## 6) Alert smoke
Set:
- `ALERT_TARGET=email`
- `ALERT_EMAIL_SEVERITIES=critical,warn`
- `ALERT_TEST_ALLOWED=true`

Then call:
```bash
curl -sS -X POST http://localhost:3001/v1/admin/alerts/test \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Expected:
- `ok=true`
- `target=email` when gog/Gmail available
- fallback `target=logs` when connector unavailable (no crash)

## 7) Render checks
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
npm run render:preflight
npm run render:plan
```

Expected:
- owner `faceless` detected
- missing services clearly listed (api/web/postgres/redis)
- env vars required per service listed in plan output

## 8) Incident quick actions
- **Auth errors (`AUTH_PROVIDER_401/403`)**
  - verify `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - verify Supabase Auth URL config (`SITE_URL`, `REDIRECT_URLS`)
- **Entitlement blocks (`NOT_ENTITLED:*`)**
  - check `ADMIN_ALLOWLIST`
  - check `app_users.plan/subscription_status`
- **Alerts not sent**
  - run `gog auth status --json`
  - verify `ALERT_TARGET`, `ALERT_EMAIL_SEVERITIES`, `ALERT_EMAIL_TO`
  - confirm fallback logs are emitted (`alert_email_failed_fallback_logs`)
- **Queue stalls**
  - verify Redis health
  - inspect `logs/app.log`
  - inspect DLQ: `GET /v1/dlq`

## 9) Security hygiene reminders
- never paste API keys in chat/logs
- `.env` / `.env.providers` stay local
- keep `AUTH_REQUIRED=true` outside local dev
- do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser/client
