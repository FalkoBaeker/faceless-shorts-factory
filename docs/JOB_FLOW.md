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
Aktuell in-memory Job-Store für schnelles Vertical Slice.
Nächster Schritt: Persistenz in Postgres + Queue events via BullMQ.
