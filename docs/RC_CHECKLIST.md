# RC Checklist — MVP Release Candidate (Export-first)

## Product Scope Freeze
- [ ] Auto-publish remains disabled (`ENABLE_AUTO_PUBLISH=false`)
- [ ] Stripe remains optional/off (no hard runtime dependency)
- [ ] Definition of done aligned: Start → Review → Job `READY` → Export link

## Auth & Access
- [ ] Supabase email auth works (`/v1/auth/signup`, `/v1/auth/login`, `/v1/auth/me`)
- [ ] API routes guarded when `AUTH_REQUIRED=true`
- [ ] Entitlement policy enforced (`isEntitled`, `canRunJob`)
- [ ] Allowlist and plan behavior verified (`free` allowed for run-job in MVP via `ENABLE_FREE_PLAN_MVP=true` (default), publish still disabled unless explicitly enabled)

## Runtime
- [ ] Postgres and Redis healthy
- [ ] Generation pipeline reaches `READY` for sample jobs
- [ ] `/v1/jobs/:jobId/assets` returns signed export URL when ready
- [ ] DLQ endpoint reachable and replay path tested

## Monitoring / Alerts
- [ ] Alert routing config set (`critical,warn -> email`, `info -> logs`)
- [ ] Test alert sent successfully (`[faceless-shorts-factory] test alert`)
- [ ] Gmail connector failure path verified (logs fallback, no crash)

## Web UX
- [ ] Mobile auth + flow usable on iPhone width (375/390)
- [ ] Review page can trigger real API generation
- [ ] Job-status page polls real status + exposes export download when ready
- [ ] Empty/error/loading states visible and understandable

## Deploy (Render)
- [ ] `render:preflight` passes owner/auth checks
- [ ] `render:plan` reviewed, missing services known
- [ ] Render env vars set for API/Web
- [ ] Public base URLs configured (API + WEB), webhook base URL set

## Release Gate
- [ ] Smoke tests pass (web build/lint + auth sim + provider E2E)
- [ ] No secrets in git index (`git ls-files` check)
- [ ] Runbook and hygiene checklist reviewed by owner
- [ ] GO/NO-GO decision documented with risks
