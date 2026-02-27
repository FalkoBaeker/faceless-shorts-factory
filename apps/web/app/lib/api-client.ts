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

export type ScriptDraftPayload = {
  script: string;
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
};

export type StartFrameCandidatesPayload = {
  candidates: StartFrameCandidatePayload[];
};

export type JobPayload = {
  jobId: string;
  status: string;
  timeline: Array<{ at: string; event: string; detail?: string }>;
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
    method?: 'GET' | 'POST';
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
    moodPreset: 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';
  }
) =>
  requestJson<ScriptDraftPayload>('/v1/script/draft', {
    method: 'POST',
    token,
    body: payload
  });

export const createStartFrameCandidates = (
  token: string,
  payload: {
    topic: string;
    conceptId: string;
    moodPreset: 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';
    limit?: number;
  }
) =>
  requestJson<StartFrameCandidatesPayload>('/v1/startframes/candidates', {
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
    moodPreset: 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';
    approvedScript: string;
    startFrameCandidateId: string;
    startFrameStyle?:
      | 'storefront_hero'
      | 'product_macro'
      | 'owner_portrait'
      | 'hands_at_work'
      | 'before_after_split';
  }
) =>
  requestJson<SelectConceptPayload>(`/v1/projects/${projectId}/select`, {
    method: 'POST',
    token,
    body: {
      conceptId: payload.conceptId,
      moodPreset: payload.moodPreset,
      approvedScript: payload.approvedScript,
      startFrameCandidateId: payload.startFrameCandidateId,
      startFrameStyle: payload.startFrameStyle,
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
