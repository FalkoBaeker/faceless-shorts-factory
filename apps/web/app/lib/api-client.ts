export type AuthSessionPayload = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  requiresEmailConfirmation: boolean;
  user: {
    id: string;
    email: string;
    plan: 'free' | 'beta' | 'pro';
    subscriptionStatus: 'inactive' | 'trialing' | 'active' | 'canceled';
    allowlisted: boolean;
  };
  canRunJob: boolean;
  reason: string;
};

export type AuthMePayload = {
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

export type CreateProjectPayload = {
  projectId: string;
  status: string;
  createdAt: string;
};

export type SelectConceptPayload = {
  jobId: string;
  creditReservationStatus: 'RESERVED';
  estimatedSeconds: 30 | 60;
};

export type ScriptV2Payload = {
  language?: string;
  openingHook?: string;
  narration?: string;
  scenes: Array<{
    order: number;
    action: string;
    lines?: Array<{
      speaker: string;
      text: string;
      tone?: string;
      startHintSeconds?: number;
      endHintSeconds?: number;
    }>;
    onScreenText?: string;
  }>;
};

export type ScriptDraftPayload = {
  script: string;
  scriptV2?: ScriptV2Payload;
  targetSeconds: number;
  estimatedSeconds: number;
  withinTarget: boolean;
  suggestedWords: number;
};

export type StartFrameCandidatePayload = {
  candidateId: string;
  style: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
  label: string;
  description: string;
  prompt: string;
  thumbnailUrl: string;
  thumbnailObjectPath?: string;
};

export type StartFrameCandidatesPayload = {
  candidates: StartFrameCandidatePayload[];
};

export type UserControlsPayload = {
  ctaStrength: 'soft' | 'balanced' | 'strong';
  motionIntensity: 'low' | 'medium' | 'high';
  shotPace: 'relaxed' | 'balanced' | 'fast';
  visualStyle: 'clean' | 'cinematic' | 'ugc';
};

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

export type CreativeIntentPayload = {
  effectGoals: Array<CreativeIntentSelection<CreativeEffectGoal>>;
  narrativeFormats: Array<CreativeIntentSelection<CreativeNarrativeFormat>>;
  energyMode?: 'auto' | 'high' | 'calm';
  shotStyles?: Array<CreativeIntentSelection<ShotStyleTag>>;
};

export type GenerationPayloadV1 = {
  topic: string;
  brandProfile: BrandProfilePayload;
  creativeIntent: {
    effectGoals: Array<CreativeIntentSelection<CreativeEffectGoalV1>>;
    narrativeFormats: Array<CreativeIntentSelection<CreativeNarrativeFormat>>;
    shotStyles?: Array<CreativeIntentSelection<ShotStyleTag>>;
    energyMode?: 'auto' | 'high' | 'calm';
  };
  startFrame?: {
    style?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
    candidateId?: string;
    customPrompt?: string;
    uploadObjectPath?: string;
    referenceHint?: string;
    summary?: string;
  };
  userEditedFlowScript?: string;
};

export type StoryboardBeatPayload = {
  beatId: string;
  order: number;
  action: string;
  visualHint?: string;
  dialogueHint?: string;
  onScreenTextHint?: string;
};

export type StoryboardLightPayload = {
  beats: StoryboardBeatPayload[];
  hookHint?: string;
  ctaHint?: string;
  pacingHint?: string;
};

export type BrandProfilePayload = {
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

export type BrandProfileResponsePayload = {
  organizationId: string;
  profile: BrandProfilePayload | null;
  updatedAt?: string;
};

export type StartFrameUploadPayload = {
  assetId: string;
  objectPath: string;
  signedUrl: string;
  bytes: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type StartFramePreflightPayload = {
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

export type JobStatus =
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

export type JobPayload = {
  jobId: string;
  status: JobStatus;
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

export type JobAssetsPayload = {
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

export type ApiError = {
  status: number;
  message: string;
};

const apiBase = () => (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const parseApiError = async (res: Response): Promise<ApiError> => {
  const text = await res.text();
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    message = parsed.error ?? message;
  } catch {
    // noop
  }
  return { status: res.status, message: message || `HTTP_${res.status}` };
};

const requestJson = async <T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: Record<string, unknown>;
    token?: string | null;
  }
): Promise<T> => {
  const res = await fetch(`${apiBase()}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options?.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store'
  });

  if (!res.ok) {
    throw await parseApiError(res);
  }

  return (await res.json()) as T;
};

export const signUp = (email: string, password: string) =>
  requestJson<AuthSessionPayload>('/v1/auth/signup', {
    method: 'POST',
    body: { email, password }
  });

export const login = (email: string, password: string) =>
  requestJson<AuthSessionPayload>('/v1/auth/login', {
    method: 'POST',
    body: { email, password }
  });

export const fetchMe = (token?: string | null) =>
  requestJson<AuthMePayload>('/v1/auth/me', {
    method: 'GET',
    token
  });

export const fetchBrandProfile = (token: string, organizationId: string) =>
  requestJson<BrandProfileResponsePayload>(`/v1/brands/${encodeURIComponent(organizationId)}`, {
    method: 'GET',
    token
  });

export const upsertBrandProfile = (token: string, organizationId: string, profile: BrandProfilePayload) =>
  requestJson<BrandProfileResponsePayload>(`/v1/brands/${encodeURIComponent(organizationId)}`, {
    method: 'PUT',
    token,
    body: profile
  });

export const createProject = (token: string, payload: { organizationId: string; topic: string; variantType: 'SHORT_15' | 'MASTER_30' }) =>
  requestJson<CreateProjectPayload>('/v1/projects', {
    method: 'POST',
    token,
    body: {
      organizationId: payload.organizationId,
      topic: payload.topic,
      language: 'de',
      voice: 'de_female_01',
      variantType: payload.variantType
    }
  });

export const createScriptDraft = (
  token: string,
  payload: {
    topic: string;
    variantType: 'SHORT_15' | 'MASTER_30';
    organizationId?: string;
    moodPreset: MoodPreset;
    creativeIntent?: CreativeIntentPayload;
    brandProfile?: BrandProfilePayload;
    startFrameStyle?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
    startFrameCandidateId?: string;
    startFrameCustomPrompt?: string;
    startFrameReferenceHint?: string;
    startFrameImageUrl?: string;
    startFrameUploadObjectPath?: string;
    startFrameSummary?: string;
  }
) =>
  requestJson<ScriptDraftPayload>('/v1/script/draft', {
    method: 'POST',
    token,
    body: payload
  });

export const uploadStartFrameReference = (
  token: string,
  payload: {
    organizationId: string;
    fileName: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    imageBase64: string;
  }
) =>
  requestJson<StartFrameUploadPayload>('/v1/startframes/upload', {
    method: 'POST',
    token,
    body: payload
  });

export const createStartFrameCandidates = (
  token: string,
  payload: {
    topic: string;
    organizationId?: string;
    conceptId: string;
    moodPreset: MoodPreset;
    creativeIntent?: CreativeIntentPayload;
    brandProfile?: BrandProfilePayload;
    limit?: number;
  }
) =>
  requestJson<StartFrameCandidatesPayload>('/v1/startframes/candidates', {
    method: 'POST',
    token,
    body: payload
  });

export const preflightStartFrame = (
  token: string,
  payload: {
    topic: string;
    conceptId: string;
    startFrameCandidateId?: string;
    startFrameStyle?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
    startFrameCustomPrompt?: string;
    startFrameReferenceHint?: string;
    startFrameUploadObjectPath?: string;
  }
) =>
  requestJson<StartFramePreflightPayload>('/v1/startframes/preflight', {
    method: 'POST',
    token,
    body: payload
  });

export const selectConcept = (
  token: string,
  projectId: string,
  payload: {
    variantType: 'SHORT_15' | 'MASTER_30';
    conceptId: string;
    moodPreset: MoodPreset;
    creativeIntent?: CreativeIntentPayload;
    generationPayload?: GenerationPayloadV1;
    storyboardLight?: StoryboardLightPayload;
    brandProfile?: BrandProfilePayload;
    approvedScript: string;
    approvedScriptV2?: ScriptV2Payload;
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
    userControls?: UserControlsPayload;
  }
) =>
  requestJson<SelectConceptPayload>(`/v1/projects/${projectId}/select`, {
    method: 'POST',
    token,
    body: {
      conceptId: payload.conceptId,
      moodPreset: payload.moodPreset,
      creativeIntent: payload.creativeIntent,
      generationPayload: payload.generationPayload,
      storyboardLight: payload.storyboardLight,
      brandProfile: payload.brandProfile,
      approvedScript: payload.approvedScript,
      approvedScriptV2: payload.approvedScriptV2,
      startFrameCandidateId: payload.startFrameCandidateId,
      startFrameStyle: payload.startFrameStyle,
      startFrameCustomLabel: payload.startFrameCustomLabel,
      startFrameCustomPrompt: payload.startFrameCustomPrompt,
      startFrameReferenceHint: payload.startFrameReferenceHint,
      startFrameUploadObjectPath: payload.startFrameUploadObjectPath,
      audioMode: payload.audioMode,
      userControls: payload.userControls,
      variantType: payload.variantType
    }
  });

export const triggerGenerate = (token: string, projectId: string, jobId: string) =>
  requestJson<JobPayload>(`/v1/projects/${projectId}/generate`, {
    method: 'POST',
    token,
    body: { jobId }
  });

export const fetchJob = (token: string, jobId: string) =>
  requestJson<JobPayload>(`/v1/jobs/${jobId}`, {
    method: 'GET',
    token
  });

export const fetchJobAssets = (token: string, jobId: string) =>
  requestJson<JobAssetsPayload>(`/v1/jobs/${jobId}/assets`, {
    method: 'GET',
    token
  });

export const triggerAlertTest = (token: string) =>
  requestJson<{ ok: boolean; sent: boolean; target: 'email' | 'logs'; detail: string }>('/v1/admin/alerts/test', {
    method: 'POST',
    token
  });
