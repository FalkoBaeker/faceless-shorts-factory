# STATUS

## Aktueller Zustand
- Der Queue-/Worker-Flow ist grundsätzlich stabil (Happy Path, Idempotency, Publish wurden zuvor grün verifiziert).
- Der finale technische Sora-Prompt ist in der UI sichtbar (Review + Job-Status: Step2 bevorzugt, sonst Step1).
- Viral-Hook/Anti-Generic-Regeln wurden im Prompting verschärft (Step1 + Blueprint + Viewer-Script).
- Aktuell besteht ein WIP-Fix gegen Hänger bei `/v1/script/draft`: Provider-Timeouts (OpenAI/Supabase/ElevenLabs + Web API timeout) sind lokal implementiert, aber noch **nicht** committed.
- Offenes Produktproblem: User sieht vor Render teils nur einen kürzeren Draft-Ausschnitt (z. B. 13s), während der 30s-Render segmentiert (12+12+8) erstellt wird.

## Zuletzt erledigt (mit Commit-Hash)
- `1baf50a` `chore(web): include current tsbuildinfo artifact`
- `73f7644` `feat(prompt): expose final sora prompt and tighten viral hook/script flow`
- `7e8dfda` `fix(consistency): support structured camera/dialog scripts in hook and sentence checks`
- `a022472` `fix(video): use segment-specific sora prompts with continuity progression`

## Offen / Nächste Schritte (priorisiert)
1. WIP-Timeout-Fix committen (`live-provider-runtime.ts`, `apps/web/app/lib/api-client.ts`) und API/Web neu starten.
2. Repro validieren: `/v1/script/draft` darf nicht mehr endlos hängen, sondern muss mit klarer Fehlermeldung abbrechen (`OPENAI_HTTP_TIMEOUT` etc.).
3. UX-Lücke schließen: kompletten 30s-Blueprint vor Freigabe anzeigen (nicht nur Draft-Ausschnitt).
4. Freigabe-Logik härten: freigegebenen Blueprint einfrieren und exakt für Render verwenden (kein stilles Neuplanen).
5. Abschluss-Verifikation: `MASTER_30` End-to-End mit sichtbar konsistentem Preview -> finalem Ergebnis.

## Blocker
- Kein harter technischer Blocker aktuell.
- Produkt-/UX-Blocker: fehlende 1:1-Transparenz zwischen freigegebenem Draft und finalem 30s-Renderplan.
- Uncommitted Working Tree vorhanden (siehe `git status`), deshalb Übergabe/Push noch ausstehend.

## Test-Commands (copy/paste)
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
git pull
```

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --env-file=.env --experimental-strip-types apps/api/src/main.ts
```

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npm run dev
```

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
npx tsc --noEmit
```

```bash
curl -sS -X POST http://127.0.0.1:3001/v1/script/draft \
  -H 'content-type: application/json' \
  --data '{"topic":"Neueröffnung Hotel Steinburg","variantType":"MASTER_30","moodPreset":"commercial_cta","creativeIntent":{"effectGoals":[{"id":"sell_conversion"}],"narrativeFormats":[{"id":"commercial"}],"energyMode":"high"},"brandProfile":{"companyName":"Hotel Steinburg","websiteUrl":"https://www.steinburg.de"},"startFrameStyle":"hands_at_work","startFrameSummary":"Rezeption mit Blumen und Champagner"}'
```

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --env-file=.env --experimental-strip-types apps/api/src/simulate-live-provider-e2e.ts
```

## Wichtige Pfade/Dateien
- `apps/api/src/providers/live-provider-runtime.ts` (Prompting, Segmentierung, Provider-Calls, Timeouts)
- `apps/api/src/handlers.ts` (`/v1/script/draft` Handler)
- `apps/web/app/components/review-live-actions.tsx` (Draft/Script UI, Akzeptanz, Flow)
- `apps/web/app/components/job-runtime-panel.tsx` (Anzeige final verwendeter Sora-Prompt)
- `apps/web/app/lib/api-client.ts` (Frontend Request-Timeout/Fehlerbehandlung)
- `PLAN.md` (aktueller Umsetzungsplan)
