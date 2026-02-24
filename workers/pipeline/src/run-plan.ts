export type RunPlan = {
  targetSeconds: 15 | 30;
  segments: readonly (4 | 8 | 12)[];
  trimToSeconds: 15 | 30;
};

export const buildRunPlan = (variantType: 'SHORT_15' | 'MASTER_30'): RunPlan =>
  variantType === 'SHORT_15'
    ? { targetSeconds: 15, segments: [8, 8] as const, trimToSeconds: 15 }
    : { targetSeconds: 30, segments: [12, 12, 8] as const, trimToSeconds: 30 };
