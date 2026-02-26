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

- Next.js (mobile-first UI) + Node.js/TypeScript API
- Postgres + Redis/BullMQ
- Supabase Auth + Storage (signed export URLs)
- Provider-Abstraktionen (LLM, Image, Video, TTS)
- Entitlement Gate (plan/allowlist) ohne harte Stripe-Abhängigkeit im MVP
- Alerts via Gmail API (gog) mit logs fallback

## MVP Modus (aktueller Stand)
- Auto-Publish: **deaktiviert** (`ENABLE_AUTO_PUBLISH=false`)
- Stripe: **optional/deferred**
- Ziel-Flow: Start → Review → Job READY → Export

## Wichtige Scripts
- `npm run sim:auth` — Auth smoke
- `npm run sim:alerts` — Alert routing smoke (email/log fallback)
- `npm run render:preflight` — Render owner/service preflight
- `npm run render:plan` — Render provisioning plan (ohne billable create)

