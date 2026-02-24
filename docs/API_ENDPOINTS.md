# API Endpoints (MVP Draft)

## Project & Ideation
- `POST /v1/projects` – create project
- `POST /v1/projects/:projectId/ideation` – generate concepts
- `POST /v1/projects/:projectId/select` – reserve credit + pick concept/variant

## Generation Pipeline
- `POST /v1/projects/:projectId/generate` – enqueue full async pipeline
- `GET /v1/jobs/:jobId` – status timeline + artifacts

## Publishing
- `POST /v1/jobs/:jobId/publish` – publish via social gateway

## Example: `POST /v1/projects`
```json
{
  "organizationId": "org_123",
  "topic": "Rohr verstopft",
  "language": "de",
  "voice": "de_female_01",
  "variantType": "SHORT_15"
}
```

## Example: `POST /v1/projects/:projectId/select`
```json
{
  "projectId": "proj_123",
  "conceptId": "concept_2",
  "variantType": "MASTER_30"
}
```
