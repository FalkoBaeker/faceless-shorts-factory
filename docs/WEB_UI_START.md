# Web UI Start (MVP: Auth + Export-ready Flow)

`apps/web` ist als Next.js App lokal startbar und jetzt mit realen API-Pfaden erweiterbar.

## Routes
- `/` — Wizard Start / Landing + Supabase Auth Panel (signup/login/status)
- `/review` — Review Preview + **Live Flow Trigger** (Project → Select → Generate)
- `/job-status` — Job-Status inkl. Mock State Preview + **Real Runtime Panel**
  - optional `?jobId=<id>` für direktes Polling
  - mock state toggles: `?state=loading|empty|progress|ready|error`

## Lokal starten
```bash
# API
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/api/src/main.ts

# Web
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npm run dev
```

## E2E (MVP)
1. `/` öffnen, Signup ausführen (ggf. Email bestätigen), dann Login
2. `/review` öffnen, Topic setzen und „Live Flow starten“ klicken
3. Weiterleitung zu `/job-status?jobId=...`
4. Bei `READY` erscheint Export-Download (signed URL)

CLI smoke:
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
npm run sim:free-customer
```

## Build/Lint
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npm run build
npm run lint
```

## Hinweise
- Auto-Publish ist im MVP deaktiviert (`ENABLE_AUTO_PUBLISH=false`), Connector bleibt nachrüstbar.
- Free-Customer-Flow ist im MVP standardmäßig aktiv (`ENABLE_FREE_PLAN_MVP=true`).
- Keine externe UI-Library im Slice verwendet.
- API Base URL via `NEXT_PUBLIC_API_BASE_URL` konfigurierbar (default `http://localhost:3001`).
