# Release Hygiene — GDPR / ToS / Operational Readiness (non-legal)

> Technische/operative Checkliste. Keine Rechtsberatung.

## Data Mapping & Minimization
- [ ] Dokumentiert, welche personenbezogenen Daten verarbeitet werden (email, usage events, logs)
- [ ] Nur notwendige Daten in DB/Logs speichern
- [ ] Keine Secrets/Tokens im Klartext in Logs

## Legal Surface in Product
- [ ] Privacy Policy URL im Web-Flow sichtbar
- [ ] Terms of Service URL im Web-Flow sichtbar
- [ ] Support-Kontakt/Impressum erreichbar
- [ ] Hinweis auf Drittanbieter (OpenAI, ElevenLabs, Supabase, Render) vorhanden

## Security Baseline
- [ ] `SUPABASE_SERVICE_ROLE_KEY` nur serverseitig
- [ ] Client nutzt nur `SUPABASE_ANON_KEY`
- [ ] `AUTH_REQUIRED=true` in non-dev environments
- [ ] Least privilege bei externen Accounts/API keys

## User Rights / Operations
- [ ] Prozess für Account-Löschung dokumentiert
- [ ] Prozess für Datenexport dokumentiert
- [ ] Incident/Abuse Kontakt und Reaktionsweg dokumentiert

## Retention & Deletion
- [ ] Aufbewahrungsfristen für Jobs/Assets definiert
- [ ] Cleanup-Mechanismus für alte Assets geplant
- [ ] Log-Retention definiert und begrenzt

## External Publishing (future scope)
- [ ] Separate ToS/consent check vor Aktivierung von Auto-Publish
- [ ] Plattformrichtlinien (TikTok/Instagram/YouTube) vor Live-Enablement geprüft
- [ ] User-level consent/audit trail für Posting-Aktionen vorgesehen

## Release Gate Note
- Auto-publish und Stripe sind im aktuellen MVP bewusst deaktiviert.
- Vor späterem Enablement ist ein eigener legal/operational re-review nötig.
