# Job Flow (MVP Runtime Skeleton)

1. `startJob(projectId, variantType)`
   - erstellt Job mit `SELECTED`
   - schreibt Timeline-Event mit Segmentplan (`8+8` oder `12+12+8`)
2. Worker führt Statusübergänge aus
   - `VIDEO_PENDING` / `AUDIO_PENDING` → `ASSEMBLY_PENDING` → `RENDERING` → `READY`
3. Bei Fehler
   - `FAILED`
   - Credits werden laut Ledger-Logik released (Implementierung folgt im Billing-Service)

## Technischer Hinweis
- Job-Orchestrierung läuft asynchron via BullMQ (video/audio/assembly/publish).
- Finale Fehler laufen kontrolliert nach `FAILED` und erzeugen DLQ-Eintrag + Credit-Release.
- Replay erfolgt über DLQ-Endpoint (`POST /v1/dlq/:id/replay`).
