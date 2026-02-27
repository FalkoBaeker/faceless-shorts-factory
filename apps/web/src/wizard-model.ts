export const wizardSteps = [
  'onboarding',
  'input',
  'ideation',
  'storyboard',
  'selection',
  'generation',
  'review',
  'publish'
] as const;

export type WizardStep = (typeof wizardSteps)[number];

export type VariantType = 'SHORT_15' | 'MASTER_30';

export type VariantCard = {
  type: VariantType;
  title: string;
  subtitle: string;
  plannedSeconds: 32 | 64;
  finalSeconds: 30 | 60;
  segmentPattern: '12+12+8' | '12x5';
  tier: 'STANDARD' | 'PREMIUM';
};

export const variantCards: VariantCard[] = [
  {
    type: 'SHORT_15',
    title: '30s Standard',
    subtitle: 'Besseres Story-Pacing für den Kern-Flow',
    plannedSeconds: 32,
    finalSeconds: 30,
    segmentPattern: '12+12+8',
    tier: 'STANDARD'
  },
  {
    type: 'MASTER_30',
    title: '60s Premium',
    subtitle: 'Mehr Tiefe und Narrative, optional per Feature-Flag',
    plannedSeconds: 64,
    finalSeconds: 60,
    segmentPattern: '12x5',
    tier: 'PREMIUM'
  }
];

export type CreateProjectInput = {
  organizationId: string;
  topic: string;
  language: string;
  voice: string;
  variantType: VariantType;
};

export const buildCreateProjectPayload = (input: CreateProjectInput) => ({
  organizationId: input.organizationId,
  topic: input.topic,
  language: input.language,
  voice: input.voice,
  variantType: input.variantType
});

export const getVariantCard = (variantType: VariantType) => {
  const card = variantCards.find((v) => v.type === variantType);
  if (!card) throw new Error(`VARIANT_NOT_FOUND:${variantType}`);
  return card;
};
