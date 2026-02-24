import { buildSegmentPlan } from '../../../packages/shared/src/segment-plan';
import { buildSegmentKey } from '../../../packages/shared/src/segment-key';

export type SegmentTask = {
  segmentIndex: number;
  seconds: 4 | 8 | 12;
  segmentKey: string;
};

export type OrchestrationPlan = {
  projectId: string;
  variantType: 'SHORT_15' | 'MASTER_30';
  targetSeconds: 15 | 30;
  trimToSeconds: 15 | 30;
  tasks: SegmentTask[];
};

export const buildOrchestrationPlan = (input: {
  projectId: string;
  variantType: 'SHORT_15' | 'MASTER_30';
  model: string;
  size: string;
  prompt: string;
  inputReferenceHash?: string;
}): OrchestrationPlan => {
  const plan = buildSegmentPlan(input.variantType);

  const tasks = plan.segments.map((seconds, idx) => ({
    segmentIndex: idx,
    seconds,
    segmentKey: buildSegmentKey({
      projectId: input.projectId,
      variantType: input.variantType,
      segmentIndex: idx,
      model: input.model,
      seconds,
      size: input.size,
      prompt: input.prompt,
      inputReferenceHash: input.inputReferenceHash
    })
  }));

  return {
    projectId: input.projectId,
    variantType: input.variantType,
    targetSeconds: plan.targetSeconds,
    trimToSeconds: plan.trimToSeconds,
    tasks
  };
};
