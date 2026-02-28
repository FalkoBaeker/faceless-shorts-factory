import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvFiles } from '../config/env-loader.ts';
import {
  normalizeUserControlProfile,
  normalizeCreativeIntent,
  deriveLegacyMoodPresetFromIntent,
  normalizeStoryboardLight,
  type UserControlProfile,
  type CreativeIntentMatrix,
  type StoryboardLight,
  type ShotStyleTag
} from '../services/creative-consistency.ts';
import { logEvent } from '../utils/app-logger.ts';

loadEnvFiles();

type Health = 'green' | 'yellow' | 'red';

type ProviderHealthSnapshot = {
  sora: Health;
  tts: Health;
  render: Health;
  publish: Health;
};

export type StoredAsset = {
  objectPath: string;
  signedUrl: string;
  bytes: number;
  mimeType: string;
  provider: string;
};

class ProviderRuntimeError extends Error {
  readonly fatal: boolean;
  readonly provider: string;
  readonly status?: number;

  constructor(message: string, options: { provider: string; fatal?: boolean; status?: number }) {
    super(message);
    this.name = 'ProviderRuntimeError';
    this.provider = options.provider;
    this.fatal = Boolean(options.fatal);
    this.status = options.status;
  }
}

const health: ProviderHealthSnapshot = {
  sora: 'yellow',
  tts: 'yellow',
  render: 'yellow',
  publish: 'green'
};

let healthCheckedAt = 0;
const healthCacheMs = Number(process.env.PROVIDER_HEALTH_CACHE_MS ?? 900000);

const rpmWindows: Record<'llm' | 'tts' | 'video', number[]> = {
  llm: [],
  tts: [],
  video: []
};

const dailySpend = new Map<string, number>();

const cfg = {
  llmProvider: process.env.LLM_PROVIDER ?? 'openai',
  ttsProvider: process.env.TTS_PROVIDER ?? 'openai',
  storageProvider: process.env.STORAGE_PROVIDER ?? 'supabase',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  elevenApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'assets',
  dailyBudgetEur: Number(process.env.DAILY_BUDGET_EUR ?? 10),
  maxRpmLlm: Number(process.env.MAX_RPM_LLM ?? 30),
  maxRpmTts: Number(process.env.MAX_RPM_TTS ?? 10),
  maxRpmVideo: Number(process.env.MAX_RPM_VIDEO ?? 3),
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
  openaiImageModelFallback: process.env.OPENAI_IMAGE_MODEL_FALLBACK ?? 'gpt-image-1'
};

type VariantType = 'SHORT_15' | 'MASTER_30';

type VariantDurationConfig = {
  targetSeconds: number;
  sourceSeconds: number;
};

type CaptionSafeAreaConfig = {
  frameWidth: number;
  frameHeight: number;
  scale: number;
  marginRatio: number;
  marginX: number;
  marginY: number;
  safeWidth: number;
  safeHeight: number;
};

type FinalSyncPlan = {
  mode: 'passthrough' | 'pad' | 'time_stretch' | 'time_stretch_trim';
  tempo: number;
  sourceAudioSeconds: number;
  adjustedAudioSeconds: number;
  finalDurationSeconds: number;
  toleranceSeconds: number;
};

type FinalSyncMetrics = {
  mode: FinalSyncPlan['mode'];
  targetSeconds: number;
  toleranceSeconds: number;
  sourceVideoSeconds: number;
  sourceAudioSeconds: number;
  adjustedAudioSeconds: number;
  outputSeconds: number;
  tempo: number;
  avDeltaSeconds: number;
  deltaToTargetSeconds: number;
  withinTolerance: boolean;
};

type MotionAnalysis = {
  durationSeconds: number;
  sceneThreshold: number;
  motionCuts: number;
  motionPhases: number;
  longestStaticSeconds: number;
};

type MotionEnforcement = MotionAnalysis & {
  minPhasesRequired: number;
  maxStaticSecondsAllowed: number;
  withinThreshold: boolean;
  attempts: number;
};

type StartFrameStyle =
  | 'storefront_hero'
  | 'product_macro'
  | 'owner_portrait'
  | 'hands_at_work'
  | 'before_after_split';

type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

type StoryboardConceptId =
  | 'concept_web_vertical_slice'
  | 'concept_offer_focus'
  | 'concept_problem_solution'
  | 'concept_before_after'
  | 'concept_testimonial';

type StoryboardConcept = {
  id: StoryboardConceptId;
  label: string;
  videoDirection: string;
  imageDirection: string;
};

const storyboardConcepts: Record<StoryboardConceptId, StoryboardConcept> = {
  concept_web_vertical_slice: {
    id: 'concept_web_vertical_slice',
    label: 'Vertical Slice Klassiker',
    videoDirection:
      'Schneller Hook, dann 2 kurze Nutzenpunkte und klarer CTA. Jeder Shot zeigt eine andere Mikro-Szene zum Thema.',
    imageDirection: 'Klares Hero-Keyvisual in vertikalem 9:16 Frame mit zentralem Fokusobjekt.'
  },
  concept_offer_focus: {
    id: 'concept_offer_focus',
    label: 'Angebot im Fokus',
    videoDirection:
      'Eröffne mit starkem Angebots-Hook, hebe Preisvorteil/Mehrwert hervor und ende mit zeitkritischem CTA.',
    imageDirection: 'Preis/Angebot visuell dominant darstellen, hohe Lesbarkeit und sauberer Kontrast.'
  },
  concept_problem_solution: {
    id: 'concept_problem_solution',
    label: 'Problem → Lösung',
    videoDirection:
      'Starte mit typischem Kundenproblem, zeige dann die Lösung in 2 klaren Schritten und schließe mit Vertrauen/CTA.',
    imageDirection: 'Vorher/Nachher-Anmutung mit klarer Problem-Lösung-Visualisierung in einem Frame.'
  },
  concept_before_after: {
    id: 'concept_before_after',
    label: 'Vorher / Nachher',
    videoDirection:
      'Direkter Vorher-Nachher-Kontrast, danach kurzer Beweis der Wirkung und eindeutiger Handlungsaufruf.',
    imageDirection: 'Split-Komposition mit sofort erkennbarem Vorher-Nachher-Effekt.'
  },
  concept_testimonial: {
    id: 'concept_testimonial',
    label: 'Kundenstimme',
    videoDirection:
      'Beginne mit glaubwürdigem Testimonial-Zitat, stütze es durch kurze Szenenbeweise und ende mit CTA.',
    imageDirection: 'Authentischer, vertrauensbildender Keyframe mit menschlichem Fokus und Marke im Kontext.'
  }
};

const startFramePrompts: Record<StartFrameStyle, string> = {
  storefront_hero: 'Startframe: Hero-Aufnahme der Ladenfront/Marke, gut ausgeleuchtet, ruhiger Hintergrund.',
  product_macro: 'Startframe: Produkt-Makroaufnahme mit hoher Detailtiefe und klarer Trennung vom Hintergrund.',
  owner_portrait: 'Startframe: freundliches Owner-Portrait, Blick zur Kamera, professionell aber authentisch.',
  hands_at_work: 'Startframe: Hände bei der Arbeit/Herstellung, dynamisch und handwerklich nah.',
  before_after_split: 'Startframe: Vorher/Nachher-Split mit klaren visuellen Unterschieden.'
};

const startFrameLabels: Record<StartFrameStyle, string> = {
  storefront_hero: 'Storefront Hero',
  product_macro: 'Produkt-Makro',
  owner_portrait: 'Owner Portrait',
  hands_at_work: 'Hands at Work',
  before_after_split: 'Before/After Split'
};

const moodPromptMap: Record<MoodPreset, string> = {
  commercial_cta:
    'Stimmung: Commercial mit klarer Verkaufsbotschaft, Nutzenfokus und konkret handlungsorientiertem CTA.',
  problem_solution:
    'Stimmung: Problem->Lösung. Zeige klar das Problem, dann direkte Lösung in 2 Schritten, danach CTA.',
  testimonial:
    'Stimmung: glaubwürdige Kundenstimme, social proof, seriöser Ton, kurzes Vertrauen-Signal vor CTA.',
  humor_light:
    'Stimmung: leicht humorvoll, freundlich, professionell. Keine Rabatt-Deadline-/Hard-Sell-Formulierungen wie "nur heute", "Angebot endet", "jetzt kaufen".'
};

const motionGuardByVariant: Record<VariantType, string> = {
  SHORT_15: 'Motion-Guard: mindestens 5 klar erkennbare Bewegungsphasen, kein statischer Shot länger als 2.5 Sekunden.',
  MASTER_30: 'Motion-Guard: mindestens 8 klar erkennbare Bewegungsphasen, kein statischer Shot länger als 2.5 Sekunden.'
};

const ctaDirectnessByControl: Record<UserControlProfile['ctaStrength'], string> = {
  soft: 'CTA zurückhaltend und beratend, kein Druck.',
  balanced: 'CTA klar, konkret und freundlich.',
  strong: 'CTA deutlich und handlungsorientiert, aber ohne unseriösen Druck.'
};

const shotPaceByControl: Record<UserControlProfile['shotPace'], string> = {
  relaxed: 'Shot-Pace ruhig, längere Einstellungen, weiche Übergänge.',
  balanced: 'Shot-Pace ausgewogen mit klaren Szenenwechseln.',
  fast: 'Shot-Pace dynamisch mit schnellen, aber lesbaren Übergängen.'
};

const visualStyleByControl: Record<UserControlProfile['visualStyle'], string> = {
  clean: 'Visual Style clean/minimal, klare Komposition, wenig visuelles Rauschen.',
  cinematic: 'Visual Style cinematic mit kontrollierter Tiefenwirkung und Lichtführung.',
  ugc: 'Visual Style UGC-authentisch, nahbar, handgehaltene Mikrobewegung erlaubt.'
};

const motionBoostByControl: Record<UserControlProfile['motionIntensity'], number> = {
  low: -1,
  medium: 0,
  high: 2
};

const shotStylePromptLibrary: Record<ShotStyleTag, string> = {
  cinematic_closeup: 'Shot style: cinematic close-up with controlled depth and eye-level confidence framing.',
  over_shoulder: 'Shot style: over-shoulder perspective to increase narrative immersion.',
  handheld_push: 'Shot style: subtle handheld push-ins for perceived momentum and urgency.',
  product_macro: 'Shot style: detailed product macro inserts for tactile emphasis.',
  wide_establishing: 'Shot style: concise wide establishing shots for context before close action.',
  fast_cut_montage: 'Shot style: short dynamic montage cuts with clear visual progression.'
};

const parsePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
};

const parseRangeFloat = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const resolveImageModelOrder = () => {
  const primary = String(cfg.openaiImageModel ?? 'gpt-image-1').trim() || 'gpt-image-1';
  const fallback = String(cfg.openaiImageModelFallback ?? 'gpt-image-1').trim() || 'gpt-image-1';
  return primary === fallback ? [primary] : [primary, fallback];
};

const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

const resolveVariantDurations = (variantType: VariantType): VariantDurationConfig => {
  const isPremium60 = variantType === 'MASTER_30' && premium60Enabled();

  const targetSeconds = isPremium60
    ? parsePositiveInt(process.env.PREMIUM_60_TARGET_SECONDS ?? 60, 60)
    : parsePositiveInt(process.env.STANDARD_30_TARGET_SECONDS ?? 30, 30);

  const defaultSource = 12;
  const sourceFromEnv = isPremium60
    ? process.env.PREMIUM_60_SOURCE_VIDEO_SECONDS
    : process.env.STANDARD_30_SOURCE_VIDEO_SECONDS;

  const sourceSeconds = Math.min(12, Math.max(4, parsePositiveInt(sourceFromEnv ?? defaultSource, defaultSource)));

  return {
    targetSeconds,
    sourceSeconds
  };
};

const resolveStoryboardConcept = (conceptId?: string): StoryboardConcept => {
  if (!conceptId) return storyboardConcepts.concept_web_vertical_slice;
  const key = conceptId as StoryboardConceptId;
  return storyboardConcepts[key] ?? storyboardConcepts.concept_web_vertical_slice;
};

const resolveStartFrameStyle = (style?: string): StartFrameStyle => {
  if (!style) return 'storefront_hero';
  if (style in startFramePrompts) return style as StartFrameStyle;
  return 'storefront_hero';
};

const resolveMoodPreset = (mood?: string): MoodPreset => {
  if (!mood) return 'commercial_cta';
  if (mood in moodPromptMap) return mood as MoodPreset;
  return 'commercial_cta';
};

type PromptCompilerMeta = {
  intentRules: string[];
  hookRule: string | null;
  shotStyleSet: ShotStyleTag[];
  safetyConstraints: string[];
  calmExceptionApplied: boolean;
  appliedRules: string[];
  suppressedRules: string[];
};

const selectShotStyleSet = (intent: CreativeIntentMatrix): ShotStyleTag[] => {
  const explicit = (intent.shotStyles ?? [])
    .slice()
    .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))
    .map((entry) => entry.id as ShotStyleTag)
    .slice(0, 4);

  if (explicit.length) return explicit;

  const byNarrative = new Set<ShotStyleTag>();
  for (const format of intent.narrativeFormats) {
    if (format.id === 'before_after') byNarrative.add('wide_establishing');
    if (format.id === 'dialog') byNarrative.add('over_shoulder');
    if (format.id === 'offer_focus') byNarrative.add('product_macro');
    if (format.id === 'commercial') byNarrative.add('cinematic_closeup');
    if (format.id === 'problem_solution') byNarrative.add('handheld_push');
  }

  byNarrative.add('fast_cut_montage');
  return [...byNarrative].slice(0, 4);
};

const resolveEffectiveIntent = (
  creativeIntent: CreativeIntentMatrix | undefined,
  moodPreset: MoodPreset,
  conceptId: string
): CreativeIntentMatrix => normalizeCreativeIntent(creativeIntent, moodPreset, conceptId);

const isLegacyControlProfileProvided = (raw: Partial<UserControlProfile> | undefined) =>
  Boolean(raw && Object.keys(raw).length > 0);

const resolveMotionRequirement = (
  variantType: VariantType,
  controls: UserControlProfile,
  intent?: CreativeIntentMatrix
): { minPhases: number; maxStaticSeconds: number } => {
  const baseMin = variantType === 'MASTER_30' ? 8 : 5;
  const intentBoost =
    intent?.energyMode === 'high' ||
    (intent?.effectGoals ?? []).some((entry) => ['sell_conversion', 'urgency_offer', 'cringe_hook'].includes(entry.id))
      ? 1
      : 0;

  const minPhases = Math.max(4, baseMin + motionBoostByControl[controls.motionIntensity] + intentBoost);
  const maxStaticSeconds = controls.shotPace === 'fast' ? 2 : controls.shotPace === 'relaxed' ? 3 : 2.5;
  return { minPhases, maxStaticSeconds };
};

const renderLegacyUserControlPrompt = (controls: UserControlProfile) =>
  [
    `User-Control CTA: ${ctaDirectnessByControl[controls.ctaStrength]}`,
    `User-Control Motion: Intensität=${controls.motionIntensity}.`,
    `User-Control Pace: ${shotPaceByControl[controls.shotPace]}`,
    `User-Control Visual: ${visualStyleByControl[controls.visualStyle]}`
  ].join(' ');

const renderIntentPrompt = (intent: CreativeIntentMatrix) => {
  const effectLine = intent.effectGoals
    .map((entry) => `${entry.id}(w=${Number(entry.weight ?? 1).toFixed(1)})`)
    .join(', ');
  const narrativeLine = intent.narrativeFormats
    .map((entry) => `${entry.id}(w=${Number(entry.weight ?? 1).toFixed(1)})`)
    .join(', ');
  const shotStyleSet = selectShotStyleSet(intent);

  return {
    text: [
      `Creative Intent Effect Goals: ${effectLine || 'default'}.`,
      `Creative Intent Narrative Formats: ${narrativeLine || 'default'}.`,
      `Creative Intent Energy Mode: ${intent.energyMode ?? 'auto'}.`,
      `Shot style library: ${shotStyleSet.map((tag) => shotStylePromptLibrary[tag]).join(' ')}`
    ].join(' '),
    shotStyleSet
  };
};

const renderStoryboardLightPrompt = (storyboardLight?: StoryboardLight) => {
  if (!storyboardLight?.beats?.length) return '';

  const beatLines = storyboardLight.beats
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((beat) => {
      const fragments = [
        `Beat ${beat.order}: ${beat.action}`,
        beat.visualHint ? `Visual: ${beat.visualHint}` : '',
        beat.dialogueHint ? `Dialog: ${beat.dialogueHint}` : '',
        beat.onScreenTextHint ? `On-screen: ${beat.onScreenTextHint}` : ''
      ].filter(Boolean);
      return fragments.join(' | ');
    });

  return [
    'Storyboard Light (user-edited beats):',
    ...beatLines,
    storyboardLight.hookHint ? `Hook hint: ${storyboardLight.hookHint}` : '',
    storyboardLight.ctaHint ? `CTA hint: ${storyboardLight.ctaHint}` : '',
    storyboardLight.pacingHint ? `Pacing hint: ${storyboardLight.pacingHint}` : ''
  ]
    .filter(Boolean)
    .join(' ');
};

const compilePromptV2 = (input: {
  baseSegments: string[];
  intent: CreativeIntentMatrix;
  safetyConstraints: string[];
  includeLegacyControls: boolean;
  legacyControls: UserControlProfile;
}) => {
  const promptParts = [...input.baseSegments];
  const appliedRules: string[] = [];
  const suppressedRules: string[] = [];

  const intentPrompt = renderIntentPrompt(input.intent);
  promptParts.push(intentPrompt.text);

  let hookRule: string | null = 'HOOK_ENHANCER_DEFAULT';
  if (input.intent.energyMode === 'calm') {
    hookRule = null;
    suppressedRules.push('HOOK_ENHANCER_SUPPRESSED_CALM_MODE');
  } else {
    promptParts.push('Hook enhancer: first second must open with a sharp visual trigger and immediate narrative tension.');
    appliedRules.push('HOOK_ENHANCER_APPLIED');
  }

  if (input.intent.energyMode === 'calm') {
    suppressedRules.push('MOTION_VARIATION_ENHANCER_SUPPRESSED_CALM_MODE');
  } else {
    promptParts.push('Motion/variation enhancer: avoid repetitive loop-like framing, force visual progression every 1-2 beats.');
    appliedRules.push('MOTION_VARIATION_ENHANCER_APPLIED');
  }

  promptParts.push('Shot diversity enhancer: rotate shot types across beats and avoid repeating the same camera pattern in sequence.');
  appliedRules.push('SHOT_DIVERSITY_ENHANCER_APPLIED');

  if (input.includeLegacyControls) {
    promptParts.push(renderLegacyUserControlPrompt(input.legacyControls));
    appliedRules.push('LEGACY_USER_CONTROLS_MAPPED_TO_INTENT');
  }

  for (const constraint of input.safetyConstraints) {
    promptParts.push(constraint);
  }

  const prompt = promptParts.filter(Boolean).join(' ');

  const meta: PromptCompilerMeta = {
    intentRules: [
      ...input.intent.effectGoals.map((entry) => `effect:${entry.id}`),
      ...input.intent.narrativeFormats.map((entry) => `narrative:${entry.id}`),
      `energy:${input.intent.energyMode ?? 'auto'}`
    ],
    hookRule,
    shotStyleSet: intentPrompt.shotStyleSet,
    safetyConstraints: input.safetyConstraints,
    calmExceptionApplied: input.intent.energyMode === 'calm',
    appliedRules,
    suppressedRules
  };

  return { prompt, meta };
};

const FRAME_WIDTH = 720;
const FRAME_HEIGHT = 1280;

const roundSeconds = (value: number) => Number(value.toFixed(3));

export const resolveCaptionSafeArea = (): CaptionSafeAreaConfig => {
  const marginRatio = parseRangeFloat(process.env.CAPTION_SAFE_AREA_MARGIN_RATIO ?? 0.1, 0.1, 0.05, 0.2);
  const derivedScale = 1 - marginRatio * 2;
  const scale = parseRangeFloat(process.env.CAPTION_SAFE_AREA_SCALE ?? derivedScale, derivedScale, 0.75, 1);
  const safeWidth = Math.max(2, Math.floor((FRAME_WIDTH * scale) / 2) * 2);
  const safeHeight = Math.max(2, Math.floor((FRAME_HEIGHT * scale) / 2) * 2);
  const marginX = Math.max(0, Math.floor((FRAME_WIDTH - safeWidth) / 2));
  const marginY = Math.max(0, Math.floor((FRAME_HEIGHT - safeHeight) / 2));

  return {
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    scale,
    marginRatio,
    marginX,
    marginY,
    safeWidth,
    safeHeight
  };
};

const now = () => Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJsonSafe = (text: string) => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const cleanMessage = (provider: string, status: number, body: string) => {
  const parsed = parseJsonSafe(body);
  const nested = parsed && typeof parsed.error === 'object' ? (parsed.error as Record<string, unknown>) : null;
  const msg =
    (nested?.message as string | undefined) ??
    (parsed?.message as string | undefined) ??
    body.slice(0, 300) ??
    'UNKNOWN_PROVIDER_ERROR';
  return `${provider}_HTTP_${status}:${msg}`;
};

const isFatalProviderText = (text: string) =>
  /quota|billing|credit|payment|insufficient|forbidden|unauthorized|invalid api key|invalid_api_key/i.test(text);

const throwProviderError = (provider: string, status: number, body: string): never => {
  const message = cleanMessage(provider, status, body);
  throw new ProviderRuntimeError(message, { provider, status, fatal: isFatalProviderText(message) || status === 401 || status === 403 });
};

const ensureEnv = (key: string, value: string) => {
  if (!value) {
    throw new ProviderRuntimeError(`${key}_MISSING`, { provider: 'config', fatal: true });
  }
};

const checkRate = (kind: 'llm' | 'tts' | 'video', maxRpm: number) => {
  const t = now();
  const windowStart = t - 60_000;
  rpmWindows[kind] = rpmWindows[kind].filter((x) => x >= windowStart);
  if (rpmWindows[kind].length >= maxRpm) {
    throw new ProviderRuntimeError(`RATE_LIMIT_EXCEEDED:${kind}:${maxRpm}`, { provider: 'safety', fatal: true });
  }
  rpmWindows[kind].push(t);
};

const reserveBudget = (estimatedEur: number, reason: string) => {
  const day = new Date().toISOString().slice(0, 10);
  const spent = dailySpend.get(day) ?? 0;
  const next = spent + estimatedEur;
  if (next > cfg.dailyBudgetEur) {
    throw new ProviderRuntimeError(`DAILY_BUDGET_EXCEEDED:${next.toFixed(3)}>${cfg.dailyBudgetEur} (${reason})`, {
      provider: 'safety',
      fatal: true
    });
  }
  dailySpend.set(day, next);
};

const openAiHeaders = () => {
  ensureEnv('OPENAI_API_KEY', cfg.openaiApiKey);
  return {
    Authorization: `Bearer ${cfg.openaiApiKey}`,
    'Content-Type': 'application/json'
  };
};

const openAiGet = async (path: string) => {
  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.openaiApiKey}` }
  });
  const body = await res.text();
  if (!res.ok) throwProviderError('openai', res.status, body);
  return parseJsonSafe(body) ?? {};
};

const openAiPostJson = async (path: string, payload: Record<string, unknown>) => {
  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify(payload)
  });
  const body = await res.text();
  if (!res.ok) throwProviderError('openai', res.status, body);
  return parseJsonSafe(body) ?? {};
};

const openAiPostBinary = async (path: string, payload: Record<string, unknown>) => {
  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify(payload)
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throwProviderError('openai', res.status, buffer.toString('utf8'));
  }
  return buffer;
};

const openAiGetBinary = async (path: string) => {
  const res = await fetch(`https://api.openai.com${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.openaiApiKey}` }
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throwProviderError('openai', res.status, buffer.toString('utf8'));
  }
  return buffer;
};

const supabaseHeaders = (contentType?: string) => {
  ensureEnv('SUPABASE_URL', cfg.supabaseUrl);
  ensureEnv('SUPABASE_SERVICE_ROLE_KEY', cfg.supabaseServiceRoleKey);

  return {
    Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    apikey: cfg.supabaseServiceRoleKey,
    ...(contentType ? { 'Content-Type': contentType } : {})
  };
};

const supabaseJson = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${cfg.supabaseUrl}${path}`, {
    ...init,
    headers: {
      ...supabaseHeaders('application/json'),
      ...(init?.headers ?? {})
    }
  });
  const body = await res.text();
  if (!res.ok) {
    throwProviderError('supabase', res.status, body);
  }
  return parseJsonSafe(body);
};

const supabaseUpload = async (objectPath: string, bytes: Buffer, contentType: string) => {
  const path = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.supabaseBucket}/${path}`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(contentType),
      'x-upsert': 'true'
    },
    body: bytes
  });

  const body = await res.text();
  if (!res.ok) throwProviderError('supabase', res.status, body);
};

const supabaseDownload = async (objectPath: string) => {
  const path = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.supabaseBucket}/${path}`, {
    method: 'GET',
    headers: supabaseHeaders()
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throwProviderError('supabase', res.status, bytes.toString('utf8'));
  return bytes;
};

const supabaseSignedUrl = async (objectPath: string) => {
  const path = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const payload = await supabaseJson(`/storage/v1/object/sign/${cfg.supabaseBucket}/${path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 3600 })
  });

  const signed = (payload?.signedURL as string | undefined) ?? (payload?.signedUrl as string | undefined);
  if (!signed) {
    throw new ProviderRuntimeError('SUPABASE_SIGN_URL_MISSING', { provider: 'supabase', fatal: true });
  }

  return signed.startsWith('http') ? signed : `${cfg.supabaseUrl}/storage/v1${signed}`;
};

const parseOpenAiResponseText = (response: Record<string, unknown>): string => {
  const direct = response.output_text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const output = Array.isArray(response.output) ? response.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : [];
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') texts.push(c.text);
    }
  }

  return texts.join('\n').trim();
};

const probeWithRetry = async (name: string, fn: () => Promise<void>) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(400);
    }
  }
  throw new ProviderRuntimeError(`HEALTHCHECK_FAILED:${name}:${String((lastError as Error)?.message ?? lastError)}`, {
    provider: 'health',
    fatal: true
  });
};

const probeTtsProvider = async () => {
  if (cfg.ttsProvider !== 'elevenlabs') {
    await openAiPostBinary('/v1/audio/speech', {
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: 'health check'
    });
    return;
  }

  ensureEnv('ELEVENLABS_API_KEY', cfg.elevenApiKey);
  const res = await fetch('https://api.elevenlabs.io/v1/models', {
    method: 'GET',
    headers: {
      'xi-api-key': cfg.elevenApiKey
    }
  });
  const body = await res.text();
  if (!res.ok) throwProviderError('elevenlabs', res.status, body);
};

const probeStorageProvider = async () => {
  const buckets = await supabaseJson('/storage/v1/bucket', { method: 'GET' });
  if (!Array.isArray(buckets)) {
    throw new ProviderRuntimeError('SUPABASE_BUCKET_LIST_INVALID', { provider: 'supabase', fatal: true });
  }

  const exists = buckets.some((b) => {
    if (!b || typeof b !== 'object') return false;
    const row = b as Record<string, unknown>;
    return row.name === cfg.supabaseBucket || row.id === cfg.supabaseBucket;
  });

  if (!exists) {
    throw new ProviderRuntimeError(`SUPABASE_BUCKET_MISSING:${cfg.supabaseBucket}`, { provider: 'supabase', fatal: true });
  }

  const probeObjectPath = `probes/health-${Date.now()}.txt`;
  await supabaseUpload(probeObjectPath, Buffer.from('storage-healthcheck', 'utf8'), 'text/plain');
  await supabaseSignedUrl(probeObjectPath);
};

export const runProviderHealthchecks = async () => {
  if (now() - healthCheckedAt < healthCacheMs) return;

  await probeWithRetry('openai-llm', async () => {
    await openAiGet('/v1/models/gpt-4o-mini');
  });
  await probeWithRetry('openai-image', async () => {
    const [primaryModel] = resolveImageModelOrder();
    await openAiGet(`/v1/models/${primaryModel}`);
  });
  await probeWithRetry('openai-video', async () => {
    await openAiGet('/v1/models/sora-2');
  });

  health.sora = 'green';

  try {
    await probeWithRetry('tts', probeTtsProvider);
    health.tts = 'green';
  } catch (error) {
    health.tts = cfg.openaiApiKey ? 'yellow' : 'red';
    if (!cfg.openaiApiKey) throw error;
    logEvent({
      event: 'provider_tts_degraded',
      level: 'WARN',
      provider: 'tts',
      detail: String((error as Error)?.message ?? error)
    });
  }

  await probeWithRetry('storage', probeStorageProvider);
  health.render = 'green';

  healthCheckedAt = now();
};

export const getProviderHealthSnapshot = (): ProviderHealthSnapshot => ({ ...health });

export const isFatalProviderError = (error: unknown) => error instanceof ProviderRuntimeError && error.fatal;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const estimateSpeechSeconds = (text: string) => {
  const words = countWords(text);
  return Number((words / 2.35).toFixed(2));
};

const ensureSentenceEnding = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.!?…]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
};

const createScriptFromLlm = async (
  topic: string,
  variantType: VariantType,
  moodPreset: MoodPreset,
  creativeIntent?: CreativeIntentMatrix
) => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.01, 'llm-script');

  const { targetSeconds } = resolveVariantDurations(variantType);
  const targetWords = Math.round(targetSeconds * 2.35);
  const moodPrompt = moodPromptMap[moodPreset];
  const intentPrompt = creativeIntent ? renderIntentPrompt(creativeIntent).text : '';

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-4o-mini',
    input:
      `Erstelle ein deutsches Voiceover-Skript für ein Kurzvideo zum Thema: "${topic}". ` +
      `Ziel-Länge: ca. ${targetSeconds} Sekunden, etwa ${targetWords} Wörter. ` +
      `${moodPrompt} ` +
      `${intentPrompt} ` +
      'Das Skript muss mit einem vollständigen, abgeschlossenen Satz enden. ' +
      'In der ersten Sekunde muss der Hook spürbar sein, außer im calm-mode. ' +
      'Gib nur den gesprochenen Text aus, ohne Überschrift oder Bulletpoints.',
    max_output_tokens: Math.max(220, Math.round(targetWords * 2.4))
  });
  const text = parseOpenAiResponseText(response);
  if (!text) {
    throw new ProviderRuntimeError('LLM_EMPTY_OUTPUT', { provider: 'openai', fatal: true });
  }
  return ensureSentenceEnding(text);
};

const condenseScriptToTarget = async (
  script: string,
  targetSeconds: number,
  targetWords: number,
  moodPreset: MoodPreset,
  creativeIntent?: CreativeIntentMatrix
) => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.008, 'llm-script-condense');

  const intentPrompt = creativeIntent ? renderIntentPrompt(creativeIntent).text : '';

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-4o-mini',
    input:
      `Kürze dieses deutsche Voiceover-Skript auf maximal ${targetWords} Wörter (ca. ${targetSeconds} Sekunden). ` +
      `${moodPromptMap[moodPreset]} ` +
      `${intentPrompt} ` +
      'Bewahre den roten Faden und einen klaren CTA. Der letzte Satz muss vollständig sein. ' +
      `Text: """${script}""". Gib nur den finalen gesprochenen Text aus.`,
    max_output_tokens: Math.max(180, Math.round(targetWords * 2.2))
  });

  const text = parseOpenAiResponseText(response);
  if (!text) return script;
  return ensureSentenceEnding(text);
};

export const generateScriptDraft = async (input: {
  topic: string;
  variantType: VariantType;
  moodPreset?: MoodPreset;
  creativeIntent?: CreativeIntentMatrix;
  regenerate?: boolean;
}) => {
  await runProviderHealthchecks();

  const moodPreset = resolveMoodPreset(input.moodPreset);
  const effectiveIntent = resolveEffectiveIntent(input.creativeIntent, moodPreset, 'concept_web_vertical_slice');
  const { targetSeconds } = resolveVariantDurations(input.variantType);
  const targetWords = Math.round(targetSeconds * 2.35);

  let script = await createScriptFromLlm(input.topic, input.variantType, moodPreset, effectiveIntent);
  let estimatedSeconds = estimateSpeechSeconds(script);
  let condensed = false;

  if (estimatedSeconds > targetSeconds * 1.08) {
    script = await condenseScriptToTarget(script, targetSeconds, targetWords, moodPreset, effectiveIntent);
    estimatedSeconds = estimateSpeechSeconds(script);
    condensed = true;
  }

  const withinTarget = estimatedSeconds <= targetSeconds * 1.08;

  return {
    script,
    moodPreset,
    creativeIntent: effectiveIntent,
    targetSeconds,
    suggestedWords: targetWords,
    estimatedSeconds,
    withinTarget,
    condensed
  };
};

const createImage = async (prompt: string) => {
  reserveBudget(0.04, 'image-generation');

  const models = resolveImageModelOrder();
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const response = await openAiPostJson('/v1/images/generations', {
        model,
        prompt,
        size: '1024x1024'
      });
      const data = Array.isArray(response.data) ? (response.data[0] as Record<string, unknown> | undefined) : undefined;
      const b64 = data?.b64_json;
      if (typeof b64 !== 'string' || !b64.length) {
        throw new ProviderRuntimeError(`IMAGE_B64_MISSING:${model}`, { provider: 'openai', fatal: true });
      }
      return Buffer.from(b64, 'base64');
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message ?? error);
      const canFallback = model !== models[models.length - 1];
      if (canFallback && /model|not found|unsupported|does not exist|invalid/i.test(message)) {
        logEvent({
          event: 'image_model_fallback',
          level: 'WARN',
          provider: 'openai',
          detail: `primary=${model} fallback=${models[models.length - 1]} reason=${message.slice(0, 180)}`
        });
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new ProviderRuntimeError('IMAGE_GENERATION_FAILED', { provider: 'openai', fatal: true });
};

const createVideo = async (prompt: string, variantType: VariantType) => {
  checkRate('video', cfg.maxRpmVideo);
  const { sourceSeconds } = resolveVariantDurations(variantType);
  const seconds = String(sourceSeconds);
  const model = 'sora-2';
  const estimated = sourceSeconds * 0.1;
  reserveBudget(estimated, `video-${model}`);

  const created = await openAiPostJson('/v1/videos', {
    model,
    prompt,
    seconds,
    size: '720x1280'
  });

  const videoId = String(created.id ?? '');
  if (!videoId) throw new ProviderRuntimeError('VIDEO_ID_MISSING', { provider: 'openai', fatal: true });

  const pollSleepMs = Math.max(2_000, Number(process.env.VIDEO_POLL_SLEEP_MS ?? 4_000));
  const maxWaitMs = Math.max(240_000, Number(process.env.VIDEO_POLL_TIMEOUT_MS ?? 900_000));
  const attemptsFromTimeout = Math.ceil(maxWaitMs / pollSleepMs);
  const attemptsOverride = Number(process.env.VIDEO_POLL_ATTEMPTS_MAX ?? 270);
  const maxAttempts = Math.max(30, attemptsFromTimeout, attemptsOverride);

  let status = String(created.status ?? 'queued');
  let attempts = 0;
  while (attempts < maxAttempts && !['completed', 'failed', 'canceled'].includes(status)) {
    attempts += 1;
    await sleep(pollSleepMs);
    const polled = await openAiGet(`/v1/videos/${videoId}`);
    status = String(polled.status ?? status);
    if (status === 'failed' || status === 'canceled') {
      throw new ProviderRuntimeError(`VIDEO_GENERATION_${status.toUpperCase()}:${videoId}`, { provider: 'openai', fatal: true });
    }
    if (status === 'completed') break;
  }

  if (status !== 'completed') {
    const maxWaitSec = Math.floor((maxAttempts * pollSleepMs) / 1000);
    throw new ProviderRuntimeError(
      `VIDEO_GENERATION_TIMEOUT:${videoId}:${status}:attempts=${attempts}/${maxAttempts}:max_wait_sec=${maxWaitSec}`,
      { provider: 'openai', fatal: true }
    );
  }

  const bytes = await openAiGetBinary(`/v1/videos/${videoId}/content`);
  return { bytes, videoId, model, seconds };
};

const createOpenAiTts = async (text: string) => {
  checkRate('tts', cfg.maxRpmTts);
  reserveBudget(0.02, 'openai-tts');
  return openAiPostBinary('/v1/audio/speech', {
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: text
  });
};

const createElevenTts = async (text: string) => {
  ensureEnv('ELEVENLABS_API_KEY', cfg.elevenApiKey);
  checkRate('tts', cfg.maxRpmTts);
  reserveBudget(0.02, 'elevenlabs-tts');

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': cfg.elevenApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
  });

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throwProviderError('elevenlabs', res.status, buffer.toString('utf8'));
  return buffer;
};

const createTts = async (text: string) => {
  if (cfg.ttsProvider === 'elevenlabs') {
    try {
      return { bytes: await createElevenTts(text), provider: 'elevenlabs' };
    } catch (error) {
      if (!cfg.openaiApiKey) throw error;
      health.tts = 'yellow';
      logEvent({
        event: 'provider_tts_failover_openai',
        level: 'WARN',
        provider: 'tts',
        detail: String((error as Error)?.message ?? error)
      });
      return { bytes: await createOpenAiTts(text), provider: 'openai-tts-fallback' };
    }
  }

  return { bytes: await createOpenAiTts(text), provider: 'openai-tts' };
};

const uploadAsset = async (jobId: string, objectPath: string, bytes: Buffer, mimeType: string, provider: string): Promise<StoredAsset> => {
  if (cfg.storageProvider !== 'supabase') {
    throw new ProviderRuntimeError(`UNSUPPORTED_STORAGE_PROVIDER:${cfg.storageProvider}`, { provider: 'storage', fatal: true });
  }

  await supabaseUpload(objectPath, bytes, mimeType);
  const signedUrl = await supabaseSignedUrl(objectPath);

  logEvent({
    event: 'asset_uploaded',
    provider: cfg.storageProvider,
    jobId,
    data: {
      objectPath,
      bytes: bytes.length,
      mimeType,
      signedUrl
    }
  });

  return {
    objectPath,
    signedUrl,
    bytes: bytes.length,
    mimeType,
    provider
  };
};

const sanitizeSegment = (value: string, fallback: string) => {
  const trimmed = value.trim().toLowerCase();
  const cleaned = trimmed.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
};

const detectImageMimeFromName = (fileName: string, provided?: string): 'image/png' | 'image/jpeg' | 'image/webp' => {
  const fromProvided = String(provided ?? '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp'].includes(fromProvided)) {
    return fromProvided as 'image/png' | 'image/jpeg' | 'image/webp';
  }

  const ext = extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
};

const extensionForMime = (mimeType: string) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
};

const thumbnailCache = new Map<string, StoredAsset>();

export const uploadStartFrameReference = async (input: {
  organizationId: string;
  fileName: string;
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}) => {
  if (cfg.storageProvider !== 'supabase') {
    throw new ProviderRuntimeError(`UNSUPPORTED_STORAGE_PROVIDER:${cfg.storageProvider}`, { provider: 'storage', fatal: true });
  }

  const maxUploadBytes = Math.max(1_000_000, Number(process.env.STARTFRAME_UPLOAD_MAX_BYTES ?? 8 * 1024 * 1024));
  if (!input.bytes.length || input.bytes.length > maxUploadBytes) {
    throw new ProviderRuntimeError(`STARTFRAME_UPLOAD_SIZE_INVALID:${input.bytes.length}:${maxUploadBytes}`, {
      provider: 'upload',
      fatal: true
    });
  }

  const mimeType = detectImageMimeFromName(input.fileName, input.mimeType);
  const ext = extensionForMime(mimeType);
  const orgSegment = sanitizeSegment(input.organizationId || 'org', 'org');
  const fileSegment = sanitizeSegment(input.fileName.replace(/\.[^/.]+$/, ''), 'startframe');
  const hash = createHash('sha1').update(input.bytes).digest('hex').slice(0, 12);
  const objectPath = `uploads/startframes/${orgSegment}/${Date.now()}-${fileSegment}-${hash}.${ext}`;

  await supabaseUpload(objectPath, input.bytes, mimeType);
  const signedUrl = await supabaseSignedUrl(objectPath);

  return {
    assetId: `sfu_${randomUUID().slice(0, 8)}`,
    objectPath,
    signedUrl,
    bytes: input.bytes.length,
    mimeType
  };
};

export const generateStartFrameThumbnail = async (input: {
  candidateId: string;
  topic: string;
  style: StartFrameStyle;
  label: string;
  description: string;
  moodPreset: MoodPreset;
}) => {
  if (!cfg.openaiApiKey || cfg.storageProvider !== 'supabase') {
    return null;
  }

  const cached = thumbnailCache.get(input.candidateId);
  if (cached) {
    return cached;
  }

  const thumbPrompt = [
    `Create a high-quality 9:16 startframe thumbnail for a short social video.`,
    `Topic: ${input.topic}.`,
    `Startframe style: ${input.label}.`,
    `Mood: ${moodPromptMap[input.moodPreset]}`,
    `Description: ${input.description}`,
    `Output should look like a realistic keyframe still (no collage, no text overlays).`
  ].join(' ');

  try {
    const bytes = await createImage(thumbPrompt);
    const objectPath = `catalog/startframe-thumbnails/${sanitizeSegment(input.candidateId, 'candidate')}.png`;
    const asset = await uploadAsset('catalog-startframe', objectPath, bytes, 'image/png', 'openai-image-thumbnail');
    thumbnailCache.set(input.candidateId, asset);
    return asset;
  } catch (error) {
    logEvent({
      event: 'startframe_thumbnail_generation_failed',
      level: 'WARN',
      provider: 'openai',
      detail: String((error as Error)?.message ?? error),
      data: {
        candidateId: input.candidateId,
        style: input.style
      }
    });
    return null;
  }
};

const summarizeReferenceImage = async (signedUrl: string) => {
  if (!cfg.openaiApiKey) return '';

  try {
    const response = await openAiPostJson('/v1/responses', {
      model: 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Describe the main visual cues of this image in one short sentence for a video generation prompt.'
            },
            {
              type: 'input_image',
              image_url: signedUrl
            }
          ]
        }
      ],
      max_output_tokens: 70
    });

    return parseOpenAiResponseText(response).slice(0, 220);
  } catch {
    return '';
  }
};

const probeMotion = (videoBytes: Buffer, label: string, options?: { sceneThreshold?: number }): MotionAnalysis => {
  const dir = mkdtempSync(join(tmpdir(), 'fsf-motion-'));
  const input = join(dir, `${label}.mp4`);

  try {
    writeFileSync(input, videoBytes);
    const durationSeconds = probeMediaDurationSeconds(input, `${label}_duration`);
    const sceneThreshold = parseRangeFloat(options?.sceneThreshold ?? process.env.MOTION_SCENE_THRESHOLD ?? 0.018, 0.018, 0.005, 0.2);

    const probe = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'info', '-i', input, '-vf', `select='gt(scene,${sceneThreshold})',showinfo`, '-an', '-f', 'null', '-'],
      { encoding: 'utf8' }
    );

    if (probe.status !== 0) {
      const stderr = String(probe.stderr ?? 'unknown');
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ').slice(0, 500);
      throw new ProviderRuntimeError(`FFMPEG_MOTION_PROBE_FAILED:${tail || 'unknown'}`, {
        provider: 'ffmpeg',
        fatal: true
      });
    }

    const stderr = String(probe.stderr ?? '');
    const times = [...stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    const deduped: number[] = [];
    for (const t of times) {
      if (!deduped.length || Math.abs(deduped[deduped.length - 1] - t) > 0.05) {
        deduped.push(roundSeconds(t));
      }
    }

    const anchors = [0, ...deduped, durationSeconds].map((value) => roundSeconds(value));
    let longestStaticSeconds = 0;
    for (let i = 1; i < anchors.length; i += 1) {
      const gap = roundSeconds(Math.max(0, anchors[i] - anchors[i - 1]));
      if (gap > longestStaticSeconds) longestStaticSeconds = gap;
    }

    const motionCuts = deduped.length;
    const motionPhases = motionCuts + 1;

    return {
      durationSeconds,
      sceneThreshold: roundSeconds(sceneThreshold),
      motionCuts,
      motionPhases,
      longestStaticSeconds: roundSeconds(longestStaticSeconds)
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const createVideoWithMotionEnforcement = async (input: {
  prompt: string;
  variantType: VariantType;
  requirement: { minPhases: number; maxStaticSeconds: number };
}) => {
  const maxAttempts = Math.max(1, Number(process.env.MOTION_ENFORCEMENT_ATTEMPTS ?? 2));
  const staticTolerance = parseRangeFloat(process.env.MOTION_STATIC_TOLERANCE_SECONDS ?? 0.15, 0.15, 0, 1.2);

  let attempt = 0;
  let prompt = input.prompt;
  let lastVideo: Awaited<ReturnType<typeof createVideo>> | null = null;
  let lastMetrics: MotionAnalysis | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const video = await createVideo(prompt, input.variantType);
    const metrics = probeMotion(video.bytes, `segment_attempt_${attempt}`);

    const withinThreshold =
      metrics.motionPhases >= input.requirement.minPhases &&
      metrics.longestStaticSeconds <= input.requirement.maxStaticSeconds + staticTolerance;

    lastVideo = video;
    lastMetrics = metrics;

    if (withinThreshold) {
      return {
        video,
        enforcement: {
          ...metrics,
          minPhasesRequired: input.requirement.minPhases,
          maxStaticSecondsAllowed: roundSeconds(input.requirement.maxStaticSeconds),
          withinThreshold: true,
          attempts: attempt
        } as MotionEnforcement
      };
    }

    if (attempt < maxAttempts) {
      prompt = [
        input.prompt,
        `Retry with stronger motion: ensure at least ${input.requirement.minPhases} distinct movement phases and no static shot longer than ${input.requirement.maxStaticSeconds}s.`
      ].join(' ');
    }
  }

  if (lastMetrics) {
    throw new ProviderRuntimeError(
      `MOTION_ENFORCEMENT_FAILED:phases=${lastMetrics.motionPhases}/${input.requirement.minPhases}:longest_static=${lastMetrics.longestStaticSeconds}s>${input.requirement.maxStaticSeconds}s`,
      { provider: 'motion', fatal: true }
    );
  }

  if (!lastVideo) {
    throw new ProviderRuntimeError('MOTION_ENFORCEMENT_FAILED:NO_VIDEO', { provider: 'motion', fatal: true });
  }

  return {
    video: lastVideo,
    enforcement: {
      ...(lastMetrics ?? {
        durationSeconds: 0,
        sceneThreshold: 0,
        motionCuts: 0,
        motionPhases: 0,
        longestStaticSeconds: 0
      }),
      minPhasesRequired: input.requirement.minPhases,
      maxStaticSecondsAllowed: roundSeconds(input.requirement.maxStaticSeconds),
      withinThreshold: false,
      attempts: maxAttempts
    } as MotionEnforcement
  };
};

const probeMediaDurationSeconds = (inputPath: string, label: string) => {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      inputPath
    ],
    { encoding: 'utf8' }
  );

  if (probe.status !== 0) {
    throw new ProviderRuntimeError(`FFPROBE_DURATION_FAILED:${label}:${probe.stderr?.slice(0, 220) ?? 'unknown'}`, {
      provider: 'ffmpeg',
      fatal: true
    });
  }

  const parsed = Number((probe.stdout ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ProviderRuntimeError(`FFPROBE_DURATION_INVALID:${label}:${String((probe.stdout ?? '').trim()).slice(0, 80)}`, {
      provider: 'ffmpeg',
      fatal: true
    });
  }

  return roundSeconds(parsed);
};

const buildAtempoFilter = (tempo: number) => {
  if (Math.abs(tempo - 1) < 0.001) return 'anull';

  let remaining = tempo;
  const parts: string[] = [];

  while (remaining > 2.0) {
    parts.push('atempo=2.0');
    remaining /= 2.0;
  }

  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }

  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(',');
};

export const planFinalSync = (input: { targetSeconds: number; sourceAudioSeconds: number }): FinalSyncPlan => {
  const targetSeconds = Math.max(1, Number(input.targetSeconds) || 30);
  const sourceAudioSeconds = Math.max(0.05, Number(input.sourceAudioSeconds) || targetSeconds);
  const toleranceSeconds = parseRangeFloat(process.env.FINAL_SYNC_TOLERANCE_SECONDS ?? 0.3, 0.3, 0.05, 1.5);
  const maxTempo = parseRangeFloat(process.env.FINAL_SYNC_MAX_TEMPO ?? 1.12, 1.12, 1, 2);

  let mode: FinalSyncPlan['mode'] = 'passthrough';
  let tempo = 1;
  let adjustedAudioSeconds = sourceAudioSeconds;

  if (sourceAudioSeconds < targetSeconds - toleranceSeconds) {
    mode = 'pad';
  } else if (sourceAudioSeconds > targetSeconds + toleranceSeconds) {
    mode = 'time_stretch';
    const requiredTempo = sourceAudioSeconds / targetSeconds;
    tempo = Math.min(maxTempo, Math.max(1, requiredTempo));
    adjustedAudioSeconds = sourceAudioSeconds / tempo;

    if (adjustedAudioSeconds > targetSeconds + toleranceSeconds) {
      mode = 'time_stretch_trim';
      adjustedAudioSeconds = targetSeconds + toleranceSeconds;
    }
  }

  const finalDurationSeconds = mode === 'pad' ? targetSeconds : adjustedAudioSeconds;

  return {
    mode,
    tempo: roundSeconds(tempo),
    sourceAudioSeconds: roundSeconds(sourceAudioSeconds),
    adjustedAudioSeconds: roundSeconds(adjustedAudioSeconds),
    finalDurationSeconds: roundSeconds(finalDurationSeconds),
    toleranceSeconds: roundSeconds(toleranceSeconds)
  };
};

const muxVideoAndAudio = (
  videoBytes: Buffer,
  audioBytes: Buffer,
  targetSeconds: number,
  safeArea: CaptionSafeAreaConfig
): { bytes: Buffer; sync: FinalSyncMetrics } => {
  const dir = mkdtempSync(join(tmpdir(), 'fsf-assemble-'));
  const inputVideo = join(dir, 'input-video.mp4');
  const inputAudio = join(dir, 'input-audio.mp3');
  const output = join(dir, 'output-final.mp4');

  try {
    writeFileSync(inputVideo, videoBytes);
    writeFileSync(inputAudio, audioBytes);

    const sourceVideoSeconds = probeMediaDurationSeconds(inputVideo, 'source_video');
    const sourceAudioSeconds = probeMediaDurationSeconds(inputAudio, 'source_audio');
    const syncPlan = planFinalSync({ targetSeconds, sourceAudioSeconds });

    const audioFilters: string[] = [];
    const tempoFilter = buildAtempoFilter(syncPlan.tempo);
    if (tempoFilter !== 'anull') {
      audioFilters.push(tempoFilter);
    }

    if (syncPlan.mode === 'pad') {
      const padDuration = Math.max(0, syncPlan.finalDurationSeconds - syncPlan.adjustedAudioSeconds);
      audioFilters.push(`apad=pad_dur=${padDuration.toFixed(3)}`);
    }

    audioFilters.push(`atrim=0:${syncPlan.finalDurationSeconds.toFixed(3)}`);
    audioFilters.push('asetpts=N/SR/TB');

    const run = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-stream_loop',
        '-1',
        '-i',
        inputVideo,
        '-i',
        inputAudio,
        '-filter_complex',
        `[0:v]scale=${safeArea.frameWidth}:${safeArea.frameHeight}:force_original_aspect_ratio=decrease,` +
          `pad=${safeArea.frameWidth}:${safeArea.frameHeight}:(ow-iw)/2:(oh-ih)/2:black,` +
          `scale=${safeArea.safeWidth}:${safeArea.safeHeight}:flags=lanczos,` +
          `pad=${safeArea.frameWidth}:${safeArea.frameHeight}:(ow-iw)/2:(oh-ih)/2:black,` +
          `format=yuv420p[v];[1:a]${audioFilters.join(',')}[a]`,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        '-t',
        syncPlan.finalDurationSeconds.toFixed(3),
        output
      ],
      { encoding: 'utf8' }
    );

    if (run.status !== 0) {
      throw new ProviderRuntimeError(`FFMPEG_MUX_FAILED:${run.stderr?.slice(0, 300) ?? 'unknown'}`, {
        provider: 'ffmpeg',
        fatal: true
      });
    }

    const bytes = readFileSync(output);
    const outputSeconds = probeMediaDurationSeconds(output, 'output_final');
    const avDeltaSeconds = roundSeconds(Math.abs(outputSeconds - syncPlan.finalDurationSeconds));
    const deltaToTargetSeconds = roundSeconds(outputSeconds - targetSeconds);
    const withinTolerance = avDeltaSeconds <= syncPlan.toleranceSeconds;

    if (!withinTolerance) {
      throw new ProviderRuntimeError(
        `FINAL_SYNC_OUT_OF_TOLERANCE:delta=${avDeltaSeconds}s:tolerance=${syncPlan.toleranceSeconds}s`,
        {
          provider: 'ffmpeg',
          fatal: true
        }
      );
    }

    return {
      bytes,
      sync: {
        mode: syncPlan.mode,
        targetSeconds: roundSeconds(targetSeconds),
        toleranceSeconds: syncPlan.toleranceSeconds,
        sourceVideoSeconds,
        sourceAudioSeconds: syncPlan.sourceAudioSeconds,
        adjustedAudioSeconds: syncPlan.adjustedAudioSeconds,
        outputSeconds,
        tempo: syncPlan.tempo,
        avDeltaSeconds,
        deltaToTargetSeconds,
        withinTolerance
      }
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const runVideoStage = async (input: {
  jobId: string;
  topic: string;
  variantType: VariantType;
  conceptId?: string;
  startFrameStyle?: string;
  startFrameCandidateId?: string;
  startFramePromptOverride?: string;
  startFrameReferenceObjectPath?: string;
  moodPreset?: MoodPreset;
  creativeIntent?: CreativeIntentMatrix;
  storyboardLight?: StoryboardLight;
  approvedScript?: string;
  userControls?: Partial<UserControlProfile>;
}) => {
  await runProviderHealthchecks();

  const concept = resolveStoryboardConcept(input.conceptId);
  const startFrameStyle = resolveStartFrameStyle(input.startFrameStyle);
  const fallbackMoodPreset = resolveMoodPreset(input.moodPreset);
  const moodPreset = deriveLegacyMoodPresetFromIntent(input.creativeIntent, fallbackMoodPreset, concept.id);
  const effectiveIntent = resolveEffectiveIntent(input.creativeIntent, moodPreset, concept.id);
  const storyboardLight = normalizeStoryboardLight(input.storyboardLight);

  const legacyUserControlsProvided = isLegacyControlProfileProvided(input.userControls);
  const legacyUserControls = normalizeUserControlProfile(input.userControls);
  const motionRequirement = resolveMotionRequirement(input.variantType, legacyUserControls, effectiveIntent);

  const durationConfig = resolveVariantDurations(input.variantType);
  const captionSafeArea = resolveCaptionSafeArea();
  const safeMarginPercent = Math.round(captionSafeArea.marginRatio * 100);

  let referenceAsset: StoredAsset | null = null;
  let referenceSummary = '';

  if (input.startFrameReferenceObjectPath) {
    const referenceBytes = await supabaseDownload(input.startFrameReferenceObjectPath);
    const referenceMimeType = detectImageMimeFromName(input.startFrameReferenceObjectPath);
    const referenceExt = extensionForMime(referenceMimeType);
    referenceAsset = await uploadAsset(
      input.jobId,
      `jobs/${input.jobId}/assets/startframe-reference.${referenceExt}`,
      referenceBytes,
      referenceMimeType,
      'user-upload-reference'
    );
    referenceSummary = await summarizeReferenceImage(referenceAsset.signedUrl);
  }

  const startFramePromptBase = input.startFramePromptOverride?.trim() || startFramePrompts[startFrameStyle];
  const startFrameLabel = startFrameLabels[startFrameStyle];
  const startFramePrompt = [
    startFramePromptBase,
    referenceAsset ? `Reference image URL: ${referenceAsset.signedUrl}.` : '',
    referenceSummary ? `Reference cues: ${referenceSummary}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  const draft = input.approvedScript?.trim()
    ? (() => {
        const script = ensureSentenceEnding(input.approvedScript.trim());
        const estimatedSeconds = estimateSpeechSeconds(script);
        return {
          script,
          targetSeconds: durationConfig.targetSeconds,
          estimatedSeconds,
          withinTarget: estimatedSeconds <= durationConfig.targetSeconds * 1.08,
          suggestedWords: Math.round(durationConfig.targetSeconds * 2.35),
          condensed: false,
          moodPreset,
          creativeIntent: effectiveIntent
        };
      })()
    : await generateScriptDraft({
        topic: input.topic,
        variantType: input.variantType,
        moodPreset,
        creativeIntent: effectiveIntent
      });

  if (!draft.withinTarget) {
    throw new ProviderRuntimeError(
      `SCRIPT_DURATION_EXCEEDS_TARGET:${draft.estimatedSeconds}s>${draft.targetSeconds}s`,
      { provider: 'openai', fatal: true }
    );
  }

  const llmText = draft.script;
  const storyboardPrompt = renderStoryboardLightPrompt(storyboardLight);

  const safetyConstraints = [
    `If on-screen text appears, keep it inside a title-safe area (${safeMarginPercent}% margin from all edges).`,
    'No caption text should touch the frame border.'
  ];

  const imageCompiled = compilePromptV2({
    baseSegments: [
      `Create a 9:16 keyframe image for this topic: ${input.topic}.`,
      `Storyboard concept: ${concept.label}. ${concept.imageDirection}`,
      `Mood: ${moodPromptMap[moodPreset]}`,
      startFramePrompt,
      storyboardPrompt,
      `Keep composition center-safe with at least ${safeMarginPercent}% margin on all sides.`,
      `Narration context: ${llmText}`
    ],
    intent: effectiveIntent,
    safetyConstraints,
    includeLegacyControls: legacyUserControlsProvided,
    legacyControls: legacyUserControls
  });

  const videoCompiled = compilePromptV2({
    baseSegments: [
      `Create a vertical social video about: ${input.topic}.`,
      `Storyboard concept: ${concept.label}. ${concept.videoDirection}`,
      `Mood: ${moodPromptMap[moodPreset]}`,
      motionGuardByVariant[input.variantType],
      `Hard motion target: minimum ${motionRequirement.minPhases} movement phases, max static shot ${motionRequirement.maxStaticSeconds} seconds.`,
      startFramePrompt,
      storyboardPrompt,
      `Narration text: ${llmText}`
    ],
    intent: effectiveIntent,
    safetyConstraints,
    includeLegacyControls: legacyUserControlsProvided,
    legacyControls: legacyUserControls
  });

  const imageBytes = await createImage(imageCompiled.prompt);
  const motionVideo = await createVideoWithMotionEnforcement({
    prompt: videoCompiled.prompt,
    variantType: input.variantType,
    requirement: motionRequirement
  });

  const imageAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/keyframe.png`, imageBytes, 'image/png', 'openai-image');
  const videoAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/segment.mp4`, motionVideo.video.bytes, 'video/mp4', 'openai-video');

  return {
    script: llmText,
    image: imageAsset,
    video: videoAsset,
    referenceAsset,
    videoModel: motionVideo.video.model,
    videoId: motionVideo.video.videoId,
    conceptId: concept.id,
    startFrameStyle,
    startFrameCandidateId: input.startFrameCandidateId,
    startFrameLabel,
    moodPreset,
    creativeIntent: effectiveIntent,
    storyboardLight,
    userControls: legacyUserControlsProvided ? legacyUserControls : undefined,
    promptCompiler: videoCompiled.meta,
    motionEnforcement: motionVideo.enforcement,
    scriptValidation: {
      targetSeconds: draft.targetSeconds,
      estimatedSeconds: draft.estimatedSeconds,
      suggestedWords: draft.suggestedWords,
      withinTarget: draft.withinTarget,
      condensed: draft.condensed
    }
  };
};

export const runAudioStage = async (input: { jobId: string; script: string }) => {
  await runProviderHealthchecks();

  const audio = await createTts(input.script);
  const audioAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/voice.mp3`, audio.bytes, 'audio/mpeg', audio.provider);

  return {
    audio: audioAsset,
    ttsProvider: audio.provider
  };
};

export const runAssemblyStage = async (input: {
  jobId: string;
  videoObjectPath: string;
  audioObjectPath: string;
  variantType: VariantType;
}) => {
  await runProviderHealthchecks();

  const { targetSeconds } = resolveVariantDurations(input.variantType);
  const safeArea = resolveCaptionSafeArea();
  const videoBytes = await supabaseDownload(input.videoObjectPath);
  const audioBytes = await supabaseDownload(input.audioObjectPath);
  const muxed = muxVideoAndAudio(videoBytes, audioBytes, targetSeconds, safeArea);

  const finalMotion = probeMotion(muxed.bytes, 'final_video');
  const finalAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/final.mp4`, muxed.bytes, 'video/mp4', 'ffmpeg');

  return {
    finalVideo: finalAsset,
    targetSeconds,
    safeArea,
    finalSync: muxed.sync,
    finalMotion
  };
};
