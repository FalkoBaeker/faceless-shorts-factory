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
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1.5',
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

type MotionSegmentReport = {
  segmentIndex: number;
  seconds: number;
  attemptCount: number;
  videoId: string;
  model: string;
  motion: MotionAnalysis;
  withinThreshold: boolean;
  lastFrameAssetPath?: string;
};

type MotionEnforcement = MotionAnalysis & {
  minPhasesRequired: number;
  maxStaticSecondsAllowed: number;
  withinThreshold: boolean;
  attempts: number;
  segmentPlanSeconds?: number[];
  segmentReports?: MotionSegmentReport[];
};

type StartFrameStyle =
  | 'storefront_hero'
  | 'product_macro'
  | 'owner_portrait'
  | 'hands_at_work'
  | 'before_after_split';

type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

type BrandProfile = {
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

type GenerationPayloadV1 = {
  topic: string;
  brandProfile: BrandProfile;
  creativeIntent: CreativeIntentMatrix;
  startFrame?: {
    style?: StartFrameStyle;
    candidateId?: string;
    customPrompt?: string;
    uploadObjectPath?: string;
    referenceHint?: string;
    summary?: string;
  };
  userEditedFlowScript?: string;
};

type VideoPlanV1 = {
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

type ScriptV2 = {
  language?: string;
  openingHook?: string;
  narration?: string;
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

type SoraPromptBlueprintSegment = {
  index: number;
  seconds: number;
  title?: string;
  startState: string;
  endState: string;
  prompt: string;
  userFlowBeat: string;
};

type SoraPromptBlueprint = {
  technicalSoraPrompt: string;
  userFlowScript: string;
  hook: string;
  continuityAnchors: string[];
  segments: SoraPromptBlueprintSegment[];
};

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

const inferExplicitHeroSubject = (topic: string) => {
  const lower = topic.toLowerCase();

  if (/bäck|brot|bröt|croissant|konditor|backstube/.test(lower)) {
    return 'eine Bäckereitheke mit goldbraunen Brötchen und Croissants, dazu ein gut lesbares Sommerangebot-Schild';
  }

  if (/pizza|pasta|restaurant|imbiss|café|kaffee|coffee/.test(lower)) {
    return 'ein frisch angerichtetes Signature-Gericht auf dem Tresen, mit sichtbarer Bedienung im Hintergrund';
  }

  if (/fitness|gym|workout|training/.test(lower)) {
    return 'eine Person im aktiven Training mit klar sichtbarer Übungsausführung im Studio';
  }

  if (/auto|car|werkstatt|garage/.test(lower)) {
    return 'ein Fahrzeug in klar erkennbarer Service- oder Anwendungssituation mit sichtbarer Aktion am Objekt';
  }

  return `eine klar benannte Hauptperson mit dem Kernprodukt aus dem Thema "${topic}" im realen Nutzungskontext`;
};

const stopwordsDe = new Set([
  'der',
  'die',
  'das',
  'und',
  'oder',
  'mit',
  'für',
  'von',
  'ein',
  'eine',
  'einer',
  'eines',
  'ist',
  'im',
  'in',
  'auf',
  'zu',
  'den',
  'dem',
  'des',
  'an',
  'am',
  'bei',
  'als',
  'auch',
  'noch',
  'nur'
]);

const tokenSetForOverlap = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopwordsDe.has(token))
  );

const referenceLikelyOffContext = (topic: string, referenceSummary: string) => {
  const topicTokens = tokenSetForOverlap(topic);
  const refTokens = tokenSetForOverlap(referenceSummary);
  if (!topicTokens.size || !refTokens.size) return false;

  let overlap = 0;
  for (const token of topicTokens) {
    if (refTokens.has(token)) overlap += 1;
  }

  const ratio = overlap / Math.max(1, topicTokens.size);
  return ratio < 0.15;
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
  const primary = String(cfg.openaiImageModel ?? 'gpt-image-1.5').trim() || 'gpt-image-1.5';
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

const buildSegmentPlanSeconds = (targetSeconds: number) => {
  const target = Math.max(4, Math.round(targetSeconds));

  if (target <= 15) return [8, 8];
  if (target <= 30) return [12, 12, 8];

  const plan: number[] = [];
  let remaining = target;

  while (remaining > 0) {
    if (remaining >= 12) {
      plan.push(12);
      remaining -= 12;
      continue;
    }

    if (remaining > 8) {
      plan.push(12);
      remaining -= 12;
      continue;
    }

    if (remaining > 4) {
      plan.push(8);
      remaining -= 8;
      continue;
    }

    plan.push(4);
    remaining -= 4;
  }

  return plan;
};

const scaleMotionRequirementForSegment = (input: { minPhases: number; maxStaticSeconds: number }, segmentSeconds: number) => {
  const normalizedSeconds = Math.min(12, Math.max(4, Math.round(segmentSeconds)));
  const minPhases = Math.max(3, Math.round((input.minPhases * normalizedSeconds) / 12));
  return {
    minPhases,
    maxStaticSeconds: input.maxStaticSeconds
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
  hookTemplateId: string | null;
  firstSecondQualityThreshold: 'strict' | 'relaxed';
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
  const isCalm = intent?.energyMode === 'calm';
  const intentBoost =
    intent?.energyMode === 'high' ||
    (intent?.effectGoals ?? []).some((entry) => ['sell_conversion', 'urgency_offer', 'cringe_hook'].includes(entry.id))
      ? 1
      : 0;

  const calmPhaseAdjustment = isCalm ? -2 : 0;
  const minPhases = Math.max(3, baseMin + motionBoostByControl[controls.motionIntensity] + intentBoost + calmPhaseAdjustment);

  const baseMaxStaticSeconds = controls.shotPace === 'fast' ? 2 : controls.shotPace === 'relaxed' ? 3 : 2.5;
  const maxStaticSeconds = roundSeconds(baseMaxStaticSeconds + (isCalm ? 0.8 : 0));

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
  const shotStyleSet = selectShotStyleSet(intent);

  return {
    text: [
      `Effect goals: ${intent.effectGoals.map((entry) => entry.id).join(', ') || 'default'}.`,
      `Narrative formats: ${intent.narrativeFormats.map((entry) => entry.id).join(', ') || 'default'}.`,
      `Energy mode: ${intent.energyMode ?? 'auto'}.`,
      `Visual language: ${shotStyleSet.map((tag) => shotStylePromptLibrary[tag]).join(' ')}`
    ]
      .filter(Boolean)
      .join(' '),
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
    ...beatLines,
    storyboardLight.hookHint ? `Hook hint: ${storyboardLight.hookHint}` : '',
    storyboardLight.ctaHint ? `CTA hint: ${storyboardLight.ctaHint}` : '',
    storyboardLight.pacingHint ? `Pacing hint: ${storyboardLight.pacingHint}` : ''
  ]
    .filter(Boolean)
    .join(' ');
};

const renderBrandProfilePrompt = (brandProfile?: BrandProfile) => {
  if (!brandProfile?.companyName?.trim()) return '';

  const segments = [
    `Brand company: ${brandProfile.companyName}.`,
    brandProfile.brandTone ? `Brand tone: ${brandProfile.brandTone}.` : '',
    brandProfile.valueProposition ? `Value proposition: ${brandProfile.valueProposition}.` : '',
    brandProfile.audienceHint ? `Audience hint: ${brandProfile.audienceHint}.` : '',
    brandProfile.websiteUrl ? `Website: ${brandProfile.websiteUrl}.` : '',
    brandProfile.ctaStyle ? `CTA style preference: ${brandProfile.ctaStyle}.` : ''
  ];

  return segments.filter(Boolean).join(' ');
};

const buildFlowBeatsPrompt = (input: { storyboardLight?: StoryboardLight; fallbackScript?: string }) => {
  const beats = input.storyboardLight?.beats?.slice().sort((a, b) => a.order - b.order) ?? [];
  if (beats.length) {
    return beats.map((beat) => `${beat.order}) ${beat.action}`).join(' | ');
  }

  const fallback = String(input.fallbackScript ?? '').trim();
  if (!fallback) return '1) Hook | 2) Core value | 3) Proof | 4) CTA';

  const segments = fallback
    .split(/(?<=[.!?…])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((segment, index) => `${index + 1}) ${segment}`);

  return segments.length ? segments.join(' | ') : '1) Hook | 2) Core value | 3) Proof | 4) CTA';
};

const compilePromptV3 = (input: {
  sceneIntent: string;
  hookOpening: string;
  flowBeats: string;
  lightingAnchors?: string;
  subjectConstraints: string[];
  outputConstraints: string[];
  intent: CreativeIntentMatrix;
  includeLegacyControls: boolean;
  legacyControls: UserControlProfile;
}) => {
  const intentPrompt = renderIntentPrompt(input.intent);
  const calmMode = input.intent.energyMode === 'calm';

  const sections = [
    `Scene/Intent: ${input.sceneIntent}. ${intentPrompt.text}`,
    `Hook (0-2s): ${input.hookOpening}`,
    `Flow-beats: ${input.flowBeats}`,
    input.lightingAnchors ? `Lighting/visual anchors: ${input.lightingAnchors}` : '',
    input.subjectConstraints.length ? `Subject constraints: ${input.subjectConstraints.join(' | ')}` : '',
    input.outputConstraints.length ? `Output constraints: ${input.outputConstraints.join(' | ')}` : ''
  ].filter(Boolean);

  if (input.includeLegacyControls) {
    sections.push(`Legacy controls mapped: ${renderLegacyUserControlPrompt(input.legacyControls)}`);
  }

  const prompt = sections.join('\n');

  const meta: PromptCompilerMeta = {
    intentRules: [
      ...input.intent.effectGoals.map((entry) => `effect:${entry.id}`),
      ...input.intent.narrativeFormats.map((entry) => `narrative:${entry.id}`),
      `energy:${input.intent.energyMode ?? 'auto'}`
    ],
    hookRule: calmMode ? null : 'HOOK_OPENING_INTEGRATED_V3',
    hookTemplateId: null,
    firstSecondQualityThreshold: calmMode ? 'relaxed' : 'strict',
    shotStyleSet: intentPrompt.shotStyleSet,
    safetyConstraints: input.outputConstraints,
    calmExceptionApplied: calmMode,
    appliedRules: ['PROMPT_COMPILER_V3_APPLIED', calmMode ? 'CALM_MODE_RELAXED_HOOK' : 'HOOK_0_2_REQUIRED'],
    suppressedRules: calmMode ? ['STRICT_HOOK_PUSH_SUPPRESSED_CALM_MODE'] : []
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

const parseStrictJson = <T>(raw: string): T | null => {
  const text = raw.trim();
  if (!text) return null;

  const direct = (() => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced) {
    try {
      return JSON.parse(fenced) as T;
    } catch {
      // noop
    }
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const inner = text.slice(first, last + 1);
    try {
      return JSON.parse(inner) as T;
    } catch {
      return null;
    }
  }

  return null;
};

const normalizeVideoPlanV1 = (raw: unknown): VideoPlanV1 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const hookOpening = String(input.hookOpening ?? '').trim().slice(0, 280);

  const flowBeatsRaw = Array.isArray(input.flowBeats) ? input.flowBeats : [];
  const flowBeats = flowBeatsRaw
    .slice(0, 8)
    .map((entry, index) => (entry && typeof entry === 'object' ? ({ ...(entry as Record<string, unknown>), index } as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const beat = String(entry.beat ?? '').trim().slice(0, 220);
      if (!beat) return null;
      const orderRaw = Number(entry.order);
      const order = Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : Number(entry.index) + 1;
      return {
        order,
        beat,
        visualHint: String(entry.visualHint ?? '').trim().slice(0, 180) || undefined,
        onScreenTextHint: String(entry.onScreenTextHint ?? '').trim().slice(0, 120) || undefined
      };
    })
    .filter((entry): entry is VideoPlanV1['flowBeats'][number] => Boolean(entry))
    .sort((a, b) => a.order - b.order);

  const scriptRaw = input.script && typeof input.script === 'object' ? (input.script as Record<string, unknown>) : null;
  const scenesRaw = scriptRaw && Array.isArray(scriptRaw.scenes) ? scriptRaw.scenes : [];
  const scenes = scenesRaw
    .slice(0, 10)
    .map((entry, index) => (entry && typeof entry === 'object' ? ({ ...(entry as Record<string, unknown>), index } as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const action = String(entry.action ?? '').trim().slice(0, 240);
      if (!action) return null;
      const orderRaw = Number(entry.order);
      const order = Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : Number(entry.index) + 1;
      const linesRaw = Array.isArray(entry.lines) ? entry.lines : [];
      const lines = linesRaw
        .slice(0, 10)
        .map((line) => (line && typeof line === 'object' ? (line as Record<string, unknown>) : null))
        .filter((line): line is Record<string, unknown> => Boolean(line))
        .map((line) => {
          const speaker = String(line.speaker ?? '').trim().slice(0, 40);
          const text = String(line.text ?? '').trim().slice(0, 180);
          if (!speaker || !text) return null;
          return { speaker, text };
        })
        .filter((line): line is { speaker: string; text: string } => Boolean(line));
      return {
        order,
        action,
        lines: lines.length ? lines : undefined,
        onScreenText: String(entry.onScreenText ?? '').trim().slice(0, 120) || undefined
      };
    })
    .filter((entry): entry is VideoPlanV1['script']['scenes'][number] => Boolean(entry))
    .sort((a, b) => a.order - b.order);

  const narration = String(scriptRaw?.narration ?? '').trim().slice(0, 2200);

  if (!hookOpening || !flowBeats.length || !narration) return null;

  return {
    hookOpening,
    flowBeats,
    script: {
      narration,
      scenes
    },
    subjectConstraints: Array.isArray(input.subjectConstraints)
      ? input.subjectConstraints.map((value) => String(value).trim()).filter(Boolean).slice(0, 10)
      : [],
    promptDirectives: Array.isArray(input.promptDirectives)
      ? input.promptDirectives.map((value) => String(value).trim()).filter(Boolean).slice(0, 10)
      : []
  };
};

const fallbackVideoPlanV1 = (topic: string, userEditedFlowScript?: string): VideoPlanV1 => {
  const edited = String(userEditedFlowScript ?? '').trim();
  const narration =
    edited ||
    `Achtung: ${topic}. Wir zeigen in wenigen Sekunden das Kernproblem, direkt die Lösung und schließen mit einer klaren nächsten Aktion.`;

  return {
    hookOpening: `Achtung: ${topic}.`,
    flowBeats: [
      { order: 1, beat: `Hook in Bewegung rund um ${topic}` },
      { order: 2, beat: 'Konkrete Problemszene im Alltag' },
      { order: 3, beat: 'Lösungsschritt mit sichtbarer Veränderung' },
      { order: 4, beat: 'Abschlussbild mit klarem CTA' }
    ],
    script: {
      narration: ensureSentenceEnding(narration),
      scenes: [
        { order: 1, action: `Vertikale Kamerafahrt auf ${inferExplicitHeroSubject(topic)}, sofortige Bewegung im Bild.` },
        { order: 2, action: 'Alltagsszene mit klar erkennbarem Problem, fokussiert auf eine Person im echten Kontext.' },
        { order: 3, action: 'Sichtbarer Lösungsschritt in Nahaufnahme mit Vorher/Nachher-Effekt im selben Bewegungsfluss.' },
        { order: 4, action: 'Abschlussshot mit Produkt/Angebot im Zentrum und klarer CTA-Situation im Bild.' }
      ]
    },
    subjectConstraints: ['Subjekt über alle Beats konsistent halten.', 'Markenstil in Sprache und Visuals stabil halten.'],
    promptDirectives: ['Hook in Sekunde 0-2 sichtbar machen.', 'Ablauf klar, kurz und sprechbar halten.']
  };
};

const generateVideoPlan = async (input: {
  topic: string;
  creativeIntent: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
  energyMode?: 'auto' | 'high' | 'calm';
  startFrameHint?: string;
  userEditedFlowScript?: string;
}): Promise<VideoPlanV1> => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.015, 'llm-video-plan-v1');

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-5-mini',
    input:
      'Erzeuge ausschließlich valides JSON für ein VideoPlanV1-Objekt. Keine Markdown-Ausgabe. ' +
      `Topic: ${input.topic}. ` +
      `${renderIntentPrompt(input.creativeIntent).text} ` +
      `${renderBrandProfilePrompt(input.brandProfile)} ` +
      `${input.startFrameHint ? `Startframe-Hinweis: ${input.startFrameHint}. ` : ''}` +
      `${input.userEditedFlowScript ? `User-Entwurf: ${input.userEditedFlowScript}. ` : ''}` +
      `Pflicht: hookOpening muss in Sekunde 0-2 funktionieren. 4-6 flowBeats. ` +
      `Pflicht: script.scenes muss konkrete, sichtbare Handlungen enthalten (kein reines Umschreiben der Narration). ` +
      `Pflicht: jede Szene braucht klar unterschiedliche Bildsprache/Shot-Idee, keine Wiederholung desselben Ausschnitts. ` +
      `Verboten in script.scenes.action: Meta-Formulierungen wie \"Zeige...\", \"Szene X:\" oder abstrakte Platzhalter ohne Shot-Detail. ` +
      `Verboten sind unscharfe Begriffe wie \"zentrales Motiv\", \"Hauptmotiv\", \"Thema visualisieren\" ohne konkrete Benennung. ` +
      `Jede action muss als konkrete Shot-Beschreibung formuliert sein (konkretes Subjekt/Objekt + sichtbare Bewegung + Kontext/Ort). ` +
      `Verboten als Default-Motiv: \"hands at work\", außer es steht explizit im Topic/User-Input. ` +
      `JSON-Schema: {"hookOpening":string,"flowBeats":[{"order":number,"beat":string,"visualHint"?:string,"onScreenTextHint"?:string}],"script":{"narration":string,"scenes":[{"order":number,"action":string,"lines"?:[{"speaker":string,"text":string}],"onScreenText"?:string}]},"subjectConstraints":string[],"promptDirectives":string[]}`,
    max_output_tokens: 1200
  });

  const raw = parseOpenAiResponseText(response);
  const parsed = parseStrictJson<unknown>(raw);
  const normalized = normalizeVideoPlanV1(parsed);
  if (!normalized) {
    throw new ProviderRuntimeError('VIDEO_PLAN_V1_INVALID_JSON', { provider: 'openai', fatal: false });
  }
  return normalized;
};

const reconcileVideoPlan = async (input: {
  topic: string;
  currentPlan: VideoPlanV1;
  userEditedFlowScript: string;
  creativeIntent: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
  energyMode?: 'auto' | 'high' | 'calm';
}): Promise<VideoPlanV1> => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.012, 'llm-video-plan-v1-reconcile');

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-5-mini',
    input:
      'Erzeuge ausschließlich valides JSON für ein VideoPlanV1-Objekt. Keine Markdown-Ausgabe. ' +
      `Topic: ${input.topic}. ` +
      `Aktueller Plan JSON: ${JSON.stringify(input.currentPlan)}. ` +
      `User-Edit (muss primär respektiert werden): ${input.userEditedFlowScript}. ` +
      `${renderIntentPrompt(input.creativeIntent).text} ` +
      `${renderBrandProfilePrompt(input.brandProfile)} ` +
      'Aufgabe: repariere nur Hook/Flow/Konsistenz, ohne den User-Text unnötig umzuschreiben.',
    max_output_tokens: 1200
  });

  const raw = parseOpenAiResponseText(response);
  const parsed = parseStrictJson<unknown>(raw);
  const normalized = normalizeVideoPlanV1(parsed);
  if (!normalized) {
    throw new ProviderRuntimeError('VIDEO_PLAN_V1_RECONCILE_INVALID_JSON', { provider: 'openai', fatal: false });
  }
  return normalized;
};

const flowBeatLooksGeneric = (value: string) => {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return (
    /\b(konkrete?r?\s+schritt|zentrales?\s+motiv|kamera\s+folgt|sichtbare\s+weiterentwicklung|hook\s*\+\s*setup|payoff|cta\s*-?szene|eindeutige\s+handlungsaufforderung)\b/.test(
      text
    ) || text.length < 28
  );
};

const concreteFlowBeatFallback = (input: {
  index: number;
  topic: string;
  explicitHeroSubject: string;
  brandName?: string;
}) => {
  const brandCue = input.brandName ? `Marke sichtbar: ${input.brandName}.` : '';
  const templates = [
    `Hook-Shot: Hauptfigur tritt ins Bild, interagiert sofort mit ${input.explicitHeroSubject}; klare Startaktion in den ersten 2 Sekunden. ${brandCue}`,
    `Kontext-Shot: Reale Alltagsszene zum Thema ${input.topic}; sichtbare Interaktion mit Produkt/Umgebung, ohne Szenen-Reset. ${brandCue}`,
    `Detail-Shot: Nahaufnahme einer konkreten Nutzungshandlung; Fokuswechsel zeigt Material, Bewegung und Ergebnis klar hintereinander.`,
    `Entwicklungs-Shot: Zweite Handlung im selben Ort mit neuer Kameraperspektive; Story geht sichtbar vorwärts statt Wiederholung.`,
    `Ergebnis-Shot: Reaktion der Person auf das Resultat; Nutzen ist im Bild direkt ablesbar, Kontext bleibt konsistent.`,
    `CTA-Shot: Abschlusshandlung mit Blick zur Kamera; Angebot und nächste Aktion sind klar sichtbar und zum Thema passend. ${brandCue}`
  ];

  return ensureSentenceEnding(templates[(input.index - 1) % templates.length]);
};

const buildFallbackSoraPromptBlueprint = (input: {
  technicalSoraPrompt: string;
  hook: string;
  flowBeatsPrompt: string;
  continuityAnchors: string[];
  segmentPlanSeconds: number[];
  topic: string;
  explicitHeroSubject: string;
  brandName?: string;
}): SoraPromptBlueprint => {
  const segments = input.segmentPlanSeconds.map((seconds, idx) => ({
    index: idx + 1,
    seconds,
    title: idx === 0 ? 'Hook + Setup' : idx === input.segmentPlanSeconds.length - 1 ? 'Payoff + CTA' : 'Escalation',
    startState: idx === 0 ? 'Start from selected startframe anchor.' : `Continue directly from segment ${idx} end frame and action.`,
    endState: idx === input.segmentPlanSeconds.length - 1 ? 'Resolve with clear CTA while preserving subject identity.' : 'End in a clear transition state for next segment.',
    prompt:
      `Segment ${idx + 1}/${input.segmentPlanSeconds.length} (${seconds}s). ` +
      `Use this technical base prompt and move narrative forward without resets: ${input.technicalSoraPrompt}`,
    userFlowBeat: concreteFlowBeatFallback({
      index: idx + 1,
      topic: input.topic,
      explicitHeroSubject: input.explicitHeroSubject,
      brandName: input.brandName
    })
  }));

  return {
    technicalSoraPrompt: input.technicalSoraPrompt,
    userFlowScript: segments.map((segment) => `${segment.index}. ${segment.userFlowBeat}`).join('\n'),
    hook: input.hook,
    continuityAnchors: input.continuityAnchors,
    segments
  };
};

const normalizeSoraPromptBlueprint = (
  raw: unknown,
  segmentPlanSeconds: number[],
  context: { topic: string; explicitHeroSubject: string; brandName?: string }
): SoraPromptBlueprint | null => {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const technicalSoraPrompt = String(input.technicalSoraPrompt ?? '').trim().slice(0, 8000);
  const hook = String(input.hook ?? '').trim().slice(0, 280);
  const continuityAnchors = Array.isArray(input.continuityAnchors)
    ? input.continuityAnchors.map((value) => String(value).trim()).filter(Boolean).slice(0, 16)
    : [];

  const rawSegments = Array.isArray(input.segments) ? input.segments : [];
  const segmentsByIndex = new Map<number, SoraPromptBlueprintSegment>();

  for (const entry of rawSegments) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const index = Math.max(1, Math.floor(Number(row.index) || 0));
    if (!index) continue;

    const prompt = String(row.prompt ?? '').trim().slice(0, 3000);
    const startState = String(row.startState ?? '').trim().slice(0, 800);
    const endState = String(row.endState ?? '').trim().slice(0, 800);
    const userFlowBeatRaw = String(row.userFlowBeat ?? '').trim().slice(0, 320);
    const userFlowBeat = flowBeatLooksGeneric(userFlowBeatRaw)
      ? concreteFlowBeatFallback({
          index,
          topic: context.topic,
          explicitHeroSubject: context.explicitHeroSubject,
          brandName: context.brandName
        })
      : userFlowBeatRaw;
    if (!prompt || !startState || !endState || !userFlowBeat) continue;

    segmentsByIndex.set(index, {
      index,
      seconds: Math.min(12, Math.max(4, Math.round(Number(row.seconds) || 0) || segmentPlanSeconds[index - 1] || 8)),
      title: String(row.title ?? '').trim().slice(0, 120) || undefined,
      startState,
      endState,
      prompt,
      userFlowBeat
    });
  }

  const alignedSegments: SoraPromptBlueprintSegment[] = segmentPlanSeconds.map((seconds, idx) => {
    const fallback = segmentsByIndex.get(idx + 1);
    if (!fallback) return null;
    return {
      ...fallback,
      index: idx + 1,
      seconds
    };
  }).filter((segment): segment is SoraPromptBlueprintSegment => Boolean(segment));

  if (!technicalSoraPrompt || alignedSegments.length !== segmentPlanSeconds.length) return null;

  const userFlowScriptRaw = String(input.userFlowScript ?? '').trim().slice(0, 4000);
  const rawLooksGeneric = flowBeatLooksGeneric(userFlowScriptRaw.replace(/\d+[.)]\s*/g, '').slice(0, 280));
  const userFlowScript = !userFlowScriptRaw || rawLooksGeneric
    ? alignedSegments.map((segment) => `${segment.index}. ${segment.userFlowBeat}`).join('\n')
    : userFlowScriptRaw;

  return {
    technicalSoraPrompt,
    userFlowScript,
    hook,
    continuityAnchors,
    segments: alignedSegments
  };
};

const generateSoraPromptBlueprint = async (input: {
  topic: string;
  targetSeconds: number;
  segmentPlanSeconds: number[];
  hookOpening: string;
  narration: string;
  flowBeatsPrompt: string;
  technicalBasePrompt: string;
  explicitHeroSubject: string;
  startFrameDirective: string;
  startFrameTransitionDirective: string;
  intentPrompt: string;
  brandPrompt: string;
  brandName?: string;
  moodPrompt: string;
  userEditedFlowScript?: string;
}): Promise<SoraPromptBlueprint> => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.012, 'llm-sora-prompt-blueprint');

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-5-mini',
    input:
      'Du bist ein Prompt-Architect für Sora. Gib ausschließlich valides JSON zurück, keine Markdown-Texte. ' +
      `Topic: ${input.topic}. Ziel: ${input.targetSeconds}s TikTok-Video mit durchgehendem Flow. ` +
      `Segmentplan (hart): ${JSON.stringify(input.segmentPlanSeconds)}. ` +
      `Hook: ${input.hookOpening}. ` +
      `Narration: ${input.narration}. ` +
      `Flow beats: ${input.flowBeatsPrompt}. ` +
      `Explizites Hero-Subjekt: ${input.explicitHeroSubject}. ` +
      `Startframe directive: ${input.startFrameDirective}. ` +
      `Startframe transition directive: ${input.startFrameTransitionDirective}. ` +
      `Intent: ${input.intentPrompt}. Brand: ${input.brandPrompt}. Mood: ${input.moodPrompt}. ` +
      `${input.brandName ? `Visible brand text/logos must use exactly this name when shown: "${input.brandName}". Never invent other bakery/company names. ` : ''}` +
      `${input.userEditedFlowScript ? `User gewünschter Ablauf (priorisieren): ${input.userEditedFlowScript}. ` : ''}` +
      `Technischer Basis-Prompt (weiterentwickeln, nicht stumpf kopieren): ${input.technicalBasePrompt}. ` +
      'Wichtig: kein Loop-Content, keine Reset-Shots, jedes Segment muss visuell vorwärts entwickeln. ' +
      'userFlowScript und userFlowBeat müssen auf Deutsch, klar und nicht-technisch sein (was sieht der Zuschauer konkret). ' +
      'Keine generischen Phrasen wie "konkreter Schritt", "zentrales Motiv", "Kamera folgt" ohne benanntes Objekt/Subjekt. ' +
      'JSON Schema: ' +
      '{"technicalSoraPrompt":string,"userFlowScript":string,"hook":string,"continuityAnchors":string[],"segments":[{"index":number,"seconds":number,"title":string,"startState":string,"endState":string,"prompt":string,"userFlowBeat":string}]}.',
    max_output_tokens: 2600
  });

  const raw = parseOpenAiResponseText(response);
  const parsed = parseStrictJson<unknown>(raw);
  const normalized = normalizeSoraPromptBlueprint(parsed, input.segmentPlanSeconds, {
    topic: input.topic,
    explicitHeroSubject: input.explicitHeroSubject,
    brandName: input.brandName
  });
  if (!normalized) {
    throw new ProviderRuntimeError('SORA_PROMPT_BLUEPRINT_INVALID_JSON', { provider: 'openai', fatal: false });
  }

  return normalized;
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

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeOrthographyLight = (text: string) => {
  const normalized = text
    .replace(/\bnäckster\b/gi, 'nächster')
    .replace(/\bnaechster\b/gi, 'nächster')
    .replace(/\buber\b/gi, 'über')
    .replace(/\s+/g, ' ')
    .trim();

  return ensureSentenceEnding(normalized);
};

const applyBrandTermLock = (text: string, brandProfile?: BrandProfile) => {
  const brandTerm = String(brandProfile?.companyName ?? '').trim();
  if (!brandTerm) return text;

  const pattern = new RegExp(escapeRegex(brandTerm), 'gi');
  return text.replace(pattern, brandTerm);
};

const finalizeScriptLanguage = (text: string, brandProfile?: BrandProfile) =>
  applyBrandTermLock(normalizeOrthographyLight(text), brandProfile);

const createScriptFromLlm = async (
  topic: string,
  variantType: VariantType,
  moodPreset: MoodPreset,
  creativeIntent?: CreativeIntentMatrix,
  brandProfile?: BrandProfile,
  startFrameHint?: string
) => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.01, 'llm-script');

  const { targetSeconds } = resolveVariantDurations(variantType);
  const targetWords = Math.round(targetSeconds * 2.35);
  const moodPrompt = moodPromptMap[moodPreset];
  const intentPrompt = creativeIntent ? renderIntentPrompt(creativeIntent).text : '';
  const brandPrompt = renderBrandProfilePrompt(brandProfile);
  const startFramePrompt = String(startFrameHint ?? '').trim()
    ? `Startbild-Kontext (muss in Hook/Ablauf berücksichtigt werden): ${String(startFrameHint).trim()}.`
    : '';

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-4o-mini',
    input:
      `Erstelle ein deutsches Voiceover-Skript für ein Kurzvideo zum Thema: "${topic}". ` +
      `Ziel-Länge: ca. ${targetSeconds} Sekunden, etwa ${targetWords} Wörter. ` +
      `${moodPrompt} ` +
      `${intentPrompt} ` +
      `${brandPrompt} ` +
      `${startFramePrompt} ` +
      'Das Skript muss mit einem vollständigen, abgeschlossenen Satz enden. ' +
      'In der ersten Sekunde muss der Hook spürbar sein, außer im calm-mode. ' +
      'Gib nur den gesprochenen Text aus, ohne Überschrift oder Bulletpoints. Schreibe in kurzen, schnellen Sätzen (TikTok-Tempo), ohne Füller.',
    max_output_tokens: Math.max(220, Math.round(targetWords * 2.4))
  });
  const text = parseOpenAiResponseText(response);
  if (!text) {
    throw new ProviderRuntimeError('LLM_EMPTY_OUTPUT', { provider: 'openai', fatal: true });
  }
  return finalizeScriptLanguage(text, brandProfile);
};

const condenseScriptToTarget = async (
  script: string,
  targetSeconds: number,
  targetWords: number,
  moodPreset: MoodPreset,
  creativeIntent?: CreativeIntentMatrix,
  brandProfile?: BrandProfile
) => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.008, 'llm-script-condense');

  const intentPrompt = creativeIntent ? renderIntentPrompt(creativeIntent).text : '';
  const brandPrompt = renderBrandProfilePrompt(brandProfile);

  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-4o-mini',
    input:
      `Kürze dieses deutsche Voiceover-Skript auf maximal ${targetWords} Wörter (ca. ${targetSeconds} Sekunden). ` +
      `${moodPromptMap[moodPreset]} ` +
      `${intentPrompt} ` +
      `${brandPrompt} ` +
      'Bewahre den roten Faden und einen klaren CTA. Der letzte Satz muss vollständig sein. ' +
      `Text: """${script}""". Gib nur den finalen gesprochenen Text aus.`,
    max_output_tokens: Math.max(180, Math.round(targetWords * 2.2))
  });

  const text = parseOpenAiResponseText(response);
  if (!text) return finalizeScriptLanguage(script, brandProfile);
  return finalizeScriptLanguage(text, brandProfile);
};

export const generateScriptDraft = async (input: {
  topic: string;
  variantType: VariantType;
  moodPreset?: MoodPreset;
  creativeIntent?: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
  startFrameHint?: string;
  regenerate?: boolean;
}) => {
  await runProviderHealthchecks();

  const moodPreset = resolveMoodPreset(input.moodPreset);
  const effectiveIntent = resolveEffectiveIntent(input.creativeIntent, moodPreset, 'concept_web_vertical_slice');
  const { targetSeconds } = resolveVariantDurations(input.variantType);
  const targetWords = Math.round(targetSeconds * 2.35);

  let script = await createScriptFromLlm(
    input.topic,
    input.variantType,
    moodPreset,
    effectiveIntent,
    input.brandProfile,
    input.startFrameHint
  );
  script = finalizeScriptLanguage(script, input.brandProfile);
  let estimatedSeconds = estimateSpeechSeconds(script);

  const maxDurationRepairAttempts = Math.max(1, Math.min(2, Number(process.env.SCRIPT_AUTO_REPAIR_ATTEMPTS ?? 2)));
  let durationRepairAttempts = 0;

  while (estimatedSeconds > targetSeconds * 1.08 && durationRepairAttempts < maxDurationRepairAttempts) {
    const condensedScript = await condenseScriptToTarget(script, targetSeconds, targetWords, moodPreset, effectiveIntent, input.brandProfile);
    durationRepairAttempts += 1;
    if (condensedScript.trim() === script.trim()) break;
    script = finalizeScriptLanguage(condensedScript, input.brandProfile);
    estimatedSeconds = estimateSpeechSeconds(script);
  }

  const condensed = durationRepairAttempts > 0;
  const withinTarget = estimatedSeconds <= targetSeconds * 1.08;
  const scriptV2 = await buildScriptV2ForDraft({
    topic: input.topic,
    narration: script,
    variantType: input.variantType,
    moodPreset,
    creativeIntent: effectiveIntent,
    brandProfile: input.brandProfile,
    startFrameHint: input.startFrameHint
  });

  return {
    script,
    scriptV2,
    moodPreset,
    creativeIntent: effectiveIntent,
    targetSeconds,
    suggestedWords: targetWords,
    estimatedSeconds,
    withinTarget,
    condensed
  };
};

const sceneActionLooksMeta = (action: string) => {
  const value = action.trim().toLowerCase();
  return (
    /^szene\s*\d+[:.)]?/.test(value) ||
    /^\s*(zeige|zeigen|zeig|darstellen|präsentiere|visualisiere)\b/.test(value) ||
    value.includes('konkrete sichtbare handlung') ||
    /\b(zentrales?\s+motiv|hauptmotiv|thema\s+visualisieren)\b/.test(value)
  );
};

const extractActionDetail = (action: string, fallback: string) => {
  const base = action
    .replace(/^\s*szene\s*\d+[:.)]?\s*/i, '')
    .replace(/^\s*(zeige|zeigen|zeig|darstellen|präsentiere|visualisiere)\s+/i, '')
    .replace(/^\s*(eine\s+)?(konkrete\s+)?(sichtbare\s+)?handlung\s*(zu\s*:?\s*)?/i, '')
    .replace(/^\s*zu\s*:?\s*/i, '')
    .trim();

  return (base || fallback).replace(/[.!?…]+$/g, '').trim();
};

const concreteSceneAction = (input: { topic: string; detail: string; index: number }) => {
  const detail = input.detail || input.topic;
  const heroSubject = inferExplicitHeroSubject(input.topic);
  const templates = [
    `Shot 1 Hook: Vertikale Kamerafahrt auf ${heroSubject}; eine Person führt sofort eine klare Startaktion aus, die ${detail} visuell einführt.`,
    `Shot 2 Kontext: Halbtotale im realen Umfeld; Hauptfigur interagiert direkt mit ${heroSubject}, während ${detail} im Bild klar lesbar bleibt.`,
    `Shot 3 Detail: Nahe Aufnahme mit Fokuswechsel von Objekt auf Handlung; sichtbarer Mikromoment der Nutzung rund um ${detail}.`,
    `Shot 4 Entwicklung: Perspektivwechsel auf eine zweite Bewegung derselben Szene; der Ablauf geht sichtbar vorwärts ohne Reset auf den Anfang.`,
    `Shot 5 Ergebnis: Reaktionsshot im selben Ort, klare Wirkung im Gesicht/Objekt erkennbar; ${detail} bleibt kontexttreu eingebunden.`,
    `Shot 6 CTA: Abschlussshot im selben Laden; die Hauptfigur hält ein konkretes Produkt in die Kamera, zeigt auf ein klar lesbares Angebotsschild und macht eine sichtbare Einladegeste.`
  ];

  return ensureSentenceEnding(templates[input.index % templates.length]);
};

const fallbackScriptV2FromNarration = (topic: string, narration: string): ScriptV2 => {
  const sentences = narration
    .split(/(?<=[.!?…])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 6);

  const sourceSentences = sentences.length
    ? sentences
    : [`${topic} sofort sichtbar machen.`, 'Kernnutzen konkret machen.', 'Mit klarem CTA abschließen.'];

  const scenes = sourceSentences.map((sentence, index) => {
    const cleaned = sentence.replace(/[.!?…]+$/g, '').trim();
    return {
      order: index + 1,
      action: concreteSceneAction({ topic, detail: cleaned || topic, index })
    };
  });

  const openingHook = ensureSentenceEnding(sourceSentences[0] ?? `Stop scrolling: ${topic}.`);

  return {
    language: 'de',
    openingHook,
    narration,
    scenes
  };
};

const buildScriptV2ForDraft = async (input: {
  topic: string;
  narration: string;
  variantType: VariantType;
  moodPreset: MoodPreset;
  creativeIntent: CreativeIntentMatrix;
  brandProfile?: BrandProfile;
  startFrameHint?: string;
}): Promise<ScriptV2> => {
  try {
    const { targetSeconds } = resolveVariantDurations(input.variantType);
    const segmentPlanSeconds = buildSegmentPlanSeconds(targetSeconds);
    const hookOpening = ensureSentenceEnding(input.narration.split(/[.!?…]/)[0]?.trim() || `Stop scrolling: ${input.topic}.`);
    const flowBeatsPrompt = input.narration
      .split(/(?<=[.!?…])\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((value, index) => `${index + 1}) ${value}`)
      .join(' | ');

    const technicalBasePrompt = [
      `Topic: ${input.topic}`,
      `Narration: ${input.narration}`,
      `Intent: ${renderIntentPrompt(input.creativeIntent).text}`,
      `Brand: ${renderBrandProfilePrompt(input.brandProfile)}`,
      `Startframe: ${input.startFrameHint || inferExplicitHeroSubject(input.topic)}`,
      `Output: 9:16 TikTok style, target ${targetSeconds}s, no loops, consistent subject identity.`
    ]
      .filter(Boolean)
      .join(' | ');

    const blueprint = await generateSoraPromptBlueprint({
      topic: input.topic,
      targetSeconds,
      segmentPlanSeconds,
      hookOpening,
      narration: input.narration,
      flowBeatsPrompt: flowBeatsPrompt || `1) ${input.narration}`,
      technicalBasePrompt,
      explicitHeroSubject: inferExplicitHeroSubject(input.topic),
      startFrameDirective: input.startFrameHint || '',
      startFrameTransitionDirective: input.startFrameHint
        ? `Start from uploaded/selected startframe context: ${input.startFrameHint}`
        : `Start from generated hero subject: ${inferExplicitHeroSubject(input.topic)}`,
      intentPrompt: renderIntentPrompt(input.creativeIntent).text,
      brandPrompt: renderBrandProfilePrompt(input.brandProfile),
      brandName: String(input.brandProfile?.companyName ?? '').trim() || undefined,
      moodPrompt: moodPromptMap[input.moodPreset],
      userEditedFlowScript: input.narration
    });

    const scenes = blueprint.segments
      .map((segment) => ({
        order: segment.index,
        action: ensureSentenceEnding(segment.userFlowBeat || segment.startState),
        onScreenText: undefined,
        lines: undefined
      }))
      .filter((scene) => scene.action.length >= 8)
      .sort((a, b) => a.order - b.order);

    if (!scenes.length) return fallbackScriptV2FromNarration(input.topic, input.narration);

    return {
      language: 'de',
      openingHook: ensureSentenceEnding(blueprint.hook || hookOpening),
      narration: input.narration,
      scenes
    };
  } catch (error) {
    logEvent({
      event: 'script_v2_draft_fallback',
      level: 'WARN',
      provider: 'openai',
      detail: `reason=${String((error as Error)?.message ?? error).slice(0, 180)}`
    });

    return fallbackScriptV2FromNarration(input.topic, input.narration);
  }
};

const createImage = async (prompt: string) => {
  reserveBudget(0.04, 'image-generation');

  const models = resolveImageModelOrder();
  let lastError: unknown = null;
  const attemptedModels: string[] = [];

  for (const model of models) {
    attemptedModels.push(model);
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

      return {
        bytes: Buffer.from(b64, 'base64'),
        diagnostics: {
          configuredPrimaryModel: models[0],
          configuredFallbackModel: models.length > 1 ? models[models.length - 1] : null,
          attemptedModels,
          modelUsed: model,
          fallbackUsed: model !== models[0]
        }
      };
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

const createVideo = async (
  prompt: string,
  input: { variantType: VariantType; secondsOverride?: number }
) => {
  checkRate('video', cfg.maxRpmVideo);
  const { sourceSeconds } = resolveVariantDurations(input.variantType);
  const effectiveSeconds = Math.min(12, Math.max(4, Math.round(input.secondsOverride ?? sourceSeconds)));
  const seconds = String(effectiveSeconds);
  const model = 'sora-2';
  const estimated = effectiveSeconds * 0.1;
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
    const imageResult = await createImage(thumbPrompt);
    const objectPath = `catalog/startframe-thumbnails/${sanitizeSegment(input.candidateId, 'candidate')}.png`;
    const asset = await uploadAsset('catalog-startframe', objectPath, imageResult.bytes, 'image/png', 'openai-image-thumbnail');
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
  calmMode?: boolean;
  secondsOverride?: number;
  segmentLabel?: string;
}) => {
  const baseAttempts = Math.max(1, Number(process.env.MOTION_ENFORCEMENT_ATTEMPTS ?? 2));
  const maxAttempts = input.calmMode ? Math.min(4, baseAttempts + 1) : baseAttempts;
  const baseStaticTolerance = parseRangeFloat(process.env.MOTION_STATIC_TOLERANCE_SECONDS ?? 0.15, 0.15, 0, 1.2);
  const staticTolerance = input.calmMode ? Math.min(1.8, baseStaticTolerance + 0.35) : baseStaticTolerance;
  const requiredMinPhases = input.calmMode ? Math.max(3, input.requirement.minPhases - 1) : input.requirement.minPhases;

  let attempt = 0;
  let prompt = input.prompt;
  let lastVideo: Awaited<ReturnType<typeof createVideo>> | null = null;
  let lastMetrics: MotionAnalysis | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const video = await createVideo(prompt, {
      variantType: input.variantType,
      secondsOverride: input.secondsOverride
    });
    const metrics = probeMotion(video.bytes, `${input.segmentLabel ?? 'segment'}_attempt_${attempt}`);

    const withinThreshold =
      metrics.motionPhases >= requiredMinPhases &&
      metrics.longestStaticSeconds <= input.requirement.maxStaticSeconds + staticTolerance;

    lastVideo = video;
    lastMetrics = metrics;

    if (withinThreshold) {
      return {
        video,
        enforcement: {
          ...metrics,
          minPhasesRequired: requiredMinPhases,
          maxStaticSecondsAllowed: roundSeconds(input.requirement.maxStaticSeconds + staticTolerance),
          withinThreshold: true,
          attempts: attempt
        } as MotionEnforcement
      };
    }

    if (attempt < maxAttempts) {
      prompt = [
        input.prompt,
        `Retry with stronger motion: ensure at least ${requiredMinPhases} distinct movement phases and no static shot longer than ${roundSeconds(input.requirement.maxStaticSeconds + staticTolerance)}s.`
      ].join(' ');
    }
  }

  const nearMissPhaseSlack = Math.max(0, Number(process.env.MOTION_NEAR_MISS_PHASE_SLACK ?? 1));
  const nearMissStaticSlack = parseRangeFloat(process.env.MOTION_NEAR_MISS_STATIC_SLACK_SECONDS ?? 0.8, 0.8, 0, 2.5);

  if (lastMetrics && lastVideo) {
    const nearMissAccepted =
      lastMetrics.motionPhases >= requiredMinPhases - nearMissPhaseSlack &&
      lastMetrics.longestStaticSeconds <= roundSeconds(input.requirement.maxStaticSeconds + staticTolerance + nearMissStaticSlack);

    if (nearMissAccepted) {
      return {
        video: lastVideo,
        enforcement: {
          ...lastMetrics,
          minPhasesRequired: requiredMinPhases,
          maxStaticSecondsAllowed: roundSeconds(input.requirement.maxStaticSeconds + staticTolerance),
          withinThreshold: false,
          attempts: maxAttempts
        } as MotionEnforcement
      };
    }

    throw new ProviderRuntimeError(
      `MOTION_ENFORCEMENT_FAILED:phases=${lastMetrics.motionPhases}/${requiredMinPhases}:longest_static=${lastMetrics.longestStaticSeconds}s>${roundSeconds(input.requirement.maxStaticSeconds + staticTolerance)}s`,
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
      minPhasesRequired: requiredMinPhases,
      maxStaticSecondsAllowed: roundSeconds(input.requirement.maxStaticSeconds + staticTolerance),
      withinThreshold: false,
      attempts: maxAttempts
    } as MotionEnforcement
  };
};

const extractLastFramePng = (videoBytes: Buffer, label: string): Buffer | null => {
  const dir = mkdtempSync(join(tmpdir(), `fsf-last-frame-${label}-`));
  const input = join(dir, 'input.mp4');
  const output = join(dir, 'last-frame.png');

  try {
    writeFileSync(input, videoBytes);
    const duration = probeMediaDurationSeconds(input, `${label}_duration`);
    const seek = Math.max(0, duration - 0.08);

    const run = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-ss', seek.toFixed(3), '-i', input, '-frames:v', '1', output],
      { encoding: 'utf8' }
    );

    if (run.status !== 0) return null;
    const bytes = readFileSync(output);
    return bytes.length ? bytes : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const concatVideoSegments = (segments: Buffer[]): Buffer => {
  if (!segments.length) {
    throw new ProviderRuntimeError('SEGMENT_CONCAT_NO_INPUT', { provider: 'ffmpeg', fatal: true });
  }

  if (segments.length === 1) return segments[0];

  const dir = mkdtempSync(join(tmpdir(), 'fsf-segment-concat-'));
  const output = join(dir, 'concatenated.mp4');

  try {
    const inputs: string[] = [];

    segments.forEach((bytes, index) => {
      const file = join(dir, `segment-${index + 1}.mp4`);
      writeFileSync(file, bytes);
      inputs.push(file);
    });

    const ffArgs: string[] = ['-y', '-loglevel', 'error'];
    for (const file of inputs) {
      ffArgs.push('-i', file);
    }

    const concatInputs = inputs.map((_, index) => `[${index}:v]`).join('');
    ffArgs.push(
      '-filter_complex',
      `${concatInputs}concat=n=${inputs.length}:v=1:a=0[v]`,
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output
    );

    const run = spawnSync('ffmpeg', ffArgs, { encoding: 'utf8' });
    if (run.status !== 0) {
      throw new ProviderRuntimeError(`FFMPEG_SEGMENT_CONCAT_FAILED:${run.stderr?.slice(0, 300) ?? 'unknown'}`, {
        provider: 'ffmpeg',
        fatal: true
      });
    }

    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  brandProfile?: BrandProfile;
  generationPayload?: GenerationPayloadV1;
  videoPlanV1?: VideoPlanV1;
  approvedScript?: string;
  approvedScriptV2?: {
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
  userControls?: Partial<UserControlProfile>;
}) => {
  await runProviderHealthchecks();

  const concept = resolveStoryboardConcept(input.conceptId);
  const effectiveTopic = String(input.generationPayload?.topic ?? input.topic).trim() || input.topic;
  const effectiveBrandProfile = input.generationPayload?.brandProfile ?? input.brandProfile;
  const intentInput = input.generationPayload?.creativeIntent ?? input.creativeIntent;

  const startFrameStyle = resolveStartFrameStyle(input.startFrameStyle ?? input.generationPayload?.startFrame?.style);
  const startFrameReferenceObjectPath = input.startFrameReferenceObjectPath ?? input.generationPayload?.startFrame?.uploadObjectPath;

  const fallbackMoodPreset = resolveMoodPreset(input.moodPreset);
  const moodPreset = deriveLegacyMoodPresetFromIntent(intentInput, fallbackMoodPreset, concept.id);
  const effectiveIntent = resolveEffectiveIntent(intentInput, moodPreset, concept.id);
  const storyboardLightInput = normalizeStoryboardLight(input.storyboardLight);

  const legacyUserControlsProvided = isLegacyControlProfileProvided(input.userControls);
  const legacyUserControls = normalizeUserControlProfile(input.userControls);
  const motionRequirement = resolveMotionRequirement(input.variantType, legacyUserControls, effectiveIntent);

  const durationConfig = resolveVariantDurations(input.variantType);
  const captionSafeArea = resolveCaptionSafeArea();
  const safeMarginPercent = Math.round(captionSafeArea.marginRatio * 100);

  let referenceAsset: StoredAsset | null = null;
  let referenceSummary = '';

  if (startFrameReferenceObjectPath) {
    const referenceBytes = await supabaseDownload(startFrameReferenceObjectPath);
    const referenceMimeType = detectImageMimeFromName(startFrameReferenceObjectPath);
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

  const startFramePromptBase =
    input.startFramePromptOverride?.trim() ||
    input.generationPayload?.startFrame?.customPrompt?.trim() ||
    startFramePrompts[startFrameStyle];
  const startFrameLabel = startFrameLabels[startFrameStyle];
  const startFramePrompt = [
    startFramePromptBase,
    input.generationPayload?.startFrame?.summary ? `Startframe summary: ${input.generationPayload.startFrame.summary}.` : '',
    referenceAsset ? `Reference image URL: ${referenceAsset.signedUrl}.` : '',
    referenceSummary ? `Reference cues: ${referenceSummary}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  const explicitHeroSubject = inferExplicitHeroSubject(effectiveTopic);
  const referenceOffContext = Boolean(referenceSummary && referenceLikelyOffContext(effectiveTopic, referenceSummary));
  const startFrameTransitionDirective = referenceAsset
    ? referenceOffContext
      ? `Uploaded reference is likely off-context vs topic. Use it only as opening visual anchor for second 0-2, then transition camera and scene to ${explicitHeroSubject}.`
      : `Use uploaded reference as shot-1 anchor and keep continuity with ${explicitHeroSubject} for following beats.`
    : `Generated startframe must explicitly show ${explicitHeroSubject} from shot 1.`;

  const scriptFromV2 = (() => {
    const v2 = input.approvedScriptV2;
    if (!v2 || !Array.isArray(v2.scenes) || !v2.scenes.length) return '';

    const parts: string[] = [];
    if (v2.openingHook?.trim()) parts.push(v2.openingHook.trim());
    if (v2.narration?.trim()) parts.push(v2.narration.trim());

    for (const scene of v2.scenes.slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))) {
      if (scene.action?.trim()) parts.push(scene.action.trim());
      for (const line of scene.lines ?? []) {
        const speaker = String(line.speaker ?? '').trim();
        const text = String(line.text ?? '').trim();
        if (speaker && text) parts.push(`${speaker}: ${text}`);
      }
      if (scene.onScreenText?.trim()) parts.push(scene.onScreenText.trim());
    }

    const joined = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return joined ? ensureSentenceEnding(joined) : '';
  })();

  const approvedScript = input.approvedScript?.trim() || scriptFromV2;

  let videoPlanV1: VideoPlanV1 | null = normalizeVideoPlanV1(input.videoPlanV1);
  let videoPlanSource: 'provided' | 'generated' | 'reconciled' | 'fallback' | null = videoPlanV1 ? 'provided' : null;
  let videoPlanReconciled = false;

  if (!videoPlanV1 && input.generationPayload) {
    try {
      videoPlanV1 = await generateVideoPlan({
        topic: effectiveTopic,
        creativeIntent: effectiveIntent,
        brandProfile: effectiveBrandProfile,
        energyMode: effectiveIntent.energyMode,
        startFrameHint: input.generationPayload.startFrame?.summary ?? input.generationPayload.startFrame?.referenceHint,
        userEditedFlowScript: input.generationPayload.userEditedFlowScript
      });
      videoPlanSource = 'generated';

      const userEdited = String(input.generationPayload.userEditedFlowScript ?? '').trim();
      if (userEdited) {
        videoPlanV1 = await reconcileVideoPlan({
          topic: effectiveTopic,
          currentPlan: videoPlanV1,
          userEditedFlowScript: userEdited,
          creativeIntent: effectiveIntent,
          brandProfile: effectiveBrandProfile,
          energyMode: effectiveIntent.energyMode
        });
        videoPlanSource = 'reconciled';
        videoPlanReconciled = true;
      }
    } catch {
      videoPlanV1 = fallbackVideoPlanV1(effectiveTopic, input.generationPayload.userEditedFlowScript);
      videoPlanSource = 'fallback';
      videoPlanReconciled = Boolean(input.generationPayload.userEditedFlowScript?.trim());
    }
  }

  const storyboardLight =
    storyboardLightInput ??
    (videoPlanV1
      ? {
          beats: videoPlanV1.flowBeats.map((beat) => ({
            beatId: `plan_${beat.order}`,
            order: beat.order,
            action: beat.beat,
            visualHint: beat.visualHint,
            onScreenTextHint: beat.onScreenTextHint
          })),
          hookHint: videoPlanV1.hookOpening,
          ctaHint: videoPlanV1.flowBeats[videoPlanV1.flowBeats.length - 1]?.beat,
          pacingHint: 'dynamic'
        }
      : undefined);

  const scriptFromPlan = (() => {
    if (!videoPlanV1) return '';
    const sceneParts = videoPlanV1.script.scenes
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((scene) => scene.action)
      .filter(Boolean)
      .join(' ');

    const merged = [videoPlanV1.hookOpening, videoPlanV1.script.narration, sceneParts]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return merged ? ensureSentenceEnding(merged) : '';
  })();

  let draft = approvedScript
    ? (() => {
        const script = ensureSentenceEnding(approvedScript);
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
    : scriptFromPlan
      ? (() => {
          const script = ensureSentenceEnding(scriptFromPlan);
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
          topic: effectiveTopic,
          variantType: input.variantType,
          moodPreset,
          creativeIntent: effectiveIntent,
          brandProfile: effectiveBrandProfile
        });

  const maxDurationRepairAttempts = Math.max(1, Math.min(2, Number(process.env.SCRIPT_AUTO_REPAIR_ATTEMPTS ?? 2)));
  let durationRepairAttempts = 0;

  while (!draft.withinTarget && durationRepairAttempts < maxDurationRepairAttempts) {
    const previousScript = draft.script;
    const condensedScript = await condenseScriptToTarget(
      previousScript,
      durationConfig.targetSeconds,
      Math.round(durationConfig.targetSeconds * 2.35),
      moodPreset,
      effectiveIntent,
      effectiveBrandProfile
    );

    durationRepairAttempts += 1;
    const normalized = finalizeScriptLanguage(condensedScript, effectiveBrandProfile);
    const estimatedSeconds = estimateSpeechSeconds(normalized);

    draft = {
      ...draft,
      script: normalized,
      estimatedSeconds,
      withinTarget: estimatedSeconds <= durationConfig.targetSeconds * 1.08,
      condensed: true
    };

    if (normalized.trim() === previousScript.trim()) break;
  }

  draft = {
    ...draft,
    script: finalizeScriptLanguage(draft.script, effectiveBrandProfile)
  };

  if (!draft.withinTarget) {
    throw new ProviderRuntimeError(`SCRIPT_DURATION_EXCEEDS_TARGET:${draft.estimatedSeconds}s>${draft.targetSeconds}s`, {
      provider: 'openai',
      fatal: true
    });
  }

  const llmText = draft.script;
  const storyboardPrompt = renderStoryboardLightPrompt(storyboardLight);
  const brandPrompt = renderBrandProfilePrompt(effectiveBrandProfile);
  const initialHookOpening =
    videoPlanV1?.hookOpening?.trim() ||
    storyboardLight?.hookHint?.trim() ||
    llmText.split(/[.!?…]/)[0]?.trim() ||
    `Stop scrolling: ${effectiveTopic} in 30 Sekunden klar gemacht.`;

  const hookAutoRepairAttempts = Math.max(1, Math.min(2, Number(process.env.HOOK_AUTO_REPAIR_ATTEMPTS ?? 2)));
  let repairedHookOpening = initialHookOpening;

  for (let hookAttempt = 0; hookAttempt < hookAutoRepairAttempts; hookAttempt += 1) {
    const strongEnough = repairedHookOpening.trim().length >= 14 || effectiveIntent.energyMode === 'calm';
    if (strongEnough) break;
    repairedHookOpening = `Stop scrolling: ${effectiveTopic} – in Sekunden siehst du die konkrete Lösung.`;
  }

  const hookOpening = ensureSentenceEnding(repairedHookOpening);

  const flowBeatsPrompt = buildFlowBeatsPrompt({
    storyboardLight,
    fallbackScript: llmText
  });

  const hasExplicitStartFrameReference = Boolean(
    referenceAsset ||
      input.startFramePromptOverride?.trim() ||
      input.generationPayload?.startFrame?.customPrompt?.trim() ||
      input.generationPayload?.startFrame?.summary?.trim()
  );
  const startFrameDirective = hasExplicitStartFrameReference ? startFramePrompt : '';

  const subjectConstraints = [
    ...(videoPlanV1?.subjectConstraints ?? []),
    'Keep the same main subject identity from opening through final shot.'
  ].filter(Boolean);

  const exactBrandName = String(effectiveBrandProfile?.companyName ?? '').trim();
  const brandTextConstraint = exactBrandName
    ? `If any visible brand text/logo appears, it must be exactly "${exactBrandName}". Never invent other brand/shop names.`
    : '';

  const outputConstraints = [
    `9:16 vertical output, cinematic but readable for mobile.`,
    `Keep on-screen text inside title-safe area (${safeMarginPercent}% margin).`,
    'No caption text should touch the frame border.',
    'TikTok pace: immediate hook, visibly changing shots, no slow static drift.',
    'No looping/recycling of the same crop or 4-shot pattern; progression must stay forward.',
    'Never use abstract labels like "central motif"; always name the exact subject/object shown in the shot.',
    brandTextConstraint
  ].filter(Boolean);

  const lightingAnchors = [
    `Mood anchor: ${moodPromptMap[moodPreset]}`,
    `Explicit hero subject to show: ${explicitHeroSubject}.`,
    startFrameTransitionDirective,
    brandPrompt,
    startFrameDirective,
    storyboardPrompt
  ]
    .filter(Boolean)
    .join(' ');

  const imageCompiled = compilePromptV3({
    sceneIntent: `Create a filmic opening keyframe for topic "${effectiveTopic}". Explicit hero subject: ${explicitHeroSubject}`,
    hookOpening,
    flowBeats: flowBeatsPrompt,
    lightingAnchors,
    subjectConstraints,
    outputConstraints,
    intent: effectiveIntent,
    includeLegacyControls: legacyUserControlsProvided,
    legacyControls: legacyUserControls
  });

  const videoCompiled = compilePromptV3({
    sceneIntent: `Create a cinematic social short about "${effectiveTopic}" with clear narrative momentum. Explicit hero subject: ${explicitHeroSubject}`,
    hookOpening,
    flowBeats: flowBeatsPrompt,
    lightingAnchors: [
      lightingAnchors,
      motionGuardByVariant[input.variantType],
      `Motion target: >=${motionRequirement.minPhases} movement phases, static shots <=${motionRequirement.maxStaticSeconds}s`,
      videoPlanV1?.promptDirectives?.length ? `Directives: ${videoPlanV1.promptDirectives.join(' | ')}` : '',
      `Narration: ${llmText}`,
      'Shot progression rule: each beat must introduce a new visual action or camera move.'
    ]
      .filter(Boolean)
      .join(' '),
    subjectConstraints,
    outputConstraints,
    intent: effectiveIntent,
    includeLegacyControls: legacyUserControlsProvided,
    legacyControls: legacyUserControls
  });

  const imageResult = await createImage(imageCompiled.prompt);

  const segmentPlanSeconds = buildSegmentPlanSeconds(durationConfig.targetSeconds);
  const promptBlueprint = await (async (): Promise<SoraPromptBlueprint> => {
    try {
      return await generateSoraPromptBlueprint({
        topic: effectiveTopic,
        targetSeconds: durationConfig.targetSeconds,
        segmentPlanSeconds,
        hookOpening,
        narration: llmText,
        flowBeatsPrompt,
        technicalBasePrompt: videoCompiled.prompt,
        explicitHeroSubject,
        startFrameDirective,
        startFrameTransitionDirective,
        intentPrompt: renderIntentPrompt(effectiveIntent).text,
        brandPrompt,
        brandName: exactBrandName || undefined,
        moodPrompt: moodPromptMap[moodPreset],
        userEditedFlowScript: input.generationPayload?.userEditedFlowScript
      });
    } catch (error) {
      logEvent({
        event: 'sora_prompt_blueprint_fallback',
        level: 'WARN',
        jobId: input.jobId,
        detail: `reason=${String((error as Error)?.message ?? error).slice(0, 220)}`
      });

      return buildFallbackSoraPromptBlueprint({
        technicalSoraPrompt: videoCompiled.prompt,
        hook: hookOpening,
        flowBeatsPrompt,
        continuityAnchors: [explicitHeroSubject, startFrameTransitionDirective, brandPrompt].filter(Boolean),
        segmentPlanSeconds,
        topic: effectiveTopic,
        explicitHeroSubject,
        brandName: exactBrandName || undefined
      });
    }
  })();

  const segmentReports: MotionSegmentReport[] = [];
  const segmentVideoBytes: Buffer[] = [];
  let continuityCue = referenceSummary
    ? `Start continuity cue from uploaded startframe: ${referenceSummary}`
    : `Start continuity cue: ${explicitHeroSubject}`;
  let timelineCursor = 0;

  for (let index = 0; index < segmentPlanSeconds.length; index += 1) {
    const segmentSeconds = segmentPlanSeconds[index];
    const segmentStart = timelineCursor;
    timelineCursor += segmentSeconds;
    const segmentEnd = timelineCursor;

    const blueprintSegment = promptBlueprint.segments[index];

    const segmentPrompt = [
      `Global technical prompt: ${promptBlueprint.technicalSoraPrompt}`,
      `Segment ${index + 1}/${segmentPlanSeconds.length} for one continuous video. Duration ${segmentSeconds}s. Window ${segmentStart}-${segmentEnd}s.`,
      index === 0
        ? `Shot 1 must start from selected startframe anchor. ${startFrameTransitionDirective}`
        : `Start exactly where segment ${index} ended. Continuity cue: ${continuityCue}.`,
      blueprintSegment?.startState ? `Required start state: ${blueprintSegment.startState}` : '',
      blueprintSegment?.endState ? `Required end state: ${blueprintSegment.endState}` : '',
      blueprintSegment?.prompt ? `Segment directive: ${blueprintSegment.prompt}` : '',
      promptBlueprint.continuityAnchors.length ? `Continuity anchors: ${promptBlueprint.continuityAnchors.join(' | ')}` : '',
      'This is one continuous narrative across segments, not separate clips.',
      'Advance to a new visual action and camera development; never reset to the opening composition.',
      'Never create internal loops or repeating micro-cycles.'
    ]
      .filter(Boolean)
      .join('\n');

    const segmentMotionRequirement = scaleMotionRequirementForSegment(motionRequirement, segmentSeconds);

    const segmentResult = await createVideoWithMotionEnforcement({
      prompt: segmentPrompt,
      variantType: input.variantType,
      requirement: segmentMotionRequirement,
      calmMode: effectiveIntent.energyMode === 'calm',
      secondsOverride: segmentSeconds,
      segmentLabel: `segment_${index + 1}`
    });

    segmentVideoBytes.push(segmentResult.video.bytes);

    const segmentAsset = await uploadAsset(
      input.jobId,
      `jobs/${input.jobId}/assets/segments/segment-${index + 1}.mp4`,
      segmentResult.video.bytes,
      'video/mp4',
      'openai-video'
    );

    let lastFrameAssetPath: string | undefined;
    const lastFrameBytes = extractLastFramePng(segmentResult.video.bytes, `segment-${index + 1}`);
    if (lastFrameBytes) {
      const lastFrameAsset = await uploadAsset(
        input.jobId,
        `jobs/${input.jobId}/assets/segments/segment-${index + 1}-lastframe.png`,
        lastFrameBytes,
        'image/png',
        'ffmpeg'
      );
      lastFrameAssetPath = lastFrameAsset.objectPath;
      continuityCue = [
        `Use framing/subject continuity from ${lastFrameAsset.signedUrl} and continue motion forward.`,
        blueprintSegment?.endState ? `Previous segment end-state: ${blueprintSegment.endState}` : ''
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      continuityCue = blueprintSegment?.endState
        ? `Continue from previous segment end-state: ${blueprintSegment.endState}`
        : continuityCue;
    }

    segmentReports.push({
      segmentIndex: index + 1,
      seconds: segmentSeconds,
      attemptCount: segmentResult.enforcement.attempts,
      videoId: segmentResult.video.videoId,
      model: segmentResult.video.model,
      motion: {
        durationSeconds: segmentResult.enforcement.durationSeconds,
        sceneThreshold: segmentResult.enforcement.sceneThreshold,
        motionCuts: segmentResult.enforcement.motionCuts,
        motionPhases: segmentResult.enforcement.motionPhases,
        longestStaticSeconds: segmentResult.enforcement.longestStaticSeconds
      },
      withinThreshold: segmentResult.enforcement.withinThreshold,
      lastFrameAssetPath
    });

    logEvent({
      event: 'video_segment_generated',
      level: 'INFO',
      jobId: input.jobId,
      detail: JSON.stringify({
        segmentIndex: index + 1,
        seconds: segmentSeconds,
        segmentObjectPath: segmentAsset.objectPath,
        withinThreshold: segmentResult.enforcement.withinThreshold,
        attempts: segmentResult.enforcement.attempts
      })
    });
  }

  const concatenatedVideoBytes = concatVideoSegments(segmentVideoBytes);
  const finalSegmentMotion = probeMotion(concatenatedVideoBytes, 'segment_concatenated');

  const imageAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/keyframe.png`, imageResult.bytes, 'image/png', 'openai-image');
  const videoAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/segment.mp4`, concatenatedVideoBytes, 'video/mp4', 'openai-video');

  const totalAttempts = segmentReports.reduce((sum, item) => sum + item.attemptCount, 0);
  const withinThreshold = segmentReports.every((item) => item.withinThreshold);
  const requiredTotalPhases = segmentPlanSeconds.reduce(
    (sum, seconds) => sum + scaleMotionRequirementForSegment(motionRequirement, seconds).minPhases,
    0
  );

  return {
    script: llmText,
    image: imageAsset,
    imageDiagnostics: imageResult.diagnostics,
    video: videoAsset,
    referenceAsset,
    videoModel: 'sora-2',
    videoId: segmentReports.map((item) => item.videoId).join(','),
    conceptId: concept.id,
    startFrameStyle,
    startFrameCandidateId: input.startFrameCandidateId ?? input.generationPayload?.startFrame?.candidateId,
    startFrameLabel,
    moodPreset,
    creativeIntent: effectiveIntent,
    storyboardLight,
    brandProfile: effectiveBrandProfile,
    videoPlanV1,
    videoPlanSource,
    videoPlanReconciled,

    userControls: legacyUserControlsProvided ? legacyUserControls : undefined,
    promptCompiler: videoCompiled.meta,
    promptBlueprint,
    motionEnforcement: {
      ...finalSegmentMotion,
      minPhasesRequired: requiredTotalPhases,
      maxStaticSecondsAllowed: motionRequirement.maxStaticSeconds,
      withinThreshold,
      attempts: totalAttempts,
      segmentPlanSeconds,
      segmentReports
    },
    scriptValidation: {
      targetSeconds: draft.targetSeconds,
      estimatedSeconds: draft.estimatedSeconds,
      suggestedWords: draft.suggestedWords,
      withinTarget: draft.withinTarget,
      condensed: draft.condensed
    }
  };
};

const extractSceneAudioTrack = (videoBytes: Buffer): Buffer | null => {
  const dir = mkdtempSync(join(tmpdir(), 'fsf-scene-audio-'));
  const inputVideo = join(dir, 'input.mp4');
  const outputAudio = join(dir, 'scene.mp3');

  try {
    writeFileSync(inputVideo, videoBytes);

    const run = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', inputVideo, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'mp3', outputAudio],
      { encoding: 'utf8' }
    );

    if (run.status !== 0) {
      return null;
    }

    const bytes = readFileSync(outputAudio);
    if (!bytes.length) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const mixVoiceAndSceneAudio = (voiceBytes: Buffer, sceneBytes: Buffer): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), 'fsf-hybrid-audio-'));
  const inputVoice = join(dir, 'voice.mp3');
  const inputScene = join(dir, 'scene.mp3');
  const output = join(dir, 'hybrid.mp3');

  try {
    writeFileSync(inputVoice, voiceBytes);
    writeFileSync(inputScene, sceneBytes);

    const run = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        inputVoice,
        '-i',
        inputScene,
        '-filter_complex',
        '[1:a]volume=0.35[scene];[0:a][scene]amix=inputs=2:weights=1 0.8:normalize=0,alimiter=limit=0.95[a]',
        '-map',
        '[a]',
        '-c:a',
        'mp3',
        '-b:a',
        '160k',
        output
      ],
      { encoding: 'utf8' }
    );

    if (run.status !== 0) {
      throw new ProviderRuntimeError(`FFMPEG_HYBRID_AUDIO_MIX_FAILED:${run.stderr?.slice(0, 300) ?? 'unknown'}`, {
        provider: 'ffmpeg',
        fatal: false
      });
    }

    const bytes = readFileSync(output);
    if (!bytes.length) {
      throw new ProviderRuntimeError('FFMPEG_HYBRID_AUDIO_EMPTY', {
        provider: 'ffmpeg',
        fatal: false
      });
    }

    return bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const runAudioStage = async (input: {
  jobId: string;
  script: string;
  audioMode?: 'voiceover' | 'scene' | 'hybrid';
  videoObjectPath?: string;
}) => {
  await runProviderHealthchecks();

  const selectedMode = input.audioMode ?? 'voiceover';
  let effectiveMode: 'voiceover' | 'scene' | 'hybrid' = selectedMode;
  let fallbackApplied = false;
  let fallbackReason: string | null = null;
  let sceneAudioDetected = false;
  let ttsProvider: string | null = null;

  const fallbackToVoiceover = async (reason: string) => {
    fallbackApplied = true;
    fallbackReason = reason;
    effectiveMode = 'voiceover';
    const tts = await createTts(input.script);
    ttsProvider = tts.provider;
    const audioAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/voice.mp3`, tts.bytes, 'audio/mpeg', tts.provider);
    return audioAsset;
  };

  if (selectedMode === 'voiceover') {
    const tts = await createTts(input.script);
    ttsProvider = tts.provider;
    const audioAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/voice.mp3`, tts.bytes, 'audio/mpeg', tts.provider);
    return {
      audio: audioAsset,
      ttsProvider: tts.provider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  }

  if (!input.videoObjectPath) {
    const fallbackAsset = await fallbackToVoiceover('VIDEO_ASSET_MISSING');
    return {
      audio: fallbackAsset,
      ttsProvider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  }

  const videoBytes = await supabaseDownload(input.videoObjectPath);
  const sceneBytes = extractSceneAudioTrack(videoBytes);
  sceneAudioDetected = Boolean(sceneBytes && sceneBytes.length > 0);

  if (selectedMode === 'scene') {
    if (!sceneBytes) {
      const fallbackAsset = await fallbackToVoiceover('SCENE_AUDIO_NOT_AVAILABLE');
      return {
        audio: fallbackAsset,
        ttsProvider,
        audioStrategy: {
          selectedMode,
          effectiveMode,
          fallbackApplied,
          fallbackReason,
          sceneAudioDetected,
          ttsProvider,
          modeCompatibility: {
            voiceover: 'stable',
            scene: 'experimental',
            hybrid: 'experimental'
          }
        }
      };
    }

    const audioAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/scene.mp3`, sceneBytes, 'audio/mpeg', 'scene-audio');
    return {
      audio: audioAsset,
      ttsProvider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  }

  const tts = await createTts(input.script);
  ttsProvider = tts.provider;

  if (!sceneBytes) {
    const voiceAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/voice.mp3`, tts.bytes, 'audio/mpeg', tts.provider);
    fallbackApplied = true;
    fallbackReason = 'HYBRID_SCENE_AUDIO_UNAVAILABLE';
    effectiveMode = 'voiceover';

    return {
      audio: voiceAsset,
      ttsProvider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  }

  try {
    const hybridBytes = mixVoiceAndSceneAudio(tts.bytes, sceneBytes);
    const hybridAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/hybrid.mp3`, hybridBytes, 'audio/mpeg', 'hybrid-mix');

    return {
      audio: hybridAsset,
      ttsProvider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  } catch {
    const fallbackAsset = await fallbackToVoiceover('HYBRID_MIX_FAILED');
    return {
      audio: fallbackAsset,
      ttsProvider,
      audioStrategy: {
        selectedMode,
        effectiveMode,
        fallbackApplied,
        fallbackReason,
        sceneAudioDetected,
        ttsProvider,
        modeCompatibility: {
          voiceover: 'stable',
          scene: 'experimental',
          hybrid: 'experimental'
        }
      }
    };
  }
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
