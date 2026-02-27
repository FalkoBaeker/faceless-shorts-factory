# Faceless Shorts Factory – Implementation Tickets v1.2 (User-Feedback Pass)

Stand: 2026-02-27

## Ziel
Randomness reduzieren, Startframe-Auswahl visualisieren, eigenen Input stärken, mehr Bewegung sichern, Mood/Concept/Script konsistent machen.

---

## T10 – Visuelle Startframe-Kandidaten statt Label-Chips

**Problem:** Kandidaten sind nur Textlabels, Auswahl ist blind.

**Scope:**
- `/v1/startframes/candidates` liefert `thumbnailUrl` pro Candidate.
- Review-UI zeigt Card-Grid mit Preview-Bild + Label + Beschreibung.
- technische IDs aus Primär-UI entfernen.

**DoD:**
- 3–5 visuelle Kandidaten sichtbar.
- Auswahlzustand visuell klar (aktive Card).
- Keine Raw-ID im Haupttext.

**Tests:**
- API Smoke: `thumbnailUrl` vorhanden, nicht leer.
- UI: Candidate wählen -> Startframe-Status springt auf „gewählt“.

---

## T11 – Eigenes Bild hochladen als Startframe-Referenz

**Problem:** Kein eigener Input für echte Marken-/Produktreferenz.

**Scope:**
- Upload-Feld im Review-Flow (png/jpg/webp).
- Lokale Preview + Auswahl „Eigenes Referenzbild“.
- Select-API akzeptiert `startFrameCustomPrompt` + `startFrameReferenceHint`.

**DoD:**
- User kann eigenes Bild auswählen.
- Generate funktioniert ohne Candidate-ID, wenn Upload aktiv.
- Timeline enthält Startframe-Mode `uploaded_reference`.

**Tests:**
- Upload eines Bilds + Start Flow -> API 200.
- Timeline-Event `STORYBOARD_SELECTED` enthält `startFrameMode=uploaded_reference`.

---

## T12 – Creative Intent Lock (Mood/Concept/Script)

**Problem:** Humor/Concept-Auswahl wird nicht stabil im Output gehalten.

**Scope:**
- Mood-Prompts härten (z. B. `humor_light` ohne Hard-Sell-Deadline-Sprache).
- Script-/Video-Prompt enthält explizite Tonalitätsgrenzen.

**DoD:**
- Mood-spezifische Negativregeln im Prompt verankert.
- Keine widersprüchlichen "Hard Sell" Phrasen bei `humor_light` im Standardfall.

**Tests:**
- Prompt-Unit-Test/Inspection auf Mood-Regeln.
- Stichproben-Generation mit `humor_light` ohne Deadline-CTA-Pattern.

---

## T13 – Motion Guard für 30s/60s

**Problem:** Zu viele Standbilder, zu wenig Bewegung.

**Scope:**
- Motion-Guard in Video-Prompt (minimale Bewegungsphasen + Max-Länge statischer Shots).
- Variant-spezifisch (30s vs 60s).

**DoD:**
- Prompt enthält Motion-Regel je Variante.
- Runtime schreibt Motion-Guard-Werte nachvollziehbar in Prompt/Timeline.

**Tests:**
- Prompt-Inspection je VariantType.
- Batch-Stichprobe auf deutlich höhere Bewegungsdichte.

---

## T14 – Generate nur mit erfüllten Preconditions + klare Blocker

**Problem:** CTA wirkt klickbar trotz offener Pflichtschritte.

**Scope:**
- Generate deaktiviert, solange Script nicht akzeptiert und kein Startframe (Candidate oder Upload) gesetzt.
- Tooltip/Inline-Blockertext zeigt präzise fehlenden Schritt.

**DoD:**
- Kein Start möglich bei fehlenden Pflichtdaten.
- Klarer Blockertext sichtbar.

**Tests:**
- UI: no-script/no-startframe => Button disabled + Blocker.
- UI: mit Script + Startframe => Button enabled.
