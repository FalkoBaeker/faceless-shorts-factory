# Faceless Shorts Factory

B2B SaaS zur Erstellung von faceless Kurzvideos (15s/30s) mit async Pipeline:
- Ideation (LLM)
- Storyboard (Image Gen)
- Segment-Video-Generierung (Sora-kompatibler 4/8/12s-Plan)
- TTS
- Assembly/Render/Captions
- Publishing

## Monorepo-Struktur

- `apps/web` – Next.js Wizard, Dashboard, Admin
- `apps/api` – API Gateway, Auth, Billing, Job-Orchestrierung
- `workers/pipeline` – BullMQ-Worker für KI-/Render-Schritte
- `packages/shared` – gemeinsame Typen, Zod-Schemas, Status-Enums
- `docs` – PRD, API-Schemas, Queue-Design

## Erste Zielarchitektur (MVP)

- Next.js + Tailwind
- Node.js/TypeScript API
- Postgres + Redis/BullMQ
- S3/Supabase Storage
- Stripe Billing + Credits Ledger
- Provider-Abstraktionen (LLM, Image, Video, TTS)

