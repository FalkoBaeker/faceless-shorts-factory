const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

export type RunPlan = {
  targetSeconds: 30 | 60;
  segments: readonly (8 | 12)[];
  trimToSeconds: 30 | 60;
};

export const buildRunPlan = (variantType: 'SHORT_15' | 'MASTER_30'): RunPlan => {
  if (variantType === 'MASTER_30' && premium60Enabled()) {
    return { targetSeconds: 60, segments: [12, 12, 12, 12, 12] as const, trimToSeconds: 60 };
  }
  return { targetSeconds: 30, segments: [12, 12, 8] as const, trimToSeconds: 30 };
};
