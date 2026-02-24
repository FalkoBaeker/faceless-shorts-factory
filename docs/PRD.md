# Faceless Shorts Factory — PRD (MVP)

## 1) Produktfokus
- Webbasiertes B2B-SaaS für lokale Unternehmen (Handwerk, Salons, kleine Shops, Züchter).
- Time-to-Video: in unter 5 Minuten von Topic zu veröffentlichbarem Short.
- Fokus auf „Faceless“ Content mit konsistentem Branding.

## 2) MVP-Ziele
- Wizard: Input → Konzepte → Preview → Auswahl → Generierung → Review → Publish.
- Asynchrone Pipeline mit robustem Retry/Backoff und idempotenten Steps.
- Credits mit Reserve/Commit/Release Ledger-Logik.
- Multi-Tenant Datenmodell mit org-scope.

## 3) Nicht-Ziele (MVP)
- Kein freier Browser-Videoeditor.
- Kein vollständiger Social-Redaktionskalender.
- Keine Face/Avatar-Videofunktion.

## 4) Kern-Architektur
- Frontend: Next.js + Tailwind.
- API: Node.js/TypeScript (Auth, Billing, Orchestrierung).
- DB: Postgres.
- Queue: Redis + BullMQ.
- Storage: S3/Supabase Storage.
- Realtime: SSE/WebSocket für Job-Status.

## 5) Sora-Segment-Regel (harte Restriktion)
- Erlaubte Segmentlängen: 4s, 8s, 12s.
- SHORT_15: 8s + 8s = 16s, danach trim auf exakt 15.0s.
- MASTER_30: 12s + 12s + 8s = 32s, danach trim auf exakt 30.0s.
- Preisannahme: sora-2 $0.10/s, sora-2-pro (720x1280) $0.30/s.

## 6) Zustandsmodell (video_job)
`DRAFT -> IDEATION_PENDING -> IDEATION_READY -> STORYBOARD_PENDING -> STORYBOARD_READY -> SELECTED -> VIDEO_PENDING/AUDIO_PENDING -> ASSEMBLY_PENDING -> RENDERING -> READY -> PUBLISH_PENDING -> PUBLISHED`

Fehlerpfad:
`* -> FAILED` und `Credit RELEASED` sofern zuvor `RESERVED`.

## 7) Billing/Credits
- Ledger-Typen: `TOPUP`, `RESERVED`, `COMMITTED`, `RELEASED`, `MANUAL_ADJUSTMENT`.
- Commit nur bei final `READY`.
- Bei endgültigem Fail: Release.

## 8) Definition of Done (MVP)
- Nutzer kann 15s-Video Ende-zu-Ende erstellen, reviewen, herunterladen.
- Credits werden korrekt reserviert/committed/released.
- Job-Timeline ist nachvollziehbar und retry-sicher.
