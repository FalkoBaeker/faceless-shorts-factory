import type { SegmentSeconds, VariantType } from './video-job.ts';

const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

export type SegmentPlan = {
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
  targetSeconds: 30 | 60;
  plannedSeconds: number;
  trimToSeconds: 30 | 60;
  segments: SegmentSeconds[];
};

export function buildSegmentPlan(variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>): SegmentPlan {
  if (variantType === 'MASTER_30' && premium60Enabled()) {
    return {
      variantType,
      targetSeconds: 60,
      plannedSeconds: 64,
      trimToSeconds: 60,
      segments: [12, 12, 12, 12, 12]
    };
  }

  return {
    variantType,
    targetSeconds: 30,
    plannedSeconds: 32,
    trimToSeconds: 30,
    segments: [12, 12, 8]
  };
}
