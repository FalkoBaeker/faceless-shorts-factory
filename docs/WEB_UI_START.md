# Web UI Start (Clickable Vertical Slice)

`apps/web` ist jetzt als Next.js App lokal startbar und klickbar.

## Routes
- `/` — Wizard Start / Landing (mobile-first Hero + Paketvergleich + Step-Übersicht)
- `/review` — Review Preview (Caption/Hashtags/Targets + QA-Checks)
- `/job-status` — Job-Status mit State-Switcher
  - `?state=loading`
  - `?state=empty`
  - `?state=progress`
  - `?state=ready`
  - `?state=error`

## Lokal starten
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npm install
npm run dev
```

## Build/Lint
```bash
npm run build
npm run lint
```

## Hinweise
- Keine externe UI-Library im Slice verwendet (nur Next + React + eigenes CSS).
- Mock-Daten zentral in `apps/web/app/lib/mock-data.ts` vorbereitet für spätere API-Anbindung.
- Fokus: mobile-friendly Touch-UX, saubere States, klickbarer End-to-End Eindruck.
