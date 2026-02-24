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
  plannedSeconds: 16 | 32;
  finalSeconds: 15 | 30;
  segmentPattern: '8+8' | '12+12+8';
  tier: 'STANDARD' | 'PREMIUM';
};

export const variantCards: VariantCard[] = [
  {
    type: 'SHORT_15',
    title: '15s Short',
    subtitle: 'Schnell und günstig',
    plannedSeconds: 16,
    finalSeconds: 15,
    segmentPattern: '8+8',
    tier: 'STANDARD'
  },
  {
    type: 'MASTER_30',
    title: '30s Master',
    subtitle: 'Mehr Inhalt + optionaler 15s Cutdown',
    plannedSeconds: 32,
    finalSeconds: 30,
    segmentPattern: '12+12+8',
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
