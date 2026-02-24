# API Endpoints (MVP Draft)

- `POST /v1/projects` – create project
- `POST /v1/projects/:projectId/ideation` – generate concepts
- `POST /v1/projects/:projectId/select` – reserve credit + pick concept/variant
- `POST /v1/projects/:projectId/generate` – enqueue full async pipeline
- `GET /v1/jobs/:jobId` – status timeline + artifacts
- `POST /v1/jobs/:jobId/publish` – publish via social gateway
