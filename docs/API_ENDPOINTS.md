# API Endpoints (MVP Release-Readiness)

## Health
- `GET /health` — runtime health + auth mode

## Auth (Supabase)
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `GET /v1/auth/me`

## Project & Generation
- `POST /v1/projects` — create project
- `POST /v1/projects/:projectId/select` — reserve credit + create job
- `POST /v1/projects/:projectId/generate` — enqueue generation pipeline
- `GET /v1/jobs/:jobId` — status timeline
- `GET /v1/jobs/:jobId/assets` — signed asset URLs/events for export

## Billing/Entitlement support
- `GET /v1/ledger/:organizationId`

## Admin
- `GET /v1/admin/snapshot`
- `POST /v1/admin/alerts/test`

## Queue / Recovery
- `GET /v1/dlq`
- `POST /v1/dlq/:deadLetterId/replay`

## Publish (deferred in current MVP)
- Endpoint exists for future compatibility:
  - `POST /v1/jobs/:jobId/publish`
- In current MVP with `ENABLE_AUTO_PUBLISH=false` returns entitlement block (`FEATURE_DISABLED_MVP`).

---

## Example: `POST /v1/auth/login`
```json
{
  "email": "you@example.com",
  "password": "YourStrongPassword123"
}
```

## Example: `GET /v1/auth/me` (response)
```json
{
  "authenticated": true,
  "authRequired": true,
  "canRunJob": true,
  "reason": "ALLOWLIST",
  "user": {
    "id": "user-id",
    "email": "you@example.com",
    "plan": "beta",
    "subscriptionStatus": "inactive",
    "allowlisted": true,
    "creditsRemaining": null,
    "monthlyJobLimit": null,
    "jobsUsed": 2
  }
}
```

## Example: `GET /v1/jobs/:jobId/assets` (response)
```json
{
  "jobId": "job_123",
  "ready": true,
  "assets": [
    {
      "event": "ASSET_FINAL_VIDEO_STORED",
      "kind": "final_video",
      "objectPath": "jobs/job_123/output/final.mp4",
      "signedUrl": "https://...",
      "bytes": 1234567,
      "mimeType": "video/mp4",
      "provider": "openai"
    }
  ]
}
```
