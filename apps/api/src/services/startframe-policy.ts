type StartFrameStyle =
  | 'storefront_hero'
  | 'product_macro'
  | 'owner_portrait'
  | 'hands_at_work'
  | 'before_after_split';

export type StartFramePolicyPreflightInput = {
  topic: string;
  conceptId?: string;
  startFrameStyle?: StartFrameStyle;
  startFrameCandidateId?: string;
  startFrameLabel?: string;
  startFrameCustomPrompt?: string;
  startFrameReferenceHint?: string;
  startFrameUploadObjectPath?: string;
};

export type StartFramePolicyPreflightDecision = 'allow' | 'fallback' | 'block';

export type StartFramePolicyPreflightResult = {
  decision: StartFramePolicyPreflightDecision;
  reasonCode:
    | 'NO_SELECTION'
    | 'PASSED'
    | 'MINOR_RISK'
    | 'SEXUAL_CONTENT_RISK'
    | 'HUMAN_REFERENCE_NEEDS_FALLBACK'
    | 'PUBLIC_FIGURE_NEEDS_FALLBACK';
  userMessage: string;
  remediation: string;
  effectiveStartFrameStyle?: StartFrameStyle;
  effectiveStartFrameLabel?: string;
  effectiveStartFramePrompt?: string;
  matchedSignals: string[];
};

export const startFrameLabelByStyle: Record<StartFrameStyle, string> = {
  storefront_hero: 'Storefront Hero',
  product_macro: 'Produkt-Makro',
  owner_portrait: 'Owner Portrait',
  hands_at_work: 'Hands at Work',
  before_after_split: 'Before/After Split'
};

export const startFramePromptByStyle: Record<StartFrameStyle, string> = {
  storefront_hero: 'Startframe: Hero-Aufnahme der Ladenfront/Marke, gut ausgeleuchtet, ruhiger Hintergrund.',
  product_macro: 'Startframe: Produkt-Makroaufnahme mit hoher Detailtiefe und klarer Trennung vom Hintergrund.',
  owner_portrait: 'Startframe: freundliches Owner-Portrait, Blick zur Kamera, professionell aber authentisch.',
  hands_at_work: 'Startframe: Hände bei der Arbeit/Herstellung, dynamisch und handwerklich nah.',
  before_after_split: 'Startframe: Vorher/Nachher-Split mit klaren visuellen Unterschieden.'
};

const minorRiskPattern = /(child|minor|kid|teen|baby|school\s*child|minderj[aä]hrig|kind|jugendlich)/i;
const sexualRiskPattern = /(nude|nudity|sexual|explicit|erotic|fetish|nsfw|freiz[üu]gig|porn)/i;
const publicFigurePattern = /(celebrity|public\s*figure|politician|actor|singer|influencer|prominent)/i;
const humanReferencePattern = /(person|human|face|portrait|selfie|owner|kunde|kundin|mitarbeiter|gesicht)/i;
const rightsSignalPattern = /(consent|einwilligung|rechte|lizenz|release|permission|freigabe)/i;

const normalizeStyle = (value?: string): StartFrameStyle | undefined => {
  if (!value) return undefined;
  if (['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'].includes(value)) {
    return value as StartFrameStyle;
  }
  return undefined;
};

export const evaluateStartframePolicyPreflight = (
  input: StartFramePolicyPreflightInput
): StartFramePolicyPreflightResult => {
  const startFrameStyle = normalizeStyle(input.startFrameStyle);

  if (!startFrameStyle && !input.startFrameUploadObjectPath?.trim()) {
    return {
      decision: 'allow',
      reasonCode: 'NO_SELECTION',
      userMessage: 'Noch kein Startframe ausgewählt.',
      remediation: 'Wähle einen Kandidaten oder lade ein eigenes Bild hoch.',
      matchedSignals: []
    };
  }

  const textCorpus = [
    input.topic,
    input.conceptId,
    input.startFrameLabel,
    input.startFrameCustomPrompt,
    input.startFrameReferenceHint,
    input.startFrameUploadObjectPath
  ]
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000);

  const matchedSignals: string[] = [];
  const hasUpload = Boolean(input.startFrameUploadObjectPath?.trim());
  const hasRightsSignal = rightsSignalPattern.test(textCorpus);
  const hasHumanSignal = humanReferencePattern.test(textCorpus) || startFrameStyle === 'owner_portrait';

  if (minorRiskPattern.test(textCorpus)) {
    matchedSignals.push('MINOR_KEYWORDS');
    return {
      decision: 'block',
      reasonCode: 'MINOR_RISK',
      userMessage: 'Der gewählte Startframe enthält Hinweise auf Minderjährige und wurde blockiert.',
      remediation: 'Nutze stattdessen ein neutrales Produkt-/Storefront-Motiv ohne minderjährige Personen.',
      matchedSignals
    };
  }

  if (sexualRiskPattern.test(textCorpus)) {
    matchedSignals.push('SEXUAL_KEYWORDS');
    return {
      decision: 'block',
      reasonCode: 'SEXUAL_CONTENT_RISK',
      userMessage: 'Der gewählte Startframe wurde wegen sexualisiertem/NSFW-Risiko blockiert.',
      remediation: 'Nutze ein sicheres, markenkonformes Motiv (Produkt, Ladenfront, Hände bei der Arbeit).',
      matchedSignals
    };
  }

  if (publicFigurePattern.test(textCorpus) && hasHumanSignal) {
    matchedSignals.push('PUBLIC_FIGURE_KEYWORDS');
    return {
      decision: 'fallback',
      reasonCode: 'PUBLIC_FIGURE_NEEDS_FALLBACK',
      userMessage: 'Public-Figure-Referenz erkannt. Wir wechseln auf einen sicheren nicht-personenbasierten Startframe.',
      remediation: 'Entferne Public-Figure-Bezüge oder nutze eigenes, rechtegeklärtes Material.',
      effectiveStartFrameStyle: 'product_macro',
      effectiveStartFrameLabel: startFrameLabelByStyle.product_macro,
      effectiveStartFramePrompt: startFramePromptByStyle.product_macro,
      matchedSignals
    };
  }

  if (hasUpload && hasHumanSignal && !hasRightsSignal) {
    matchedSignals.push('HUMAN_UPLOAD_WITHOUT_RIGHTS_SIGNAL');
    return {
      decision: 'fallback',
      reasonCode: 'HUMAN_REFERENCE_NEEDS_FALLBACK',
      userMessage: 'Personenbezug im Upload erkannt ohne klaren Rights-Hinweis. Sicherer Fallback wird verwendet.',
      remediation: 'Optional: Rights/Einwilligung im Hinweis angeben oder nicht-personenbasierten Startframe verwenden.',
      effectiveStartFrameStyle: 'hands_at_work',
      effectiveStartFrameLabel: startFrameLabelByStyle.hands_at_work,
      effectiveStartFramePrompt: startFramePromptByStyle.hands_at_work,
      matchedSignals
    };
  }

  return {
    decision: 'allow',
    reasonCode: 'PASSED',
    userMessage: 'Startframe-Policy-Preflight bestanden.',
    remediation: 'Keine Aktion erforderlich.',
    matchedSignals
  };
};
