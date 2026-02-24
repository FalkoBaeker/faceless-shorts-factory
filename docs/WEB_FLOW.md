# Web Flow Domain (Wizard + Review)

## Wizard model
- `wizardSteps` bildet den Frontend-Flow ab (onboarding -> publish).
- `variantCards` modelliert 15s/30s Produkte inklusive Segmentmuster (`8+8` bzw. `12+12+8`).
- `buildCreateProjectPayload` erzeugt API-kompatibles Payload für `POST /v1/projects`.

## Review model
- `buildDefaultReviewPayload` erzeugt ein editierbares Review-Objekt (Caption/Hashtags/CTA/Post-Targets).
- Unterstützte Targets im MVP: `tiktok`, `instagram`, `youtube`.

## Lokaler Check
```bash
cd /Users/falkobaeker/.openclaw/workspace/faceless-shorts-factory
node --experimental-strip-types apps/web/src/simulate-web-flow.ts
```

Expected:
- `stepCount=8`
- `selectedVariant=MASTER_30`
- `plannedSeconds=32`, `finalSeconds=30`
- `segmentPattern=12+12+8`
