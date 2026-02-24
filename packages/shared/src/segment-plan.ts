import type { SegmentSeconds, VariantType } from './video-job';

export type SegmentPlan = {
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
  targetSeconds: 15 | 30;
  plannedSeconds: number;
  trimToSeconds: 15 | 30;
  segments: SegmentSeconds[];
};

export function buildSegmentPlan(variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>): SegmentPlan {
  if (variantType === 'SHORT_15') {
    return {
      variantType,
      targetSeconds: 15,
      plannedSeconds: 16,
      trimToSeconds: 15,
      segments: [8, 8]
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
