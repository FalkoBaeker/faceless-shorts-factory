import { buildCreateProjectPayload, getVariantCard, wizardSteps } from './wizard-model.ts';
import { buildDefaultReviewPayload } from './review-model.ts';

const payload = buildCreateProjectPayload({
  organizationId: 'org_web_demo',
  topic: 'Rohr verstopft',
  language: 'de',
  voice: 'de_female_01',
  variantType: 'MASTER_30'
});

const variant = getVariantCard(payload.variantType);

const review = buildDefaultReviewPayload({
  projectId: 'proj_web_001',
  jobId: 'job_web_001',
  variantType: payload.variantType,
  topic: payload.topic,
  city: 'Rangsdorf'
});

console.log(
  JSON.stringify(
    {
      stepCount: wizardSteps.length,
      selectedVariant: variant.type,
      plannedSeconds: variant.plannedSeconds,
      finalSeconds: variant.finalSeconds,
      segmentPattern: variant.segmentPattern,
      reviewTargets: review.postTargets,
      reviewHashtagsCount: review.hashtags.length
    },
    null,
    2
  )
);
