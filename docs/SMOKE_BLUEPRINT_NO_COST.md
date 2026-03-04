# No-Cost Smoke: 30s Blueprint Preview + Freeze

Ziel: Verifizieren, dass der User vor Render den kompletten Segment-Blueprint sieht und genau dieser Blueprint beim Render eingefroren wird, ohne kostenpflichtige OpenAI-Calls.

## 1) Vorbereitung (No-Cost)

- [ ] In Terminal A:

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
SIM_PROVIDER_FALLBACK=true node --env-file=.env --experimental-strip-types apps/api/src/main.ts
```

- [ ] In Terminal B:

```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory/apps/web
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 npm run dev
```

## 2) UI-Flow prüfen (Review)

- [ ] Öffne `http://localhost:3000/review-live`.
- [ ] Wähle `30s`.
- [ ] Klicke `3 Startframe-Kandidaten erzeugen` und dann einen Kandidaten.
- [ ] Klicke `Ablauf generieren`.
- [ ] Prüfe, dass der Block **Finaler 30s-Blueprint vor Render** sichtbar ist.
- [ ] Prüfe, dass pro Segment sichtbar ist:
  - [ ] Segment-Index
  - [ ] Segment-Sekunden
  - [ ] User-Flow-Beat
  - [ ] Prompt-Snippet
- [ ] Prüfe den Hinweis:
  - [ ] `Segmentplan liefert ... Rohmaterial; finaler Export wird auf ... getrimmt.`
- [ ] Klicke `Ablauf akzeptieren / bearbeiten`.
- [ ] Klicke `Video erstellen`.

## 3) Freeze im Job-Status prüfen

- [ ] Öffne den Job-Status (Redirect oder `http://localhost:3000/job-status?jobId=<JOB_ID>&state=progress`).
- [ ] Prüfe, dass der Block **Final verwendeter Blueprint** sichtbar ist.
- [ ] Prüfe, dass die Quelle angezeigt wird (`Freigabe` oder `Render-Lauf`).
- [ ] Prüfe den Trim-Hinweis:
  - [ ] `Segmentplan-Rohdauer ... finalen Export auf ... getrimmt`.

## 4) API/TL-Checks (optional, schnell)

- [ ] `STORYBOARD_SELECTED` enthält `approvedPromptBlueprint`.
- [ ] `SORA_PROMPT_BLUEPRINT_APPROVED` Event ist vorhanden.

Beispiel:

```bash
curl -sS http://127.0.0.1:3001/v1/jobs/<JOB_ID> | jq '.timeline | map(select(.event=="STORYBOARD_SELECTED" or .event=="SORA_PROMPT_BLUEPRINT_APPROVED"))'
```

## 5) Erwartetes Ergebnis

- [ ] Blueprint ist vor Render vollständig sichtbar.
- [ ] Akzeptierter Blueprint ist eingefroren (in Timeline/Status nachvollziehbar).
- [ ] Kein kostenpflichtiger Provider-Lauf (SIM fallback aktiv).
