# Product Flow v1.1 (PRD-light)

Status: Draft for implementation planning  
Date: 2026-02-26 23:44 CET  
Owner: Falko + Angus

## 1) Zielbild

Der Kunde soll in wenigen, klaren Schritten ein kurzes Marketing-Video erstellen können, ohne technische Hürden:

1. Onboarding (einmalig, Unternehmenskontext)
2. Topic-Input (pro Video)
3. Mood/Format-Auswahl (z. B. Commercial CTA, Problem→Lösung, UGC)
4. Script-Review (editieren/regenieren/akzeptieren)
5. Startframe + Konzept-Vorschläge auswählen
6. Generierung starten
7. Runtime verfolgen (klar, ohne Mock-Verwirrung)
8. Download (optional später Publish)

## 2) Scope v1.1

### In scope
- 30s als Standardlänge (empfohlen)
- optional 60s als Premium-Slot (Feature-Flag)
- Script-Review vor Generierung
- Concept/Mood-Auswahl mit echten narrativen Presets
- Startframe-Candidate-Auswahl (mind. 3 Vorschläge)
- Deterministische Längensynchronität (Story + Audio + Video enden gemeinsam)
- Caption Safe Area (kein Rand-Cropping)
- Klare Runtime-UI (real first, mock hidden)

### Out of scope (v1.1)
- Auto-Publish auf Social (bleibt deferred)
- Vollständige Brand-Design-Systeme
- Mehrsprachige Lokalisierungs-UI

## 3) UX-Fluss (Soll)

### Step A — Onboarding (einmalig)
Pflichtfelder:
- Unternehmenstyp/Branche
- Zielgruppe
- Tonalität
- Primäres Ziel (Leads, Awareness, Buchung etc.)

Optional:
- Logo Upload (PNG/SVG)
- CTA-Defaults

Ergebnis:
- `brand_profile` gespeichert und für alle folgenden Prompts verfügbar.

### Step B — Video-Brief
- Topic/Stichworte (z. B. „Rohr verstopft“)
- Länge: 30s (default), 60s (premium)
- Mood/Preset (Commercial CTA / Problem→Lösung / Testimonial / Humor light)

### Step C — Script Review
System erzeugt Script-Entwurf mit Zielwörtern passend zur Länge.

User kann:
- Editieren
- Regenerieren
- Akzeptieren

Regel:
- Kein Render ohne explizites „Script akzeptieren“.

### Step D — Startframe + Konzeptwahl
System erzeugt:
- 3 Startframe-Candidates
- 2–3 Konzept-Kurzvorschläge (Shot-Logik)

User wählt:
- 1 Startframe
- 1 Konzept

Optional:
- „Logo am Ende animieren“ (toggle)

### Step E — Generierung
Pipeline erzeugt:
- Video-Segment(e)
- Voiceover
- Captions
- Final Assembly

Qualitätsgates:
- Ziel-Länge exakt einhalten
- Audio endet nicht nach/nach Video
- Story endet nicht abrupt

### Step F — Runtime + Download
- Echte Statuskette sichtbar
- Download-Button bei `READY`
- Mock-Bereiche standardmäßig verborgen

## 4) Quality / Acceptance Criteria

### 4.1 Timing & Story
- 95%+ der Runs: Finaldauer innerhalb ±0.3s der Ziellänge
- Voiceover endet innerhalb ±0.3s zur Videolänge
- Kein Satzabbruch im letzten Audio-Segment

### 4.2 Script Qualität
- Script-Länge wird vor TTS gegen Zielzeit validiert
- Bei Überschreitung: Auto-Condense ODER User-Hinweis im Review-Step

### 4.3 Caption Safety
- Captions müssen title-safe bleiben (z. B. 10% Randabstand)
- Keine abgeschnittenen Untertitel bei 9:16 Export

### 4.4 UI Klarheit
- Primäre CTA pro Seite eindeutig
- Mock-Sektionen in „Advanced/Preview“-Bereich
- Tooltip/Hint für jede Auswahl, die Output beeinflusst

## 5) 30/60 Sekunden Strategie (Empfehlung)

### Produktentscheidung (empfohlen)
- 30s = Standard für alle
- 60s = Premium

### Begründung
- 15s ist für kohärente Mini-Story + CTA oft zu eng
- 30s bietet besseres Story-Pacing bei vertretbaren Kosten
- 60s erhöht Kosten, Latenz, Fehleranfälligkeit, daher Premium

### Technische Machbarkeit
- 30s: sofort umsetzbar
- 60s: umsetzbar, benötigt strengere Provider-Timeouts, Kostenkontrolle und robuste Retry/Failover-Logik

## 6) Technische Leitplanken v1.1

1. Script-zu-Länge Kopplung
   - Zielwörter pro Sekunde definieren
   - Pre-Render-Duration-Schätzung (TTS dry estimate) vor Render

2. Assembly-Lock
   - Finalduration hard-lock auf Ziel
   - Audio time-stretch minimal (nur wenn nötig) + weicher Outro-Fade

3. Provider-Safety
   - Stage-timeouts + klare Failed-Reasons
   - Fallback-Strategien für TTS/Video

4. Observability
   - Timeline-Events für: selected_mood, selected_concept, selected_startframe, script_accepted, safe_area_applied, final_duration

## 7) Definition of Done (v1.1)

Ein externer Free-Kunde kann:
1. sich anmelden + verifizieren
2. 30s Flow inkl. Script-Review, Concept, Startframe wählen
3. Video erzeugen
4. Downloaden
5. und bekommt ein Ergebnis, das nicht abrupt endet (Story + Audio + Video synchron).

## 8) Testmatrix (Minimum)

- Branche: 3 Verticals (Handwerk, Gastro, Retail)
- Mood: mind. 3 Presets
- Länge: 30s (mandatory), 60s (premium path)
- Voice: OpenAI + ElevenLabs (falls verfügbar)
- Result checks:
  - duration sync
  - caption safe area
  - no abrupt ending
  - runtime clarity

## 9) Open Questions

1. 60s sofort freischalten oder hinter Feature-Flag? (empfohlen: Feature-Flag)
2. Logo-Animation v1.1 oder v1.2? (empfohlen: v1.1 light mit einfachem outro placement)
3. Script-Review: Volltext-Editor oder nur regenerate + quick edits?

---

Dieses Dokument ist die Entscheidungs- und Umsetzungsbasis für den nächsten Implementierungspass.

## 10) v1.4 Delta (geplant, 2026-02-28)

Aus aktuellem User-Feedback (18 Punkte) wird der Flow in v1.4 erweitert:

1. **Mood/Format → Creative Intent Matrix** (Mehrfachauswahl, stärkere Wirkungskontrolle)
2. **Storyboard Light (editierbar)** statt technischer Prompt-Ansicht
3. **Prompt Compiler v2 mit Background-Safeguard** (Hook/Motion/Shot-Diversity), außer explizit ruhigem Intent
4. **Vereinfachte Pending-UX + klare Download-CTA + Login-UX-Fixes**
5. **Caption/Audio/Hook-Qualität** als eigener Qualitätsblock

Referenz-Tickets: `docs/IMPLEMENTATION_TICKETS_V1_4.md`
