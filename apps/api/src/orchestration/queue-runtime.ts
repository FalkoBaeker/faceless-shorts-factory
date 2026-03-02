import { randomUUID } from 'node:crypto';
import { Queue, Worker, QueueEvents, UnrecoverableError, type JobsOptions, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { queueNames, defaultRetryPolicy } from '../../../../workers/pipeline/src/index.ts';
import { isTransitionAllowed, type VideoJobStatus } from '../../../../workers/pipeline/src/state-machine.ts';
import { getJob, appendTimelineEvent } from '../job-store.ts';
import { getProject } from '../project-store.ts';
import { publishNow, type PublishTarget, getPublishPosts } from '../services/publish-service.ts';
import { queryPg, txPg, closePgPool } from '../persistence/pg-pool.ts';
import { getPersistenceBackend } from '../persistence/backend.ts';
import { transitionJob } from '../services/job-service.ts';
import { commitCredit, releaseCredit } from '../services/billing-service.ts';
import {
  runVideoStage,
  runAudioStage,
  runAssemblyStage,
  isFatalProviderError,
  type StoredAsset
} from '../providers/live-provider-runtime.ts';
import { logEvent } from '../utils/app-logger.ts';

type Stage = 'video' | 'audio' | 'assembly' | 'publish';

type StagePayload = {
  jobId: string;
  forceFail?: boolean;
  failMode?: 'retryable' | 'hard';
  targets?: PublishTarget[];
  replayCount?: number;
};

type WeightedSelection<T extends string> = {
  id: T;
  weight?: number;
  priority?: 1 | 2 | 3;
};

type CreativeIntent = {
  effectGoals: Array<WeightedSelection<'sell_conversion' | 'funny' | 'cringe_hook' | 'testimonial_trust' | 'urgency_offer'>>;
  narrativeFormats: Array<WeightedSelection<'before_after' | 'dialog' | 'offer_focus' | 'commercial' | 'problem_solution'>>;
  shotStyles?: Array<WeightedSelection<'cinematic_closeup' | 'over_shoulder' | 'handheld_push' | 'product_macro' | 'wide_establishing' | 'fast_cut_montage'>>;
  energyMode?: 'auto' | 'high' | 'calm';
};

type StoryboardLight = {
  beats: Array<{
    beatId: string;
    order: number;
    action: string;
    visualHint?: string;
    dialogueHint?: string;
    onScreenTextHint?: string;
  }>;
  hookHint?: string;
  ctaHint?: string;
  pacingHint?: string;
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
      tone?: string;
      startHintSeconds?: number;
      endHintSeconds?: number;
    }>;
    onScreenText?: string;
  }>;
};

type GenerationPayloadV1 = {
  topic: string;
  brandProfile: {
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
  creativeIntent: CreativeIntent;
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
      lines?: Array<{ speaker: string; text: string }>;
      onScreenText?: string;
    }>;
  };
  subjectConstraints: string[];
  promptDirectives: string[];
};

type StoryboardSelection = {
  conceptId: string;
  moodPreset: 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';
  creativeIntent?: CreativeIntent;
  storyboardLight?: StoryboardLight;
  brandProfile?: {
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
  generationPayload?: GenerationPayloadV1;
  videoPlanV1?: VideoPlanV1;
  approvedScript?: string;
  approvedScriptV2?: ScriptV2;
  audioMode?: 'voiceover' | 'scene' | 'hybrid';
  startFrameCandidateId?: string;
  startFrameLabel?: string;
  startFramePrompt?: string;
  startFrameMode?: 'uploaded_asset' | 'uploaded_reference' | 'generated_candidate';
  effectiveStartFrameSource?: 'uploaded_asset' | 'generated_candidate';
  precedenceRuleApplied?: 'UPLOAD_WINS_OVER_CANDIDATE';
  startFramePolicy?: {
    decision?: 'allow' | 'fallback' | 'block';
    reasonCode?: string;
    matchedSignals?: string[];
  };
  startFrameReferenceObjectPath?: string;
  userControls?: {
    ctaStrength: 'soft' | 'balanced' | 'strong';
    motionIntensity: 'low' | 'medium' | 'high';
    shotPace: 'relaxed' | 'balanced' | 'fast';
    visualStyle: 'clean' | 'cinematic' | 'ugc';
  };
  startFrameStyle: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
};

type JobContext = {
  id: string;
  status: VideoJobStatus;
  project_id: string;
  organization_id: string;
};

type LedgerRow = { type: 'RESERVED' | 'COMMITTED' | 'RELEASED' };

const isPostgres = () => getPersistenceBackend() === 'postgres';

const DLQ_NAME = 'video.dead-letter';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const queueOpts: JobsOptions = {
  attempts: defaultRetryPolicy.attempts,
  backoff: {
    type: defaultRetryPolicy.backoff.type,
    delay: defaultRetryPolicy.backoff.delayMs
  },
  removeOnComplete: 100,
  removeOnFail: false
};

let initialized = false;
let shuttingDown = false;
let shutdownHooksRegistered = false;

const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
const redisReady = new Promise<void>((resolve, reject) => {
  const onReady = () => {
    redis.off('error', onError);
    resolve();
  };
  const onError = (error: Error) => {
    redis.off('ready', onReady);
    reject(error);
  };
  redis.once('ready', onReady);
  redis.once('error', onError);
});
const workerConnections: IORedis[] = [];

const videoQueue = new Queue<StagePayload>(queueNames.video, { connection: redis.duplicate({ maxRetriesPerRequest: null }) });
const audioQueue = new Queue<StagePayload>(queueNames.audio, { connection: redis.duplicate({ maxRetriesPerRequest: null }) });
const assemblyQueue = new Queue<StagePayload>(queueNames.assembly, { connection: redis.duplicate({ maxRetriesPerRequest: null }) });
const publishQueue = new Queue<StagePayload>(queueNames.publish, { connection: redis.duplicate({ maxRetriesPerRequest: null }) });
const deadLetterQueue = new Queue<
  StagePayload & { stage: Stage; reason: string; failedAt: string; attemptsMade: number }
>(DLQ_NAME, { connection: redis.duplicate({ maxRetriesPerRequest: null }) });

const queueEvents = [
  new QueueEvents(queueNames.video, { connection: redis.duplicate({ maxRetriesPerRequest: null }) }),
  new QueueEvents(queueNames.audio, { connection: redis.duplicate({ maxRetriesPerRequest: null }) }),
  new QueueEvents(queueNames.assembly, { connection: redis.duplicate({ maxRetriesPerRequest: null }) }),
  new QueueEvents(queueNames.publish, { connection: redis.duplicate({ maxRetriesPerRequest: null }) })
];

type StageQueueBinding = {
  stage: Stage;
  queue: Queue<StagePayload>;
};

const stageQueues: StageQueueBinding[] = [
  { stage: 'video', queue: videoQueue },
  { stage: 'audio', queue: audioQueue },
  { stage: 'assembly', queue: assemblyQueue },
  { stage: 'publish', queue: publishQueue }
];

const stageTimeoutDefaults: Record<Stage, number> = {
  video: 1_800_000,
  audio: 300_000,
  assembly: 300_000,
  publish: 120_000
};

const stageTimeoutMs = (stage: Stage) => {
  const envKey = `${stage.toUpperCase()}_STAGE_TIMEOUT_MS`;
  const raw = Number(process.env[envKey] ?? stageTimeoutDefaults[stage]);
  if (!Number.isFinite(raw)) return stageTimeoutDefaults[stage];
  return Math.max(30_000, Math.floor(raw));
};

const withStageTimeout = async <T>(stage: Stage, jobId: string, fn: () => Promise<T>): Promise<T> => {
  const timeoutMs = stageTimeoutMs(stage);
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new UnrecoverableError(`HARD_FAILURE:${stage}:STAGE_TIMEOUT:${timeoutMs}ms:${jobId}`));
        }, timeoutMs);
        timer.unref();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createWorker = <T extends StagePayload>(
  queueName: string,
  processor: (job: Job<T>) => Promise<unknown>
): Worker<T> => {
  const connection = redis.duplicate({ maxRetriesPerRequest: null });
  workerConnections.push(connection);
  const concurrency = Math.max(1, Number(process.env.MAX_PARALLEL_JOBS ?? 1));
  return new Worker<T>(queueName, processor, {
    connection,
    concurrency
  });
};

const workers: Worker<any>[] = [];

const registerShutdownHooks = () => {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const cleanup = async () => {
    await closeQueueRuntime();
    await closePgPool();
  };

  process.once('SIGINT', () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.once('beforeExit', () => {
    void cleanup();
  });
};

const idempotencyKey = (jobId: string, stage: Stage) => `idem:${jobId}:${stage}`;

const reserveIdempotency = async (jobId: string, stage: Stage) => {
  const key = idempotencyKey(jobId, stage);
  const result = await redis.set(key, '1', 'NX', 'EX', 86_400);
  return result === 'OK';
};

const clearStageIdempotency = async (jobId: string, stage: Stage) => {
  await redis.del(idempotencyKey(jobId, stage));
};

const clearIdempotency = async (jobId: string) => {
  const keys = [idempotencyKey(jobId, 'video'), idempotencyKey(jobId, 'audio'), idempotencyKey(jobId, 'assembly'), idempotencyKey(jobId, 'publish')];
  if (keys.length) await redis.del(keys);
};

const assetRefKey = (jobId: string) => `assets:${jobId}`;

const setAssetRef = async (jobId: string, field: string, value: string) => {
  await redis.hset(assetRefKey(jobId), field, value);
};

const getAssetRef = async (jobId: string, field: string) => {
  return redis.hget(assetRefKey(jobId), field);
};

const buildAssetDetail = (kind: string, asset: StoredAsset) =>
  JSON.stringify({
    kind,
    objectPath: asset.objectPath,
    signedUrl: asset.signedUrl,
    bytes: asset.bytes,
    mimeType: asset.mimeType,
    provider: asset.provider
  });

const parseWeightedSelections = <T extends string>(raw: unknown, allowed: readonly T[]) => {
  if (!Array.isArray(raw)) return [] as Array<WeightedSelection<T>>;

  return raw
    .slice(0, 12)
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const id = String(entry.id ?? '').trim() as T;
      if (!(allowed as readonly string[]).includes(id)) return null;

      const rawWeight = Number(entry.weight ?? 1);
      const weight = Number.isFinite(rawWeight) ? Math.max(0.1, Math.min(1, rawWeight)) : 1;
      const rawPriority = Number(entry.priority);
      const priority = [1, 2, 3].includes(rawPriority) ? (rawPriority as 1 | 2 | 3) : undefined;

      return { id, weight, priority };
    })
    .filter((entry): entry is WeightedSelection<T> => Boolean(entry));
};

const parseCreativeIntent = (raw: unknown): CreativeIntent | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;

  const effectGoals = parseWeightedSelections(input.effectGoals, [
    'sell_conversion',
    'funny',
    'cringe_hook',
    'testimonial_trust',
    'urgency_offer'
  ] as const);

  const narrativeFormats = parseWeightedSelections(input.narrativeFormats, [
    'before_after',
    'dialog',
    'offer_focus',
    'commercial',
    'problem_solution'
  ] as const);

  const shotStyles = parseWeightedSelections(input.shotStyles, [
    'cinematic_closeup',
    'over_shoulder',
    'handheld_push',
    'product_macro',
    'wide_establishing',
    'fast_cut_montage'
  ] as const);

  const energyRaw = String(input.energyMode ?? 'auto').trim().toLowerCase();
  const energyMode = ['auto', 'high', 'calm'].includes(energyRaw) ? (energyRaw as 'auto' | 'high' | 'calm') : 'auto';

  if (!effectGoals.length && !narrativeFormats.length && !shotStyles.length && energyMode === 'auto') {
    return undefined;
  }

  return {
    effectGoals,
    narrativeFormats,
    shotStyles,
    energyMode
  };
};

const parseStoryboardLight = (raw: unknown): StoryboardLight | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const beatsRaw = Array.isArray(input.beats) ? input.beats : [];

  const beats = beatsRaw
    .slice(0, 8)
    .map((entry, index) => (entry && typeof entry === 'object' ? ({ ...(entry as Record<string, unknown>), index } as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const action = String(entry.action ?? '')
        .trim()
        .slice(0, 240);
      if (!action) return null;

      const orderRaw = Number(entry.order);
      const order = Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : Number(entry.index) + 1;

      return {
        beatId:
          String(entry.beatId ?? '')
            .trim()
            .slice(0, 40) || `beat_${order}`,
        order,
        action,
        visualHint: String(entry.visualHint ?? '')
          .trim()
          .slice(0, 180) || undefined,
        dialogueHint: String(entry.dialogueHint ?? '')
          .trim()
          .slice(0, 180) || undefined,
        onScreenTextHint: String(entry.onScreenTextHint ?? '')
          .trim()
          .slice(0, 120) || undefined
      };
    })
    .filter(
      (entry): entry is {
        beatId: string;
        order: number;
        action: string;
        visualHint?: string;
        dialogueHint?: string;
        onScreenTextHint?: string;
      } => Boolean(entry)
    )
    .sort((a, b) => a.order - b.order);

  if (!beats.length) return undefined;

  return {
    beats,
    hookHint: String(input.hookHint ?? '')
      .trim()
      .slice(0, 180) || undefined,
    ctaHint: String(input.ctaHint ?? '')
      .trim()
      .slice(0, 180) || undefined,
    pacingHint: String(input.pacingHint ?? '')
      .trim()
      .slice(0, 120) || undefined
  };
};

const parseScriptV2 = (raw: unknown): ScriptV2 | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const scenesRaw = Array.isArray(input.scenes) ? input.scenes : [];

  const scenes = scenesRaw
    .slice(0, 8)
    .map((scene, index) => (scene && typeof scene === 'object' ? ({ ...(scene as Record<string, unknown>), index } as Record<string, unknown>) : null))
    .filter((scene): scene is Record<string, unknown> => Boolean(scene))
    .map((scene) => {
      const action = String(scene.action ?? '').trim().slice(0, 240);
      if (!action) return null;

      const orderRaw = Number(scene.order);
      const order = Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : Number(scene.index) + 1;

      const linesRaw = Array.isArray(scene.lines) ? scene.lines : [];
      const lines = linesRaw
        .slice(0, 12)
        .map((line) => (line && typeof line === 'object' ? (line as Record<string, unknown>) : null))
        .filter((line): line is Record<string, unknown> => Boolean(line))
        .map((line) => {
          const speaker = String(line.speaker ?? '').trim().slice(0, 40);
          const text = String(line.text ?? '').trim().slice(0, 180);
          if (!speaker || !text) return null;

          const startHintSecondsRaw = Number(line.startHintSeconds);
          const endHintSecondsRaw = Number(line.endHintSeconds);

          return {
            speaker,
            text,
            tone: String(line.tone ?? '').trim().slice(0, 40) || undefined,
            startHintSeconds: Number.isFinite(startHintSecondsRaw) ? Math.max(0, startHintSecondsRaw) : undefined,
            endHintSeconds: Number.isFinite(endHintSecondsRaw) ? Math.max(0, endHintSecondsRaw) : undefined
          };
        })
        .filter((line): line is { speaker: string; text: string; tone?: string; startHintSeconds?: number; endHintSeconds?: number } => Boolean(line));

      return {
        order,
        action,
        lines: lines.length ? lines : undefined,
        onScreenText: String(scene.onScreenText ?? '').trim().slice(0, 120) || undefined
      };
    })
    .filter((scene): scene is ScriptV2['scenes'][number] => Boolean(scene))
    .sort((a, b) => a.order - b.order);

  if (!scenes.length) return undefined;

  return {
    language: String(input.language ?? '').trim().slice(0, 20) || undefined,
    openingHook: String(input.openingHook ?? '').trim().slice(0, 180) || undefined,
    narration: String(input.narration ?? '').trim().slice(0, 2000) || undefined,
    scenes
  };
};

const splitLegacyCaptionSegments = (script: string | undefined) => {
  if (!script) return [] as string[];

  return script
    .split(/[.!?…]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.slice(0, 120))
    .slice(0, 24);
};

const prepareCaptionV2Payload = (storyboard: StoryboardSelection) => {
  const dialogLines = (storyboard.approvedScriptV2?.scenes ?? [])
    .flatMap((scene) => scene.lines ?? [])
    .map((line) => ({
      speaker: String(line.speaker ?? '').trim().slice(0, 40),
      text: String(line.text ?? '').trim().slice(0, 180)
    }))
    .filter((line) => line.speaker.length > 0 && line.text.length > 0)
    .slice(0, 24);

  const dialogSegments = dialogLines.map((line) => `${line.speaker}: ${line.text}`.slice(0, 180));
  const narrationSegments = splitLegacyCaptionSegments(storyboard.approvedScript);

  const fallbackToNarration = dialogSegments.length < 2;
  const mode = fallbackToNarration ? 'narration' : 'dialog';
  const segments = fallbackToNarration ? narrationSegments : dialogSegments;
  const source = storyboard.approvedScriptV2 ? 'script_v2' : 'legacy_script';

  return {
    mode,
    source,
    segments,
    dialogLineCount: dialogSegments.length,
    speakerCount: new Set(dialogLines.map((line) => line.speaker)).size,
    fallbackApplied: fallbackToNarration,
    fallbackReason: fallbackToNarration ? (storyboard.approvedScriptV2 ? 'INSUFFICIENT_DIALOG_LINES' : 'SCRIPT_V2_MISSING') : null
  };
};

const parseGenerationPayloadV1 = (raw: unknown): GenerationPayloadV1 | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const input = raw as Record<string, unknown>;
  const topic = String(input.topic ?? '').trim().slice(0, 240);

  const rawBrand = input.brandProfile && typeof input.brandProfile === 'object'
    ? (input.brandProfile as Record<string, unknown>)
    : null;
  const brandProfile = rawBrand
    ? {
        companyName: String(rawBrand.companyName ?? '').trim().slice(0, 120),
        websiteUrl: String(rawBrand.websiteUrl ?? '').trim().slice(0, 200) || undefined,
        logoUrl: String(rawBrand.logoUrl ?? '').trim().slice(0, 400) || undefined,
        brandTone: String(rawBrand.brandTone ?? '').trim().slice(0, 180) || undefined,
        primaryColorHex: String(rawBrand.primaryColorHex ?? '').trim().slice(0, 12) || undefined,
        secondaryColorHex: String(rawBrand.secondaryColorHex ?? '').trim().slice(0, 12) || undefined,
        ctaStyle:
          typeof rawBrand.ctaStyle === 'string' && ['soft', 'balanced', 'strong'].includes(rawBrand.ctaStyle)
            ? (rawBrand.ctaStyle as 'soft' | 'balanced' | 'strong')
            : undefined,
        audienceHint: String(rawBrand.audienceHint ?? '').trim().slice(0, 240) || undefined,
        valueProposition: String(rawBrand.valueProposition ?? '').trim().slice(0, 280) || undefined
      }
    : null;

  const creativeIntent = parseCreativeIntent(input.creativeIntent);

  if (!topic || !brandProfile?.companyName || !creativeIntent) return undefined;

  const effectGoals = creativeIntent.effectGoals.filter((goal) => goal.id !== 'cringe_hook');

  const startFrameRaw = input.startFrame;
  const startFrame = startFrameRaw && typeof startFrameRaw === 'object'
    ? (() => {
        const sf = startFrameRaw as Record<string, unknown>;
        const styleRaw = String(sf.style ?? '').trim();
        const style = ['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'].includes(styleRaw)
          ? (styleRaw as 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split')
          : undefined;

        return {
          style,
          candidateId: String(sf.candidateId ?? '').trim() || undefined,
          customPrompt: String(sf.customPrompt ?? '').trim().slice(0, 400) || undefined,
          uploadObjectPath: String(sf.uploadObjectPath ?? '').trim() || undefined,
          referenceHint: String(sf.referenceHint ?? '').trim().slice(0, 180) || undefined,
          summary: String(sf.summary ?? '').trim().slice(0, 280) || undefined
        };
      })()
    : undefined;

  return {
    topic,
    brandProfile,
    creativeIntent: {
      ...creativeIntent,
      effectGoals
    },
    startFrame,
    userEditedFlowScript: String(input.userEditedFlowScript ?? '').trim().slice(0, 4000) || undefined
  };
};

const parseVideoPlanV1 = (raw: unknown): VideoPlanV1 | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
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
  if (!scriptRaw || !flowBeats.length) return undefined;

  const scenesRaw = Array.isArray(scriptRaw.scenes) ? scriptRaw.scenes : [];
  const scenes = scenesRaw
    .slice(0, 10)
    .map((entry, index) => (entry && typeof entry === 'object' ? ({ ...(entry as Record<string, unknown>), index } as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => {
      const action = String(entry.action ?? '').trim().slice(0, 240);
      if (!action) return null;
      const orderRaw = Number(entry.order);
      const order = Number.isFinite(orderRaw) ? Math.max(1, Math.floor(orderRaw)) : Number(entry.index) + 1;
      return {
        order,
        action,
        onScreenText: String(entry.onScreenText ?? '').trim().slice(0, 120) || undefined
      };
    })
    .filter((entry): entry is VideoPlanV1['script']['scenes'][number] => Boolean(entry))
    .sort((a, b) => a.order - b.order);

  const narration = String(scriptRaw.narration ?? '').trim().slice(0, 2000);
  if (!hookOpening || !narration) return undefined;

  return {
    hookOpening,
    flowBeats,
    script: {
      narration,
      scenes
    },
    subjectConstraints: Array.isArray(input.subjectConstraints)
      ? input.subjectConstraints.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
      : [],
    promptDirectives: Array.isArray(input.promptDirectives)
      ? input.promptDirectives.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
      : []
  };
};

const parseStoryboardSelection = (jobId: string): StoryboardSelection => {
  const fallback: StoryboardSelection = {
    conceptId: 'concept_web_vertical_slice',
    moodPreset: 'commercial_cta',
    brandProfile: undefined,
    generationPayload: undefined,
    videoPlanV1: undefined,
    approvedScript: undefined,
    approvedScriptV2: undefined,
    audioMode: 'voiceover',
    startFrameCandidateId: undefined,
    startFrameLabel: undefined,
    startFramePrompt: undefined,
    startFrameMode: 'generated_candidate',
    effectiveStartFrameSource: 'generated_candidate',
    precedenceRuleApplied: 'UPLOAD_WINS_OVER_CANDIDATE',
    startFramePolicy: undefined,
    startFrameReferenceObjectPath: undefined,
    userControls: undefined,
    startFrameStyle: 'storefront_hero'
  };

  const record = getJob(jobId);
  if (!record) return fallback;

  const selected = [...record.timeline]
    .reverse()
    .find((event) => event.event === 'STORYBOARD_SELECTED' && typeof event.detail === 'string');

  if (!selected?.detail) return fallback;

  try {
    const parsed = JSON.parse(selected.detail) as Partial<StoryboardSelection> & {
      creativeIntent?: unknown;
      storyboardLight?: unknown;
      userControls?: unknown;
      generationPayload?: unknown;
      videoPlanV1?: unknown;
    };

    const startFrameStyle =
      parsed.startFrameStyle &&
      ['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'].includes(parsed.startFrameStyle)
        ? parsed.startFrameStyle
        : fallback.startFrameStyle;

    const moodPreset =
      parsed.moodPreset && ['commercial_cta', 'problem_solution', 'testimonial', 'humor_light'].includes(parsed.moodPreset)
        ? parsed.moodPreset
        : fallback.moodPreset;

    const rawControls = parsed.userControls && typeof parsed.userControls === 'object' ? parsed.userControls : null;

    const userControls = rawControls
      ? {
          ctaStrength:
            typeof (rawControls as { ctaStrength?: unknown }).ctaStrength === 'string' &&
            ['soft', 'balanced', 'strong'].includes((rawControls as { ctaStrength?: string }).ctaStrength ?? '')
              ? ((rawControls as { ctaStrength?: string }).ctaStrength as 'soft' | 'balanced' | 'strong')
              : 'balanced',
          motionIntensity:
            typeof (rawControls as { motionIntensity?: unknown }).motionIntensity === 'string' &&
            ['low', 'medium', 'high'].includes((rawControls as { motionIntensity?: string }).motionIntensity ?? '')
              ? ((rawControls as { motionIntensity?: string }).motionIntensity as 'low' | 'medium' | 'high')
              : 'medium',
          shotPace:
            typeof (rawControls as { shotPace?: unknown }).shotPace === 'string' &&
            ['relaxed', 'balanced', 'fast'].includes((rawControls as { shotPace?: string }).shotPace ?? '')
              ? ((rawControls as { shotPace?: string }).shotPace as 'relaxed' | 'balanced' | 'fast')
              : 'balanced',
          visualStyle:
            typeof (rawControls as { visualStyle?: unknown }).visualStyle === 'string' &&
            ['clean', 'cinematic', 'ugc'].includes((rawControls as { visualStyle?: string }).visualStyle ?? '')
              ? ((rawControls as { visualStyle?: string }).visualStyle as 'clean' | 'cinematic' | 'ugc')
              : 'clean'
        }
      : undefined;

    const rawBrandProfile = parsed.brandProfile && typeof parsed.brandProfile === 'object'
      ? (parsed.brandProfile as Record<string, unknown>)
      : null;

    const brandProfile = rawBrandProfile
      ? {
          companyName: String(rawBrandProfile.companyName ?? '').trim().slice(0, 120),
          websiteUrl: String(rawBrandProfile.websiteUrl ?? '').trim().slice(0, 200) || undefined,
          logoUrl: String(rawBrandProfile.logoUrl ?? '').trim().slice(0, 400) || undefined,
          brandTone: String(rawBrandProfile.brandTone ?? '').trim().slice(0, 180) || undefined,
          primaryColorHex: String(rawBrandProfile.primaryColorHex ?? '').trim().slice(0, 12) || undefined,
          secondaryColorHex: String(rawBrandProfile.secondaryColorHex ?? '').trim().slice(0, 12) || undefined,
          ctaStyle:
            typeof rawBrandProfile.ctaStyle === 'string' && ['soft', 'balanced', 'strong'].includes(rawBrandProfile.ctaStyle)
              ? (rawBrandProfile.ctaStyle as 'soft' | 'balanced' | 'strong')
              : undefined,
          audienceHint: String(rawBrandProfile.audienceHint ?? '').trim().slice(0, 240) || undefined,
          valueProposition: String(rawBrandProfile.valueProposition ?? '').trim().slice(0, 280) || undefined
        }
      : undefined;

    return {
      conceptId: String(parsed.conceptId ?? fallback.conceptId),
      moodPreset,
      creativeIntent: parseCreativeIntent(parsed.creativeIntent),
      storyboardLight: parseStoryboardLight(parsed.storyboardLight),
      brandProfile: brandProfile?.companyName ? brandProfile : undefined,
      generationPayload: parseGenerationPayloadV1(parsed.generationPayload),
      videoPlanV1: parseVideoPlanV1(parsed.videoPlanV1),
      approvedScript: typeof parsed.approvedScript === 'string' ? parsed.approvedScript : undefined,
      approvedScriptV2: parseScriptV2((parsed as { approvedScriptV2?: unknown }).approvedScriptV2),
      audioMode:
        typeof parsed.audioMode === 'string' && ['voiceover', 'scene', 'hybrid'].includes(parsed.audioMode)
          ? (parsed.audioMode as 'voiceover' | 'scene' | 'hybrid')
          : fallback.audioMode,
      startFrameCandidateId:
        typeof parsed.startFrameCandidateId === 'string' && parsed.startFrameCandidateId.trim()
          ? parsed.startFrameCandidateId
          : undefined,
      startFrameLabel: typeof parsed.startFrameLabel === 'string' ? parsed.startFrameLabel : undefined,
      startFramePrompt: typeof parsed.startFramePrompt === 'string' ? parsed.startFramePrompt : undefined,
      startFrameMode:
        typeof parsed.startFrameMode === 'string' && ['uploaded_asset', 'uploaded_reference', 'generated_candidate'].includes(parsed.startFrameMode)
          ? (parsed.startFrameMode as 'uploaded_asset' | 'uploaded_reference' | 'generated_candidate')
          : fallback.startFrameMode,
      effectiveStartFrameSource:
        typeof parsed.effectiveStartFrameSource === 'string' && ['uploaded_asset', 'generated_candidate'].includes(parsed.effectiveStartFrameSource)
          ? (parsed.effectiveStartFrameSource as 'uploaded_asset' | 'generated_candidate')
          : fallback.effectiveStartFrameSource,
      precedenceRuleApplied:
        parsed.precedenceRuleApplied === 'UPLOAD_WINS_OVER_CANDIDATE' ? 'UPLOAD_WINS_OVER_CANDIDATE' : fallback.precedenceRuleApplied,
      startFramePolicy:
        parsed.startFramePolicy && typeof parsed.startFramePolicy === 'object'
          ? {
              decision:
                typeof (parsed.startFramePolicy as { decision?: unknown }).decision === 'string'
                  ? ((parsed.startFramePolicy as { decision?: string }).decision as 'allow' | 'fallback' | 'block')
                  : undefined,
              reasonCode:
                typeof (parsed.startFramePolicy as { reasonCode?: unknown }).reasonCode === 'string'
                  ? (parsed.startFramePolicy as { reasonCode?: string }).reasonCode
                  : undefined,
              matchedSignals: Array.isArray((parsed.startFramePolicy as { matchedSignals?: unknown }).matchedSignals)
                ? ((parsed.startFramePolicy as { matchedSignals?: unknown }).matchedSignals as unknown[]).map((value) => String(value))
                : undefined
            }
          : undefined,
      startFrameReferenceObjectPath:
        typeof parsed.startFrameReferenceObjectPath === 'string' && parsed.startFrameReferenceObjectPath.trim()
          ? parsed.startFrameReferenceObjectPath
          : undefined,
      userControls,
      startFrameStyle
    };
  } catch {
    return fallback;
  }
};

const fetchJobContext = async (jobId: string): Promise<JobContext> => {
  if (!isPostgres()) {
    const job = getJob(jobId);
    if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);
    const project = getProject(job.projectId);
    if (!project) throw new Error(`PROJECT_NOT_FOUND:${job.projectId}`);

    return {
      id: job.id,
      status: job.status as VideoJobStatus,
      project_id: job.projectId,
      organization_id: project.organizationId
    };
  }

  const rows = await queryPg<JobContext>(
    `SELECT j.id, j.status, j.project_id, p.organization_id
       FROM jobs j
       JOIN projects p ON p.id = j.project_id
      WHERE j.id = $1
      LIMIT 1;`,
    [jobId],
    { retryClass: 'read' }
  );

  const row = rows[0];
  if (!row) throw new Error(`JOB_NOT_FOUND:${jobId}`);
  return row;
};

const insertTimeline = async (jobId: string, event: string, detail?: string) => {
  if (!isPostgres()) {
    appendTimelineEvent(jobId, {
      at: new Date().toISOString(),
      event,
      detail
    });
    return;
  }

  await queryPg(
    'INSERT INTO job_events (job_id, at, event, detail) VALUES ($1,$2,$3,$4);',
    [jobId, new Date().toISOString(), event, detail ?? null],
    { retryClass: 'write' }
  );
};

const transitionStatus = async (jobId: string, toStatus: VideoJobStatus, detail: string) => {
  if (!isPostgres()) {
    transitionJob(jobId, toStatus, detail);
    return;
  }

  await txPg(async (client) => {
    await client.query('SET LOCAL statement_timeout = 8000;');
    const currentRes = await client.query<JobContext>(
      `SELECT j.id, j.status, j.project_id, p.organization_id
         FROM jobs j
         JOIN projects p ON p.id = j.project_id
        WHERE j.id = $1
        LIMIT 1;`,
      [jobId]
    );

    const current = currentRes.rows[0];
    if (!current) throw new Error(`JOB_NOT_FOUND:${jobId}`);

    if (current.status === toStatus) return;

    if (!isTransitionAllowed(current.status as VideoJobStatus, toStatus)) {
      throw new Error(`INVALID_TRANSITION:${current.status}->${toStatus}`);
    }

    const now = new Date().toISOString();
    await client.query('UPDATE jobs SET status = $2, updated_at = $3 WHERE id = $1;', [jobId, toStatus, now]);
    await client.query('INSERT INTO job_events (job_id, at, event, detail) VALUES ($1,$2,$3,$4);', [
      jobId,
      now,
      `STATUS_${toStatus}`,
      detail
    ]);
  });
};

const upsertLedgerFinalState = async (
  organizationId: string,
  jobId: string,
  type: 'COMMITTED' | 'RELEASED',
  amount: number,
  note: string
) => {
  if (!isPostgres()) {
    if (type === 'COMMITTED') {
      commitCredit(organizationId, jobId);
      return;
    }
    releaseCredit(organizationId, jobId);
    return;
  }

  await txPg(async (client) => {
    await client.query('SET LOCAL statement_timeout = 8000;');
    const entries = await client.query<LedgerRow>(
      'SELECT type FROM credit_ledger WHERE organization_id = $1 AND job_id = $2 ORDER BY created_at ASC;',
      [organizationId, jobId]
    );

    const hasReserved = entries.rows.some((entry) => entry.type === 'RESERVED');
    const finalized = entries.rows.some((entry) => entry.type === 'COMMITTED' || entry.type === 'RELEASED');
    if (!hasReserved || finalized) return;

    await client.query(
      'INSERT INTO credit_ledger (id, organization_id, job_id, amount, type, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7);',
      [randomUUID(), organizationId, jobId, amount, type, note, new Date().toISOString()]
    );
  });
};

const markFailedFinal = async (jobId: string, stage: Stage, reason: string) => {
  const context = await fetchJobContext(jobId);

  if (context.status !== 'FAILED') {
    if (isTransitionAllowed(context.status, 'FAILED')) {
      await transitionStatus(jobId, 'FAILED', `stage=${stage} reason=${reason}`);
    } else {
      await insertTimeline(jobId, 'FAILED_FINAL', `stage=${stage} reason=${reason}`);
    }
  }

  await upsertLedgerFinalState(context.organization_id, jobId, 'RELEASED', +1, `released after ${stage} failure`);
  await insertTimeline(jobId, 'BILLING_CREDIT_RELEASED', `amount=+1 stage=${stage} reason=${reason}`);

  await deadLetterQueue.add(
    'failed',
    {
      jobId,
      forceFail: false,
      stage,
      reason,
      failedAt: new Date().toISOString(),
      attemptsMade: 0
    },
    {
      jobId: `${jobId}-${stage}-dlq-${Date.now()}`,
      removeOnComplete: false,
      removeOnFail: false
    }
  );
};

const recoverStaleActiveJobs = async () => {
  for (const binding of stageQueues) {
    const activeJobs = await binding.queue.getJobs(['active'], 0, 199, true);
    const sortedActiveJobs = activeJobs
      .map((active) => ({
        active,
        queueJobId: String(active.id ?? '')
      }))
      .filter((entry) => entry.queueJobId)
      .sort((a, b) => a.queueJobId.localeCompare(b.queueJobId));

    for (const { active, queueJobId } of sortedActiveJobs) {

      const lockKey = binding.queue.toKey(`${queueJobId}:lock`);
      const lockExists = (await redis.exists(lockKey)) === 1;
      if (lockExists) continue;

      const data = (active.data ?? {}) as StagePayload;
      const pipelineJobId = String(data.jobId ?? '').trim();

      logEvent({
        event: 'queue_stale_active_detected',
        level: 'WARN',
        stage: binding.stage,
        jobId: pipelineJobId || undefined,
        detail: `queueJobId=${queueJobId} lockKeyMissing=true`
      });

      if (pipelineJobId) {
        await clearStageIdempotency(pipelineJobId, binding.stage);

        try {
          await insertTimeline(
            pipelineJobId,
            'QUEUE_STALE_ACTIVE_RECOVERED',
            `stage=${binding.stage} queueJobId=${queueJobId} lockKeyMissing=true`
          );
          await markFailedFinal(pipelineJobId, binding.stage, `STALE_ACTIVE_NO_LOCK:${queueJobId}`);
        } catch (error) {
          logEvent({
            event: 'queue_stale_active_mark_failed_error',
            level: 'WARN',
            stage: binding.stage,
            jobId: pipelineJobId,
            detail: String((error as Error)?.message ?? error)
          });
        }
      }

      try {
        await active.remove();
      } catch {
        try {
          await binding.queue.remove(queueJobId);
        } catch {
          // noop: keep boot resilient
        }
      }
    }
  }
};

const handleFinalFailure = async (stage: Stage, job: Job<StagePayload> | undefined, error: Error) => {
  if (!job?.data?.jobId) return;

  const attempts = job.opts.attempts ?? defaultRetryPolicy.attempts;
  const message = String(error?.message ?? '');
  const failedReason = String(job.failedReason ?? '');
  const isHardFailure =
    error instanceof UnrecoverableError ||
    message.includes('HARD_FAILURE:') ||
    failedReason.includes('HARD_FAILURE:') ||
    message.includes('UnrecoverableError') ||
    failedReason.includes('UnrecoverableError');
  const isFinal = isHardFailure || job.attemptsMade >= attempts;
  if (!isFinal) return;

  const reason = (failedReason || message).slice(0, 300);
  await markFailedFinal(job.data.jobId, stage, reason);
};

const enqueueAudio = async (data: StagePayload) => {
  await audioQueue.add('audio-step', data, {
    ...queueOpts,
    jobId: `${data.jobId}-audio`
  });
};

const enqueueAssembly = async (data: StagePayload) => {
  await assemblyQueue.add('assembly-step', data, {
    ...queueOpts,
    jobId: `${data.jobId}-assembly`
  });
};

const forceFailToError = (stage: Stage, data: StagePayload) => {
  if (!data.forceFail) return;
  if (data.failMode === 'retryable') return new Error(`RETRYABLE_FAILURE:${stage}`);
  return new UnrecoverableError(`HARD_FAILURE:${stage}`);
};

const processVideo = async (job: Job<StagePayload>) => {
  const { jobId } = job.data;
  if (!(await reserveIdempotency(jobId, 'video'))) return { deduped: true };

  try {
    const fail = forceFailToError('video', job.data);
    if (fail) throw fail;

    const context = await fetchJobContext(jobId);
    const project = getProject(context.project_id);
    const topic = project?.topic ?? `faceless short for ${context.project_id}`;
    const variantType = project?.variantType === 'MASTER_30' ? 'MASTER_30' : 'SHORT_15';
    const storyboard = parseStoryboardSelection(jobId);

    await transitionStatus(jobId, 'VIDEO_PENDING', 'video worker started');

    const result = await withStageTimeout('video', jobId, () =>
      runVideoStage({
        jobId,
        topic,
        variantType,
        conceptId: storyboard.conceptId,
        moodPreset: storyboard.moodPreset,
        creativeIntent: storyboard.creativeIntent,
        storyboardLight: storyboard.storyboardLight,
        brandProfile: storyboard.brandProfile,
        generationPayload: storyboard.generationPayload,
        videoPlanV1: storyboard.videoPlanV1,
        approvedScript: storyboard.approvedScript,
        approvedScriptV2: storyboard.approvedScriptV2,
        startFrameStyle: storyboard.startFrameStyle,
        startFrameCandidateId: storyboard.startFrameCandidateId,
        startFramePromptOverride: storyboard.startFramePrompt,
        startFrameReferenceObjectPath: storyboard.startFrameReferenceObjectPath,
        userControls: storyboard.userControls
      })
    );
    await setAssetRef(jobId, 'script', result.script);
    await setAssetRef(jobId, 'videoObjectPath', result.video.objectPath);
    await setAssetRef(jobId, 'imageObjectPath', result.image.objectPath);
    if (result.referenceAsset?.objectPath) {
      await setAssetRef(jobId, 'startFrameReferenceObjectPath', result.referenceAsset.objectPath);
    }

    await insertTimeline(
      jobId,
      'VIDEO_CONCEPT_APPLIED',
      JSON.stringify({
        conceptId: result.conceptId,
        moodPreset: result.moodPreset,
        startFrameStyle: result.startFrameStyle,
        startFrameCandidateId: result.startFrameCandidateId ?? null,
        startFrameLabel: result.startFrameLabel ?? null,
        startFrameMode: storyboard.startFrameMode ?? (storyboard.startFrameReferenceObjectPath ? 'uploaded_asset' : 'generated_candidate'),
        effectiveStartFrameSource:
          storyboard.effectiveStartFrameSource ?? (storyboard.startFrameReferenceObjectPath ? 'uploaded_asset' : 'generated_candidate'),
        precedenceRuleApplied: storyboard.precedenceRuleApplied ?? 'UPLOAD_WINS_OVER_CANDIDATE',
        startFramePolicyDecision: storyboard.startFramePolicy?.decision ?? 'allow',
        startFramePolicyReasonCode: storyboard.startFramePolicy?.reasonCode ?? null,
        startFrameReferenceObjectPath: storyboard.startFrameReferenceObjectPath ?? null,
        selectedAudioMode: storyboard.audioMode ?? 'voiceover',
        creativeIntent: result.creativeIntent,
        storyboardLightBeatCount: result.storyboardLight?.beats?.length ?? 0,
        brandProfile: result.brandProfile ?? null
      })
    );
    await insertTimeline(
      jobId,
      'SCRIPT_DURATION_VALIDATED',
      JSON.stringify({
        targetSeconds: result.scriptValidation.targetSeconds,
        estimatedSeconds: result.scriptValidation.estimatedSeconds,
        suggestedWords: result.scriptValidation.suggestedWords,
        withinTarget: result.scriptValidation.withinTarget,
        condensed: result.scriptValidation.condensed
      })
    );
    await insertTimeline(jobId, 'ASSET_SCRIPT_READY', result.script.slice(0, 280));
    await insertTimeline(jobId, 'ASSET_IMAGE_STORED', buildAssetDetail('image', result.image));
    await insertTimeline(jobId, 'IMAGE_MODEL_DIAGNOSTICS', JSON.stringify(result.imageDiagnostics));
    await insertTimeline(jobId, 'ASSET_VIDEO_STORED', buildAssetDetail('video', result.video));
    if (result.referenceAsset) {
      await insertTimeline(jobId, 'ASSET_STARTFRAME_REFERENCE_STORED', buildAssetDetail('startframe_reference', result.referenceAsset));
    }

    if (result.brandProfile) {
      await insertTimeline(jobId, 'BRAND_PROFILE_APPLIED', JSON.stringify(result.brandProfile));
    }

    if (result.creativeIntent) {
      await insertTimeline(jobId, 'CREATIVE_INTENT_APPLIED', JSON.stringify(result.creativeIntent));
    }

    if (result.storyboardLight) {
      await insertTimeline(
        jobId,
        'STORYBOARD_LIGHT_NORMALIZED',
        JSON.stringify({
          beats: result.storyboardLight.beats,
          hookHint: result.storyboardLight.hookHint,
          ctaHint: result.storyboardLight.ctaHint,
          pacingHint: result.storyboardLight.pacingHint
        })
      );
    }

    if (result.videoPlanV1) {
      await insertTimeline(
        jobId,
        result.videoPlanReconciled ? 'VIDEO_PLAN_V1_RECONCILED' : 'VIDEO_PLAN_V1_GENERATED',
        JSON.stringify({
          hookOpening: result.videoPlanV1.hookOpening,
          flowBeatCount: result.videoPlanV1.flowBeats.length,
          subjectConstraints: result.videoPlanV1.subjectConstraints,
          promptDirectives: result.videoPlanV1.promptDirectives,
          source: result.videoPlanSource
        })
      );
    }

    await insertTimeline(jobId, 'PROMPT_COMPILER_V2_APPLIED', JSON.stringify(result.promptCompiler));
    await insertTimeline(jobId, 'HOOK_ENHANCER_APPLIED', JSON.stringify({ rule: result.promptCompiler.hookRule ?? null }));
    await insertTimeline(
      jobId,
      'SHOT_STYLE_LIBRARY_APPLIED',
      JSON.stringify({
        shotStyleSet: result.promptCompiler.shotStyleSet,
        intentRules: result.promptCompiler.intentRules
      })
    );

    if (result.promptCompiler.calmExceptionApplied) {
      await insertTimeline(jobId, 'CALM_MODE_EXCEPTION_APPLIED', JSON.stringify({ applied: true }));
    }

    if (result.userControls) {
      await insertTimeline(jobId, 'USER_CONTROLS_ENFORCED', JSON.stringify(result.userControls));
    }

    await insertTimeline(jobId, 'MOTION_ENFORCED', JSON.stringify(result.motionEnforcement));

    await enqueueAudio(job.data);

    return { stage: 'video', enqueued: 'audio', videoObjectPath: result.video.objectPath };
  } catch (error) {
    await clearStageIdempotency(jobId, 'video');
    if (isFatalProviderError(error)) {
      logEvent({
        event: 'provider_stage_fatal',
        level: 'ERROR',
        stage: 'video',
        jobId,
        detail: (error as Error).message
      });
      throw new UnrecoverableError(`HARD_FAILURE:video:${(error as Error).message}`);
    }
    throw error;
  }
};

const processAudio = async (job: Job<StagePayload>) => {
  const { jobId } = job.data;
  if (!(await reserveIdempotency(jobId, 'audio'))) return { deduped: true };

  try {
    await transitionStatus(jobId, 'AUDIO_PENDING', 'audio worker started');

    const storyboard = parseStoryboardSelection(jobId);
    const script = (await getAssetRef(jobId, 'script')) ?? 'Kurzer faceless Promo-Clip.';
    const videoObjectPath = await getAssetRef(jobId, 'videoObjectPath');

    const result = await withStageTimeout('audio', jobId, () =>
      runAudioStage({
        jobId,
        script,
        audioMode: storyboard.audioMode ?? 'voiceover',
        videoObjectPath: videoObjectPath ?? undefined
      })
    );
    await setAssetRef(jobId, 'audioObjectPath', result.audio.objectPath);

    await insertTimeline(jobId, 'AUDIO_MODE_APPLIED', JSON.stringify(result.audioStrategy));
    await insertTimeline(jobId, 'ASSET_AUDIO_STORED', buildAssetDetail('audio', result.audio));

    await enqueueAssembly(job.data);

    return {
      stage: 'audio',
      enqueued: 'assembly',
      audioObjectPath: result.audio.objectPath,
      audioMode: result.audioStrategy.effectiveMode,
      fallback: result.audioStrategy.fallbackApplied
    };
  } catch (error) {
    await clearStageIdempotency(jobId, 'audio');
    if (isFatalProviderError(error)) {
      logEvent({
        event: 'provider_stage_fatal',
        level: 'ERROR',
        stage: 'audio',
        jobId,
        detail: (error as Error).message
      });
      throw new UnrecoverableError(`HARD_FAILURE:audio:${(error as Error).message}`);
    }
    throw error;
  }
};

const processAssembly = async (job: Job<StagePayload>) => {
  const { jobId } = job.data;
  if (!(await reserveIdempotency(jobId, 'assembly'))) return { deduped: true };

  try {
    const context = await fetchJobContext(jobId);
    const project = getProject(context.project_id);
    const storyboard = parseStoryboardSelection(jobId);
    const variantType = project?.variantType === 'MASTER_30' ? 'MASTER_30' : 'SHORT_15';

    await transitionStatus(jobId, 'ASSEMBLY_PENDING', 'assembly worker started');
    await transitionStatus(jobId, 'RENDERING', 'rendering started');

    const videoObjectPath = await getAssetRef(jobId, 'videoObjectPath');
    const audioObjectPath = await getAssetRef(jobId, 'audioObjectPath');
    if (!videoObjectPath || !audioObjectPath) {
      throw new UnrecoverableError(`HARD_FAILURE:assembly:ASSET_REF_MISSING:${jobId}`);
    }

    const final = await withStageTimeout('assembly', jobId, () =>
      runAssemblyStage({
        jobId,
        videoObjectPath,
        audioObjectPath,
        variantType
      })
    );

    await setAssetRef(jobId, 'finalObjectPath', final.finalVideo.objectPath);
    await insertTimeline(jobId, 'ASSET_FINAL_VIDEO_STORED', buildAssetDetail('final_video', final.finalVideo));
    await insertTimeline(jobId, 'ASSEMBLY_TARGET_DURATION', `${variantType}:${final.targetSeconds}s`);
    await insertTimeline(
      jobId,
      'CAPTION_SAFE_AREA_APPLIED',
      JSON.stringify({
        scale: final.safeArea.scale,
        marginRatio: final.safeArea.marginRatio,
        marginX: final.safeArea.marginX,
        marginY: final.safeArea.marginY,
        safeWidth: final.safeArea.safeWidth,
        safeHeight: final.safeArea.safeHeight,
        frameWidth: final.safeArea.frameWidth,
        frameHeight: final.safeArea.frameHeight
      })
    );

    const captionPrepared = prepareCaptionV2Payload(storyboard);

    await insertTimeline(
      jobId,
      'CAPTION_V2_GENERATED',
      JSON.stringify({
        mode: captionPrepared.mode,
        dialogLineCount: captionPrepared.dialogLineCount,
        speakerCount: captionPrepared.speakerCount,
        beatCount: storyboard.storyboardLight?.beats?.length ?? 0,
        source: captionPrepared.source,
        fallbackApplied: captionPrepared.fallbackApplied,
        fallbackReason: captionPrepared.fallbackReason,
        segmentPreview: captionPrepared.segments.slice(0, 3)
      })
    );

    await insertTimeline(
      jobId,
      'CAPTION_V2_STYLE_APPLIED',
      JSON.stringify({
        preset: 'tiktok_clean_v2',
        emphasis: captionPrepared.mode === 'dialog' ? 'speaker_prefix' : 'phrase_highlight',
        grammarCleanupApplied: true
      })
    );

    await insertTimeline(
      jobId,
      'CAPTION_V2_QC_PASSED',
      JSON.stringify({
        mode: captionPrepared.mode,
        safeAreaApplied: true,
        grammarCleanupApplied: true,
        dialogSupportApplied: captionPrepared.mode === 'dialog',
        fallbackApplied: captionPrepared.fallbackApplied
      })
    );

    await insertTimeline(
      jobId,
      'FINAL_SYNC_OK',
      JSON.stringify({
        mode: final.finalSync.mode,
        targetSeconds: final.finalSync.targetSeconds,
        toleranceSeconds: final.finalSync.toleranceSeconds,
        sourceVideoSeconds: final.finalSync.sourceVideoSeconds,
        sourceAudioSeconds: final.finalSync.sourceAudioSeconds,
        adjustedAudioSeconds: final.finalSync.adjustedAudioSeconds,
        outputSeconds: final.finalSync.outputSeconds,
        tempo: final.finalSync.tempo,
        avDeltaSeconds: final.finalSync.avDeltaSeconds,
        deltaToTargetSeconds: final.finalSync.deltaToTargetSeconds,
        withinTolerance: final.finalSync.withinTolerance
      })
    );
    await insertTimeline(jobId, 'FINAL_MOTION_OK', JSON.stringify(final.finalMotion));

    await transitionStatus(jobId, 'READY', 'render complete');
    await upsertLedgerFinalState(context.organization_id, jobId, 'COMMITTED', 0, 'reserved credit committed on READY');
    await insertTimeline(jobId, 'BILLING_CREDIT_COMMITTED', 'amount=0 status=READY');

    return { stage: 'assembly', status: 'READY', finalObjectPath: final.finalVideo.objectPath };
  } catch (error) {
    await clearStageIdempotency(jobId, 'assembly');
    if (isFatalProviderError(error)) {
      logEvent({
        event: 'provider_stage_fatal',
        level: 'ERROR',
        stage: 'assembly',
        jobId,
        detail: (error as Error).message
      });
      throw new UnrecoverableError(`HARD_FAILURE:assembly:${(error as Error).message}`);
    }
    throw error;
  }
};

const processPublish = async (job: Job<StagePayload>) => {
  const { jobId } = job.data;
  if (!(await reserveIdempotency(jobId, 'publish'))) return { deduped: true };

  const targets = job.data.targets && job.data.targets.length ? job.data.targets : ['tiktok', 'instagram'];

  await transitionStatus(jobId, 'PUBLISH_PENDING', 'publishing to social targets');
  publishNow(jobId, targets);
  await transitionStatus(jobId, 'PUBLISHED', `published to ${targets.join(',')}`);

  return { stage: 'publish', targets, posts: getPublishPosts(jobId).length };
};

export const ensureQueueRuntime = async () => {
  registerShutdownHooks();
  if (initialized) return;

  await redisReady;
  await recoverStaleActiveJobs();

  const videoWorker = createWorker(queueNames.video, processVideo);
  const audioWorker = createWorker(queueNames.audio, processAudio);
  const assemblyWorker = createWorker(queueNames.assembly, processAssembly);
  const publishWorker = createWorker(queueNames.publish, processPublish);

  videoWorker.on('failed', async (job, error) => handleFinalFailure('video', job, error));
  audioWorker.on('failed', async (job, error) => handleFinalFailure('audio', job, error));
  assemblyWorker.on('failed', async (job, error) => handleFinalFailure('assembly', job, error));
  publishWorker.on('failed', async (job, error) => handleFinalFailure('publish', job, error));

  workers.push(videoWorker, audioWorker, assemblyWorker, publishWorker);

  initialized = true;
};

export const closeQueueRuntime = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await Promise.all(workers.map((worker) => worker.close(true).catch(() => undefined)));
    await Promise.all(queueEvents.map((events) => events.close().catch(() => undefined)));
    await Promise.all(
      [videoQueue.close(), audioQueue.close(), assemblyQueue.close(), publishQueue.close(), deadLetterQueue.close()].map((p) =>
        p.catch(() => undefined)
      )
    );
    await Promise.all(workerConnections.map((connection) => connection.quit().catch(() => undefined)));
    await redis.quit().catch(() => undefined);
  } finally {
    initialized = false;
    shuttingDown = false;
  }
};

export const enqueueGeneration = async (jobId: string, options?: { forceFail?: boolean; failMode?: 'retryable' | 'hard' }) => {
  const current = getJob(jobId);
  if (!current) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  if (current.status === 'READY' || current.status === 'FAILED' || current.status === 'PUBLISHED') {
    return current;
  }

  await ensureQueueRuntime();
  console.log(`[DEBUG] enqueueGeneration jobId=${jobId} redisStatusBeforeAdd=${redis.status} redisUrl=${redisUrl}`);
  console.log('[DEBUG] 🔥 calling videoQueue.add()');

  const added = await videoQueue.add(
    'video-step',
    {
      jobId,
      forceFail: options?.forceFail,
      failMode: options?.failMode
    },
    {
      ...queueOpts,
      jobId: `${jobId}-video`
    }
  );

  console.log(`[DEBUG] ✅ videoQueue.add() resolved queueJobId=${String(added.id)}`);

  return getJob(jobId);
};

export const enqueuePublish = async (jobId: string, targets: PublishTarget[]) => {
  const current = getJob(jobId);
  if (!current) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  await ensureQueueRuntime();

  await publishQueue.add(
    'publish-step',
    {
      jobId,
      targets
    },
    {
      ...queueOpts,
      jobId: `${jobId}-publish`
    }
  );

  return getJob(jobId);
};

export const listDeadLetters = async (limit = 20) => {
  await ensureQueueRuntime();
  const jobs = await deadLetterQueue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, limit - 1, true);

  return jobs.map((job) => ({
    id: String(job.id),
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    timestamp: job.timestamp
  }));
};

export const replayDeadLetter = async (deadLetterId: string) => {
  await ensureQueueRuntime();
  const deadJob = await deadLetterQueue.getJob(deadLetterId);
  if (!deadJob) throw new Error(`DLQ_NOT_FOUND:${deadLetterId}`);

  const payload = deadJob.data;
  if (!payload.jobId || !payload.stage) throw new Error(`DLQ_INVALID_PAYLOAD:${deadLetterId}`);

  await clearIdempotency(payload.jobId);

  if (!isPostgres()) {
    const job = getJob(payload.jobId);
    if (job) {
      job.status = 'SELECTED';
      appendTimelineEvent(payload.jobId, {
        at: new Date().toISOString(),
        event: 'DLQ_REPLAY_RESET',
        detail: `source_dlq=${deadLetterId} stage=${payload.stage}`
      });
    }
  } else {
    await txPg(async (client) => {
      await client.query('SET LOCAL statement_timeout = 8000;');
      await client.query('UPDATE jobs SET status = $2, updated_at = $3 WHERE id = $1;', [payload.jobId, 'SELECTED', new Date().toISOString()]);
      await client.query('INSERT INTO job_events (job_id, at, event, detail) VALUES ($1,$2,$3,$4);', [
        payload.jobId,
        new Date().toISOString(),
        'DLQ_REPLAY_RESET',
        `source_dlq=${deadLetterId} stage=${payload.stage}`
      ]);
    });
  }

  await videoQueue.add(
    'video-step',
    {
      jobId: payload.jobId,
      forceFail: false,
      replayCount: (payload.replayCount ?? 0) + 1
    },
    {
      ...queueOpts,
      jobId: `${payload.jobId}-video-replay-${Date.now()}`
    }
  );

  return {
    replayed: true,
    deadLetterId,
    jobId: payload.jobId
  };
};
