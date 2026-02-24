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
