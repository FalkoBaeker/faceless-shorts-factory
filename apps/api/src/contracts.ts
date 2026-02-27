export type VariantType = 'SHORT_15' | 'MASTER_30' | 'CUTDOWN_15_FROM_30';

export type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

export type UserControlProfile = {
  ctaStrength?: 'soft' | 'balanced' | 'strong';
  motionIntensity?: 'low' | 'medium' | 'high';
  shotPace?: 'relaxed' | 'balanced' | 'fast';
  visualStyle?: 'clean' | 'cinematic' | 'ugc';
};

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
  moodPreset?: MoodPreset;
  approvedScript?: string;
  startFrameCandidateId?: string;
  startFrameStyle?:
    | 'storefront_hero'
    | 'product_macro'
    | 'owner_portrait'
    | 'hands_at_work'
    | 'before_after_split';
  startFrameCustomLabel?: string;
  startFrameCustomPrompt?: string;
  startFrameReferenceHint?: string;
  startFrameUploadObjectPath?: string;
  userControls?: UserControlProfile;
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
};

export type SelectConceptResponse = {
  jobId: string;
  creditReservationStatus: 'RESERVED';
  estimatedSeconds: 30 | 60;
};

export type ScriptDraftRequest = {
  topic: string;
  variantType: Extract<VariantType, 'SHORT_15' | 'MASTER_30'>;
  moodPreset?: MoodPreset;
};

export type ScriptDraftResponse = {
  script: string;
  targetSeconds: number;
  estimatedSeconds: number;
  withinTarget: boolean;
  suggestedWords: number;
};

export type StartFrameUploadRequest = {
  organizationId: string;
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  imageBase64: string;
};

export type StartFrameUploadResponse = {
  assetId: string;
  objectPath: string;
  signedUrl: string;
  bytes: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type StartFrameCandidatesRequest = {
  topic: string;
  conceptId?: string;
  moodPreset?: MoodPreset;
  limit?: number;
};

export type StartFrameCandidatesResponse = {
  candidates: Array<{
    candidateId: string;
    style: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
    label: string;
    description: string;
    prompt: string;
    thumbnailUrl: string;
  }>;
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

export type LedgerResponse = {
  organizationId: string;
  balance: number;
  entries: Array<{
    id: string;
    type: 'TOPUP' | 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'MANUAL_ADJUSTMENT';
    amount: number;
    jobId?: string;
    createdAt: string;
    note?: string;
  }>;
};

export type PublishResponse = {
  jobId: string;
  status: 'PUBLISH_PENDING' | 'PUBLISHED';
  targets: Array<'tiktok' | 'instagram' | 'youtube'>;
  posts: Array<{ target: 'tiktok' | 'instagram' | 'youtube'; postUrl: string }>;
};

export type AdminSnapshotResponse = {
  totals: {
    projects: number;
    jobs: number;
    jobsReady: number;
    jobsFailed: number;
    jobsPublished: number;
    ledgerEntries: number;
  };
  providerHealth: {
    sora: 'green' | 'yellow' | 'red';
    tts: 'green' | 'yellow' | 'red';
    render: 'green' | 'yellow' | 'red';
    publish: 'green' | 'yellow' | 'red';
  };
};

export type AuthMeResponse = {
  authenticated: boolean;
  authRequired: boolean;
  canRunJob: boolean;
  reason: string;
  user?: {
    id: string;
    email: string;
    plan: 'free' | 'beta' | 'pro';
    subscriptionStatus: 'inactive' | 'trialing' | 'active' | 'canceled';
    allowlisted: boolean;
    creditsRemaining: number | null;
    monthlyJobLimit: number | null;
    jobsUsed: number;
  };
};

export type AlertTestResponse = {
  ok: boolean;
  sent: boolean;
  target: 'email' | 'logs';
  detail: string;
};

export type JobAssetsResponse = {
  jobId: string;
  ready: boolean;
  assets: Array<{
    event: string;
    kind: string;
    objectPath: string;
    signedUrl: string;
    bytes: number | null;
    mimeType: string | null;
    provider: string | null;
  }>;
};
