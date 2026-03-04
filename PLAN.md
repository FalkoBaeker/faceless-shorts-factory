# PLAN

## Ziel
Der Nutzer soll vor dem Rendern transparent sehen und freigeben können, was im finalen 30s-Video tatsächlich passiert (inkl. kompletter Segment-Blueprint statt nur Draft-Ausschnitt).  
Zusätzlich soll `Ablauf generieren` nicht mehr unendlich hängen, sondern bei Provider-Problemen deterministisch mit klarer Fehlermeldung abbrechen.  
Der bestehende Flow (Startframe -> Ablauf -> Freigabe -> Video) bleibt funktional und nachvollziehbar.

## Nicht-Ziele
- Kein Redesign der gesamten UI/Navigation.
- Keine Änderung der Sora-Provider-Grundintegration oder des Segment-Renderprinzips (12/12/8 bleibt).
- Keine neue Auth-/Billing-Logik.
- Keine inhaltliche Qualitätsgarantie für jeden generierten Prompt (nur robuste Pipeline + bessere Transparenz).

## Annahmen / Constraints
- Annahme: Ziel-Repo ist `faceless-shorts-factory` auf `main`.
- Keine neuen Dependencies.
- Keine DB-Migration, kein neues persistentes Schema in Postgres.
- Bestehende Asset-/Timeline-Mechanik (Supabase + `ASSET_*` Events) wird weiterverwendet.
- Annahme: `MASTER_30` bleibt der primäre 30s-Flow, `SHORT_15` muss weiterhin funktionieren.
- Annahme: Bestehende ENV-Keys bleiben gültig; Timeouts werden nur über ENV ergänzt/justiert.

## Akzeptanzkriterien
- Done wenn bei `MASTER_30` vor dem Render ein kompletter 30s-Blueprint sichtbar ist (alle Segmente inkl. Dauer/Beat/Promptauszug).
- Done wenn der freigegebene Blueprint für den Render eingefroren wird (kein stilles Neuplanen bei `Video erstellen`).
- Done wenn `Ablauf generieren` bei Upstream-Hängern mit Timeout-Fehler endet (statt >10 min ohne Antwort).
- Done wenn der User den final verwendeten Prompt/Blueprint im Statusbereich einsehen kann.
- Done wenn `SHORT_15` und `MASTER_30` weiterhin erfolgreich durchlaufen (keine Regression im Happy Path).

## Architektur/Approach
- Draft-API erweitert um `promptBlueprint` (segmentiert, inkl. segment seconds, userFlowBeat, technical prompt snippet).
- Review-UI zeigt neben Ablauftext den kompletten 30s-Blueprint vor Freigabe.
- Freigabe speichert den Blueprint als “approved blueprint” im bestehenden Payload/Timeline-Kontext.
- Generate-Phase bevorzugt den freigegebenen Blueprint; nur bei fehlendem Blueprint fällt sie auf Neuplanung zurück.
- Segment-Renderer nutzt weiterhin bestehende Segment-Loop-Logik, aber aus dem freigegebenen Blueprint.
- Bereits eingebauten finalen Prompt-Viewer (`job-status`) um Blueprint-Sicht ergänzen.
- Provider-HTTP-Timeouts zentral erzwingen (OpenAI/Supabase/ElevenLabs + API-Client Timeout im Web).
- Fehlertexte im UI konkretisieren (`OPENAI_HTTP_TIMEOUT`, `SUPABASE_HTTP_TIMEOUT`, etc.).
- Verifikation über: Typecheck Web, Script-Draft Repro, End-to-End `MASTER_30` mit sichtbarem Blueprint.

## Risiken / offene Fragen
- Risiko: Blueprint kann sehr lang sein; UI braucht klare Darstellung (Scroll/Collapse), sonst unlesbar.
- Risiko: Zu striktes Einfrieren kann bei harten Provider-Fehlern weniger flexibel sein (Fallback-Strategie nötig).
- Offene Frage: Soll der User den technischen Segment-Prompt editieren dürfen oder nur lesen?
- Offene Frage: Reicht Promptauszug pro Segment im UI, oder muss der komplette Raw-Prompt je Segment sichtbar sein?
- Annahme: Bestehende Timeline/Assets genügen als Audit-Quelle, ohne zusätzliche DB-Felder.
