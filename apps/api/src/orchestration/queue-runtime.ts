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

type StoryboardSelection = {
  conceptId: string;
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

const parseStoryboardSelection = (jobId: string): StoryboardSelection => {
  const fallback: StoryboardSelection = {
    conceptId: 'concept_web_vertical_slice',
    startFrameStyle: 'storefront_hero'
  };

  const record = getJob(jobId);
  if (!record) return fallback;

  const selected = [...record.timeline]
    .reverse()
    .find((event) => event.event === 'STORYBOARD_SELECTED' && typeof event.detail === 'string');

  if (!selected?.detail) return fallback;

  try {
    const parsed = JSON.parse(selected.detail) as Partial<StoryboardSelection>;
    const startFrameStyle =
      parsed.startFrameStyle &&
      ['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'].includes(parsed.startFrameStyle)
        ? parsed.startFrameStyle
        : fallback.startFrameStyle;

    return {
      conceptId: String(parsed.conceptId ?? fallback.conceptId),
      startFrameStyle
    } as StoryboardSelection;
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

    for (const active of activeJobs) {
      const queueJobId = String(active.id ?? '');
      if (!queueJobId) continue;

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
        startFrameStyle: storyboard.startFrameStyle
      })
    );
    await setAssetRef(jobId, 'script', result.script);
    await setAssetRef(jobId, 'videoObjectPath', result.video.objectPath);
    await setAssetRef(jobId, 'imageObjectPath', result.image.objectPath);

    await insertTimeline(
      jobId,
      'VIDEO_CONCEPT_APPLIED',
      JSON.stringify({ conceptId: result.conceptId, startFrameStyle: result.startFrameStyle })
    );
    await insertTimeline(jobId, 'ASSET_SCRIPT_READY', result.script.slice(0, 280));
    await insertTimeline(jobId, 'ASSET_IMAGE_STORED', buildAssetDetail('image', result.image));
    await insertTimeline(jobId, 'ASSET_VIDEO_STORED', buildAssetDetail('video', result.video));

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

    const script = (await getAssetRef(jobId, 'script')) ?? 'Kurzer faceless Promo-Clip.';
    const result = await withStageTimeout('audio', jobId, () => runAudioStage({ jobId, script }));
    await setAssetRef(jobId, 'audioObjectPath', result.audio.objectPath);

    await insertTimeline(jobId, 'ASSET_AUDIO_STORED', buildAssetDetail('audio', result.audio));

    await enqueueAssembly(job.data);

    return { stage: 'audio', enqueued: 'assembly', audioObjectPath: result.audio.objectPath };
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
    await insertTimeline(jobId, 'CAPTION_SAFE_AREA_APPLIED', `scale=${final.safeAreaScale}`);

    await transitionStatus(jobId, 'READY', 'render complete');
    await upsertLedgerFinalState(context.organization_id, jobId, 'COMMITTED', 0, 'reserved credit committed on READY');

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
