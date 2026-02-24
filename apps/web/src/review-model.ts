import type { VariantType } from './wizard-model.ts';

export type ReviewPayload = {
  projectId: string;
  jobId: string;
  variantType: VariantType;
  status: 'READY' | 'FAILED';
  caption: string;
  hashtags: string[];
  ctaText: string;
  postTargets: Array<'tiktok' | 'instagram' | 'youtube'>;
  downloadUrl?: string;
};

export const buildDefaultReviewPayload = (input: {
  projectId: string;
  jobId: string;
  variantType: VariantType;
  topic: string;
  city?: string;
}): ReviewPayload => ({
  projectId: input.projectId,
  jobId: input.jobId,
  variantType: input.variantType,
  status: 'READY',
  caption: `${input.topic}: In 30 Sekunden die wichtigsten Schritte.`,
  hashtags: ['#lokal', '#service', '#facelessshorts'],
  ctaText: input.city ? `Jetzt Termin in ${input.city} anfragen` : 'Jetzt Termin anfragen',
  postTargets: ['tiktok', 'instagram']
});
