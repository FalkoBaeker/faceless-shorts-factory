export type VariantType = 'SHORT_15' | 'MASTER_30' | 'CUTDOWN_15_FROM_30';

export type SegmentSeconds = 4 | 8 | 12;

export type VideoJobStatus =
  | 'DRAFT'
  | 'IDEATION_PENDING'
  | 'IDEATION_READY'
  | 'STORYBOARD_PENDING'
  | 'STORYBOARD_READY'
  | 'SELECTED'
  | 'VIDEO_PENDING'
  | 'AUDIO_PENDING'
  | 'ASSEMBLY_PENDING'
  | 'RENDERING'
  | 'READY'
  | 'PUBLISH_PENDING'
  | 'PUBLISHED'
  | 'FAILED';
