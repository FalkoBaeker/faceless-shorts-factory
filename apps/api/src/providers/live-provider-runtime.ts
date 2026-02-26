import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from '../config/env-loader.ts';
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
  maxRpmVideo: Number(process.env.MAX_RPM_VIDEO ?? 3)
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
    await openAiGet('/v1/models/gpt-image-1');
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

const createScriptFromLlm = async (topic: string, variantType: 'SHORT_15' | 'MASTER_30') => {
  checkRate('llm', cfg.maxRpmLlm);
  reserveBudget(0.01, 'llm-script');
  const response = await openAiPostJson('/v1/responses', {
    model: 'gpt-4o-mini',
    input: `Create a concise narration script (${variantType}) for: ${topic}. Output 2-3 short sentences in German.` ,
    max_output_tokens: 120
  });
  const text = parseOpenAiResponseText(response);
  if (!text) {
    throw new ProviderRuntimeError('LLM_EMPTY_OUTPUT', { provider: 'openai', fatal: true });
  }
  return text;
};

const createImage = async (prompt: string) => {
  reserveBudget(0.04, 'image-generation');
  const response = await openAiPostJson('/v1/images/generations', {
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024'
  });
  const data = Array.isArray(response.data) ? (response.data[0] as Record<string, unknown> | undefined) : undefined;
  const b64 = data?.b64_json;
  if (typeof b64 !== 'string' || !b64.length) {
    throw new ProviderRuntimeError('IMAGE_B64_MISSING', { provider: 'openai', fatal: true });
  }
  return Buffer.from(b64, 'base64');
};

const createVideo = async (prompt: string, variantType: 'SHORT_15' | 'MASTER_30') => {
  checkRate('video', cfg.maxRpmVideo);
  const seconds = variantType === 'SHORT_15' ? '4' : '8';
  const model = 'sora-2';
  const estimated = Number(seconds) * 0.1;
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

const muxVideoAndAudio = (videoBytes: Buffer, audioBytes: Buffer) => {
  const dir = mkdtempSync(join(tmpdir(), 'fsf-assemble-'));
  const inputVideo = join(dir, 'input-video.mp4');
  const inputAudio = join(dir, 'input-audio.mp3');
  const output = join(dir, 'output-final.mp4');

  try {
    writeFileSync(inputVideo, videoBytes);
    writeFileSync(inputAudio, audioBytes);

    const run = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', inputVideo, '-i', inputAudio, '-c:v', 'copy', '-c:a', 'aac', '-shortest', output],
      { encoding: 'utf8' }
    );

    if (run.status !== 0) {
      throw new ProviderRuntimeError(`FFMPEG_MUX_FAILED:${run.stderr?.slice(0, 300) ?? 'unknown'}`, {
        provider: 'ffmpeg',
        fatal: true
      });
    }

    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const runVideoStage = async (input: { jobId: string; topic: string; variantType: 'SHORT_15' | 'MASTER_30' }) => {
  await runProviderHealthchecks();

  const llmText = await createScriptFromLlm(input.topic, input.variantType);
  const imageBytes = await createImage(`Poster frame for: ${llmText}`);
  const video = await createVideo(llmText, input.variantType);

  const imageAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/keyframe.png`, imageBytes, 'image/png', 'openai-image');
  const videoAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/segment.mp4`, video.bytes, 'video/mp4', 'openai-video');

  return {
    script: llmText,
    image: imageAsset,
    video: videoAsset,
    videoModel: video.model,
    videoId: video.videoId
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

export const runAssemblyStage = async (input: { jobId: string; videoObjectPath: string; audioObjectPath: string }) => {
  await runProviderHealthchecks();

  const videoBytes = await supabaseDownload(input.videoObjectPath);
  const audioBytes = await supabaseDownload(input.audioObjectPath);
  const muxed = muxVideoAndAudio(videoBytes, audioBytes);

  const finalAsset = await uploadAsset(input.jobId, `jobs/${input.jobId}/assets/final.mp4`, muxed, 'video/mp4', 'ffmpeg');

  return {
    finalVideo: finalAsset
  };
};
