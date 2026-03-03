export type VariantType = 'SHORT_15' | 'MASTER_30' | 'CUTDOWN_15_FROM_30';

export type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

export type CreativeEffectGoal =
  | 'sell_conversion'
  | 'funny'
  | 'cringe_hook'
  | 'testimonial_trust'
  | 'urgency_offer';

export type CreativeEffectGoalV1 = Exclude<CreativeEffectGoal, 'cringe_hook'>;

export type CreativeNarrativeFormat =
  | 'before_after'
  | 'dialog'
  | 'offer_focus'
  | 'commercial'
  | 'problem_solution';

export type ShotStyleTag =
  | 'cinematic_closeup'
  | 'over_shoulder'
  | 'handheld_push'
  | 'product_macro'
  | 'wide_establishing'
  | 'fast_cut_montage';

export type AudioMode = 'voiceover' | 'scene' | 'hybrid';

export type CreativeIntentSelection<T extends string = string> = {
  id: T;
  weight?: number;
  priority?: 1 | 2 | 3;
};

export type CreativeIntentMatrix = {
  effectGoals: Array<CreativeIntentSelection<CreativeEffectGoal>>;
  narrativeFormats: Array<CreativeIntentSelection<CreativeNarrativeFormat>>;
  energyMode?: 'auto' | 'high' | 'calm';
  shotStyles?: Array<CreativeIntentSelection<ShotStyleTag>>;
};

export type StoryboardBeat = {
  beatId: string;
  order: number;
  action: string;
  visualHint?: string;
  dialogueHint?: string;
  onScreenTextHint?: string;
};

export type StoryboardLight = {
  beats: StoryboardBeat[];
  hookHint?: string;
  ctaHint?: string;
  pacingHint?: string;
};

export type ScriptDialogLine = {
  speaker: string;
  text: string;
  tone?: string;
  startHintSeconds?: number;
  endHintSeconds?: number;
};

export type ScriptSceneBlock = {
  order: number;
  action: string;
  lines?: ScriptDialogLine[];
  onScreenText?: string;
};

export type ScriptV2 = {
  language?: string;
  openingHook?: string;
  narration?: string;
  scenes: ScriptSceneBlock[];
};

/** @deprecated legacy controls; replaced by creativeIntent + storyboardLight */
export type UserControlProfile = {
  ctaStrength?: 'soft' | 'balanced' | 'strong';
  motionIntensity?: 'low' | 'medium' | 'high';
  shotPace?: 'relaxed' | 'balanced' | 'fast';
  visualStyle?: 'clean' | 'cinematic' | 'ugc';
};

export type BrandProfile = {
  companyName: string;
  websiteUrl?: string;
  logoUrl?: string;
  brandTone?: string;
  primaryColorHex?: string;
  secondaryColorHex?: string;
  ctaStyle?: 'soft' | 'balanced' | 'strong';
  audienceHint?: string;
  valueProposition?: string;
};

export type StartFrameInputV1 = {
  style?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
  candidateId?: string;
  customPrompt?: string;
  uploadObjectPath?: string;
  referenceHint?: string;
  summary?: string;
};

export type GenerationPayloadV1 = {
  topic: string;
  brandProfile: BrandProfile;
  creativeIntent: {
    effectGoals: Array<CreativeIntentSelection<CreativeEffectGoalV1>>;
    narrativeFormats: Array<CreativeIntentSelection<CreativeNarrativeFormat>>;
    shotStyles?: Array<CreativeIntentSelection<ShotStyleTag>>;
    energyMode?: 'auto' | 'high' | 'calm';
  };
  startFrame?: StartFrameInputV1;
  userEditedFlowScript?: string;
};

export type VideoPlanV1 = {
  hookOpening: string;
  flowBeats: Array<{
    order: number;
    beat: string;
    visualHint?: string;
    onScreenTextHint?: string;
  }>;
  script: {
    narration: string;
    scenes: Array<{
      order: number;
      action: string;
      lines?: Array<{
        speaker: string;
        text: string;
      }>;
      onScreenText?: string;
    }>;
  };
  subjectConstraints: string[];
  promptDirectives: string[];
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
  creativeIntent?: CreativeIntentMatrix;
  storyboardLight?: StoryboardLight;
  brandProfile?: BrandProfile;
  generationPayload?: GenerationPayloadV1;
  approvedScript?: string;
  approvedScriptV2?: ScriptV2;
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
  audioMode?: AudioMode;
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
  organizationId?: string;
  moodPreset?: MoodPreset;
  creativeIntent?: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
  startFrameStyle?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
  startFrameCandidateId?: string;
  startFrameCustomPrompt?: string;
  startFrameReferenceHint?: string;
  startFrameImageUrl?: string;
  startFrameUploadObjectPath?: string;
  startFrameSummary?: string;
};

export type ScriptDraftResponse = {
  script: string;
  scriptV2?: ScriptV2;
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
  organizationId?: string;
  conceptId?: string;
  moodPreset?: MoodPreset;
  creativeIntent?: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
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
    thumbnailObjectPath?: string;
  }>;
};

export type StartFramePreflightRequest = {
  topic: string;
  conceptId?: string;
  startFrameCandidateId?: string;
  startFrameStyle?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
  startFrameCustomPrompt?: string;
  startFrameReferenceHint?: string;
  startFrameUploadObjectPath?: string;
};

export type StartFramePreflightResponse = {
  decision: 'allow' | 'fallback' | 'block';
  reasonCode: string;
  userMessage: string;
  remediation: string;
  source: 'uploaded_asset' | 'generated_candidate' | 'none';
  precedenceRuleApplied: 'UPLOAD_WINS_OVER_CANDIDATE';
  effectiveStartFrameStyle?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
  effectiveStartFrameLabel?: string;
  matchedSignals: string[];
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
  billing?: {
    reservation: {
      reserved: boolean;
      at: string | null;
    };
    finalization: {
      state: 'PENDING' | 'COMMITTED' | 'RELEASED';
      at: string | null;
      note: string | null;
    };
    entries: Array<{
      id: string;
      type: 'TOPUP' | 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'MANUAL_ADJUSTMENT';
      amount: number;
      jobId?: string;
      createdAt: string;
      note?: string;
    }>;
  };
  explainability?: {
    intentRules: string[];
    hookRule: string | null;
    hookTemplateId?: string | null;
    firstSecondQualityThreshold?: 'strict' | 'relaxed' | null;
    shotStyleSet: ShotStyleTag[];
    safetyConstraints: string[];
    calmExceptionApplied: boolean;
    imageModel?: {
      configuredPrimaryModel: string | null;
      configuredFallbackModel: string | null;
      attemptedModels: string[];
      modelUsed: string | null;
      fallbackUsed: boolean;
    } | null;
  };
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

export type BrandProfileResponse = {
  organizationId: string;
  profile: BrandProfile | null;
  updatedAt?: string;
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
