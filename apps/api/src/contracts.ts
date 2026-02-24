export type VariantType = 'SHORT_15' | 'MASTER_30' | 'CUTDOWN_15_FROM_30';

export type CreateProjectRequest = {
  organizationId: string;
  topic: string;
  language: string;
  voice: string;
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
};

export type CreateProjectResponse = {
  projectId: string;
  status: 'DRAFT' | 'IDEATION_PENDING';
  createdAt: string;
};

export type SelectConceptRequest = {
  projectId: string;
  conceptId: string;
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
};

export type SelectConceptResponse = {
  jobId: string;
  creditReservationStatus: 'RESERVED';
  estimatedSeconds: 16 | 32;
};

export type JobStatusResponse = {
  jobId: string;
  status:
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
  timeline: Array<{ at: string; event: string; detail?: string }>;
};
