import { buildDefaultReviewPayload } from '../../src/review-model';
import { getVariantCard, variantCards, wizardSteps, type VariantType } from '../../src/wizard-model';

export const selectedVariantType: VariantType = 'MASTER_30';
export const selectedVariant = getVariantCard(selectedVariantType);
export const availableVariants = variantCards;
export const wizardStepList = wizardSteps;

export const wizardOverviewCards = [
  {
    title: 'Input & Briefing',
    description: 'Branche, Ort, Tonalität und Zielgruppe in weniger als 60 Sekunden erfassen.',
    stepRange: 'onboarding → input'
  },
  {
    title: 'Ideation & Storyboard',
    description: 'Script + Shotplan automatisch erzeugen und vor dem Rendern in Ruhe prüfen.',
    stepRange: 'ideation → storyboard'
  },
  {
    title: 'Review & Publish',
    description: 'Caption, Hashtags und Zielkanäle kontrollieren und dann direkt veröffentlichen.',
    stepRange: 'review → publish'
  }
] as const;

export const reviewMock = buildDefaultReviewPayload({
  projectId: 'proj_demo_20260225',
  jobId: 'job_demo_20260225',
  variantType: selectedVariant.type,
  topic: '5 Tipps gegen verstopfte Abflüsse',
  city: 'Berlin'
});

export type JobUiState = 'loading' | 'empty' | 'progress' | 'ready' | 'error';

export const jobStateOrder: JobUiState[] = ['loading', 'empty', 'progress', 'ready', 'error'];

export const jobStateLabels: Record<JobUiState, string> = {
  loading: 'Loading',
  empty: 'Empty',
  progress: 'Progress',
  ready: 'Ready',
  error: 'Error'
};

export const productionProgressEvents = [
  { label: 'Prompt & Skript validiert', status: 'done', time: '22:02' },
  { label: 'Storyboard Frames gerendert', status: 'done', time: '22:04' },
  { label: 'Voiceover in Arbeit', status: 'active', time: '22:06' },
  { label: 'Assembly & Captions', status: 'queued', time: 'queued' }
] as const;

export const queueMetricsMock = {
  queueDepth: 3,
  avgRenderTimeSec: 148,
  retryBudgetLeft: 2,
  provider: 'openai + elevenlabs'
};

export const wizardMeta = {
  totalSteps: wizardSteps.length,
  availableVariants: variantCards.length,
  primaryUseCase: 'Local SMB Marketing'
};
