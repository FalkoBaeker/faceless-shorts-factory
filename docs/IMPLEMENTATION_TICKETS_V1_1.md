# Implementation Tickets — Product Flow v1.1

Status: Ready for execution  
Date: 2026-02-26 23:47 CET  
Source: `docs/PRODUCT_FLOW_V1_1.md`

## Priorisierung
- **MUST (M)**: notwendig für v1.1 DoD
- **SHOULD (S)**: hoher Mehrwert, kurz nach MUST
- **COULD (C)**: nice-to-have / v1.2-nah

## Reihenfolge (empfohlen)
1. T01 → T02 → T03 → T04
2. T05 → T06 → T07
3. T08 → T09
4. T10 → T11
5. T12 (optional)

---

## T01 (M) — Standardlänge auf 30s umstellen
**Ziel**  
30s als Standard im UI/Backend, 60s als optionaler Premium-Pfad per Feature-Flag.

**Scope**
- Default variant im UI auf 30s
- Backend-Default + estimatedSeconds auf 30/60 anpassen
- Feature-Flag für 60s (`ENABLE_PREMIUM_60`)

**Akzeptanzkriterien**
- Neue Jobs ohne explizite Wahl laufen auf 30s
- 60s ist nur sichtbar/auswählbar, wenn Flag aktiv

**Test**
- Unit: default variant mapping
- UI: Standardauswahl = 30s

**Aufwand**: S
**Abhängigkeit**: keine

---

## T02 (M) — Script-Duration Guard + Pre-TTS Check
**Ziel**  
Script darf nicht länger sein als Zielzeit erlaubt.

**Scope**
- Zielwortbereich pro Länge definieren
- Pre-TTS Dauerabschätzung
- Auto-Condense bei Überschreitung (oder Block + Hinweis)

**Akzeptanzkriterien**
- Kein Render mit klar überlangem Script ohne Warnung/Condense
- Timeline enthält `SCRIPT_DURATION_VALIDATED`

**Test**
- Overlong-Script Input -> condense/warn path

**Aufwand**: M
**Abhängigkeit**: T01

---

## T03 (M) — Script Review Step (edit / regenerate / accept)
**Ziel**  
User muss Script vor Render sehen und freigeben.

**Scope**
- UI-Step „Script Review"
- Buttons: Regenerate, Edit, Accept
- API-Flag `scriptAccepted=true` vor generate Pflicht

**Akzeptanzkriterien**
- Generate ohne Accept gibt 4xx + klaren Fehler
- Acceptter Scripttext wird für TTS verwendet

**Test**
- E2E: editiertes Script wird hörbar im finalen Voiceover

**Aufwand**: M
**Abhängigkeit**: T02

---

## T04 (M) — Storyboard/Mood Presets als echte Narrative
**Ziel**  
Auswahl darf nicht nur Visual-Style sein, sondern Story-Logik steuern.

**Scope**
- Presets: Commercial CTA, Problem→Lösung, Testimonial, Humor light
- Prompt-Bausteine je Preset
- Timeline-Event `SELECTED_MOOD`

**Akzeptanzkriterien**
- Unterschiedliche Presets erzeugen erkennbar unterschiedliche Skriptstruktur

**Test**
- Snapshot-Vergleich Scriptstruktur pro Preset

**Aufwand**: M
**Abhängigkeit**: T03

---

## T05 (M) — Startframe Candidate Generation + Auswahl
**Ziel**  
Mind. 3 Startframes vor Render anbieten.

**Scope**
- API erzeugt 3 Candidates
- UI zeigt Kandidaten + 1 Auswahl
- Ausgewählter Candidate wird in Video-Prompt verwendet

**Akzeptanzkriterien**
- Ohne Auswahl kein Generate
- Timeline enthält `SELECTED_STARTFRAME`

**Test**
- E2E: gewählter Candidate-ID im Timeline/Event sichtbar

**Aufwand**: M
**Abhängigkeit**: T04

---

## T06 (M) — Concept Selection UX vereinfachen
**Ziel**  
Concept-Auswahl klar verständlich (nicht „lauter Buttons“).

**Scope**
- Nur 3–4 primäre Optionen sichtbar
- Pro Option: 1 Satz „was passiert im Video“
- „Advanced“ für Detailoptionen

**Akzeptanzkriterien**
- User kann ohne Erklärung passende Option wählen

**Test**
- UX smoke mit erstem Durchlauf ohne Hilfe

**Aufwand**: S
**Abhängigkeit**: T05

---

## T07 (M) — Audio/Video Story-Ende synchronisieren
**Ziel**  
Kein abruptes Ende mehr bei Story oder Audio.

**Scope**
- Finale Audio-Länge an Ziel koppeln (trim/pad/time-stretch minimal)
- Letzten Satz abgeschlossen halten (LLM Outro-Satz)
- Timeline: `FINAL_SYNC_OK` mit Dauerwerten

**Akzeptanzkriterien**
- 95% Läufe: A/V-Ende innerhalb ±0.3s
- Kein hörbarer Satzabbruch

**Test**
- Batch-Verify über mehrere Topics

**Aufwand**: M
**Abhängigkeit**: T02, T03

---

## T08 (M) — Caption Safe Area harden
**Ziel**  
Captions dürfen nicht am Rand abgeschnitten werden.

**Scope**
- Safe-area Parameter zentralisieren
- Render/Assembly mit festen Rändern
- Timeline: `CAPTION_SAFE_AREA_APPLIED`

**Akzeptanzkriterien**
- Keine Caption außerhalb Title-safe im 9:16 Export

**Test**
- Visual check auf 3 Devices + edge cases (lange Wörter)

**Aufwand**: S
**Abhängigkeit**: T07

---

## T09 (M) — Runtime UI “real first” finalisieren
**Ziel**  
Runtime-Seite ohne Mock-Verwirrung.

**Scope**
- Reale Panels oben
- Mock-Bereiche nur in collapsible „Preview"
- Klarer Primär-CTA pro Seite

**Akzeptanzkriterien**
- Nutzer findet in <10s den echten Flow

**Test**
- Smoke-Test ohne interne Einweisung

**Aufwand**: S
**Abhängigkeit**: T06

---

## T10 (S) — Logo Upload + optional Outro Animation
**Ziel**  
Kund:innen können optional Logo am Ende einblenden lassen.

**Scope**
- Upload (png/svg)
- Toggle „Logo im Outro"
- einfacher Motion-Preset (fade/slide)

**Akzeptanzkriterien**
- Wenn aktiviert: Logo sichtbar im Outro, sonst nicht

**Test**
- E2E mit/ohne Toggle

**Aufwand**: M
**Abhängigkeit**: T07

---

## T11 (S) — Onboarding Brand Profile
**Ziel**  
App kennt Unternehmen/Branche/Ziele und nutzt das automatisch.

**Scope**
- Onboarding-Form
- Speicherung `brand_profile`
- Prompt-Anreicherung mit Profil

**Akzeptanzkriterien**
- Folgevideos nutzen gespeicherten Kontext ohne erneute Eingabe

**Test**
- Neues Video reflektiert Profilangaben im Script

**Aufwand**: M
**Abhängigkeit**: keine (parallel möglich)

---

## T12 (C) — 60s Premium Rollout Hardening
**Ziel**  
60s robust und wirtschaftlich betreiben.

**Scope**
- Feature-Flag Rollout
- strengere Timeout/Retry-Profile
- Kostenlimits pro Job

**Akzeptanzkriterien**
- 60s läuft stabil ohne Must-Flow zu beeinträchtigen

**Test**
- 60s smoke matrix (3 moods × 3 verticals)

**Aufwand**: M
**Abhängigkeit**: T01–T09

---

## Sprintvorschlag (kurz)

### Sprint A (MVP stabil)
- T01, T02, T03, T07, T08, T09

### Sprint B (UX-/Creative-Qualität)
- T04, T05, T06

### Sprint C (Commercial Layer)
- T10, T11

### Sprint D (Premium)
- T12

---

## Definition of Done (Execution)
- Alle MUST-Tickets abgeschlossen
- E2E-Flow für externen Free-Kunden von Signup bis Download stabil
- Story/Audio/Video endet synchron ohne abrupten Cut
- Reale UI klar und ohne Mock-Verwirrung nutzbar
