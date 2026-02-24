import { buildOrchestrationPlan } from './orchestrator.ts';

const plan = buildOrchestrationPlan({
  projectId: 'proj_demo_master30',
  variantType: 'MASTER_30',
  model: 'sora-2-pro',
  size: '720x1280',
  prompt: 'Faceless local business promo, clean cinematic b-roll, dynamic captions area',
  inputReferenceHash: 'img_ref_001'
});

console.log(
  JSON.stringify(
    {
      variantType: plan.variantType,
      targetSeconds: plan.targetSeconds,
      trimToSeconds: plan.trimToSeconds,
      taskCount: plan.tasks.length,
      segments: plan.tasks.map((t) => ({ idx: t.segmentIndex, sec: t.seconds, key: t.segmentKey.slice(0, 12) }))
    },
    null,
    2
  )
);
