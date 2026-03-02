import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createProjectHandler,
  createScriptDraftHandler,
  getBrandProfileHandler,
  upsertBrandProfileHandler,
  uploadStartFrameHandler,
  createStartFramePreflightHandler,
  createStartFrameCandidatesHandler,
  selectConceptHandler,
  generateHandler,
  publishJobHandler,
  getJobHandler,
  getJobAssetsHandler,
  getLedgerHandler,
  getAdminSnapshotHandler,
  getDeadLetterHandler,
  replayDeadLetterHandler
} from './handlers.ts';
import { loadEnvFiles } from './config/env-loader.ts';
import { ensureQueueRuntime } from './orchestration/queue-runtime.ts';
import {
  authRequired,
  requireRequestUser,
  resolveRequestUser,
  signupWithEmailPassword,
  loginWithEmailPassword
} from './services/auth-service.ts';
import {
  assertCanPublish,
  assertCanRunJob,
  canRunJob,
  registerJobConsumption
} from './services/entitlement-service.ts';
import { sendStandardTestAlert } from './services/alert-service.ts';

loadEnvFiles();

type Json = Record<string, unknown>;

const parseOrigins = () => {
  const raw = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
};

const allowedOrigins = parseOrigins();

const applyCors = (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin;

  if (!origin) {
    res.setHeader('access-control-allow-origin', '*');
  } else if (allowedOrigins.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }

  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  res.setHeader('access-control-max-age', '86400');
};

const readJsonBody = async (req: IncomingMessage): Promise<Json> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Json) : {};
};

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
};

const statusFromMessage = (message: string) => {
  if (/^AUTH_REQUIRED|^AUTH_PROVIDER_401|^AUTH_PROVIDER_403|^AUTH_INVALID/.test(message)) return 401;
  if (/^NOT_ENTITLED|^ALERT_TEST_NOT_ALLOWED/.test(message)) return 403;
  if (/NOT_FOUND/.test(message)) return 404;
  return 400;
};

const handleError = (res: ServerResponse, error: unknown) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const statusCode = statusFromMessage(message);
  sendJson(res, statusCode, { error: message });
};

const testAlertAllowed = () => (process.env.ALERT_TEST_ALLOWED ?? 'false').trim().toLowerCase() === 'true';
const autoPublishEnabled = () => (process.env.ENABLE_AUTO_PUBLISH ?? 'false').trim().toLowerCase() === 'true';
const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

const parseVariantType = (raw: unknown): 'SHORT_15' | 'MASTER_30' => {
  if (raw === 'MASTER_30' && premium60Enabled()) return 'MASTER_30';
  return 'SHORT_15';
};

const parseMoodPreset = (raw: unknown): 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light' => {
  const value = String(raw ?? 'commercial_cta');
  if (['commercial_cta', 'problem_solution', 'testimonial', 'humor_light'].includes(value)) {
    return value as 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';
  }
  return 'commercial_cta';
};

const parseWeightedSelections = <T extends string>(raw: unknown, allowed: readonly T[]) => {
  if (!Array.isArray(raw)) return [] as Array<{ id: T; weight?: number; priority?: 1 | 2 | 3 }>;

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

      return {
        id,
        weight,
        priority
      };
    })
    .filter((entry): entry is { id: T; weight?: number; priority?: 1 | 2 | 3 } => Boolean(entry));
};

const parseCreativeIntent = (raw: unknown) => {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

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

  const energyModeRaw = String(input.energyMode ?? 'auto').trim().toLowerCase();
  const energyMode = ['auto', 'high', 'calm'].includes(energyModeRaw)
    ? (energyModeRaw as 'auto' | 'high' | 'calm')
    : 'auto';

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

const parseStoryboardLight = (raw: unknown) => {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
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
    .filter((entry): entry is {
      beatId: string;
      order: number;
      action: string;
      visualHint?: string;
      dialogueHint?: string;
      onScreenTextHint?: string;
    } => Boolean(entry));

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

const parseAudioMode = (raw: unknown): 'voiceover' | 'scene' | 'hybrid' => {
  const value = String(raw ?? 'voiceover').trim().toLowerCase();
  if (['voiceover', 'scene', 'hybrid'].includes(value)) {
    return value as 'voiceover' | 'scene' | 'hybrid';
  }
  return 'voiceover';
};

const parseBrandProfile = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;

  const companyName = String(input.companyName ?? '').trim().slice(0, 120);
  if (!companyName) return undefined;

  const normalizeHex = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (!text) return undefined;
    const withHash = text.startsWith('#') ? text : `#${text}`;
    return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : undefined;
  };

  const ctaStyleRaw = String(input.ctaStyle ?? '').trim().toLowerCase();
  const ctaStyle = ['soft', 'balanced', 'strong'].includes(ctaStyleRaw)
    ? (ctaStyleRaw as 'soft' | 'balanced' | 'strong')
    : undefined;

  return {
    companyName,
    websiteUrl: String(input.websiteUrl ?? '').trim().slice(0, 200) || undefined,
    logoUrl: String(input.logoUrl ?? '').trim().slice(0, 400) || undefined,
    brandTone: String(input.brandTone ?? '').trim().slice(0, 180) || undefined,
    primaryColorHex: normalizeHex(input.primaryColorHex),
    secondaryColorHex: normalizeHex(input.secondaryColorHex),
    ctaStyle,
    audienceHint: String(input.audienceHint ?? '').trim().slice(0, 240) || undefined,
    valueProposition: String(input.valueProposition ?? '').trim().slice(0, 280) || undefined
  };
};

const parseGenerationPayload = (raw: unknown) => {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error('GENERATION_PAYLOAD_INVALID');
  }

  const input = raw as Record<string, unknown>;
  const topic = String(input.topic ?? '').trim().slice(0, 240);
  if (!topic) throw new Error('GENERATION_PAYLOAD_TOPIC_REQUIRED');

  const brandProfile = parseBrandProfile(input.brandProfile);
  if (!brandProfile?.companyName?.trim()) {
    throw new Error('GENERATION_PAYLOAD_BRAND_PROFILE_REQUIRED');
  }

  const ciRaw = input.creativeIntent;
  if (!ciRaw || typeof ciRaw !== 'object') {
    throw new Error('GENERATION_PAYLOAD_CREATIVE_INTENT_REQUIRED');
  }

  const ci = ciRaw as Record<string, unknown>;
  const effectGoals = parseWeightedSelections(ci.effectGoals, ['sell_conversion', 'funny', 'testimonial_trust', 'urgency_offer'] as const);
  const narrativeFormats = parseWeightedSelections(ci.narrativeFormats, ['before_after', 'dialog', 'offer_focus', 'commercial', 'problem_solution'] as const);
  const shotStyles = parseWeightedSelections(ci.shotStyles, ['cinematic_closeup', 'over_shoulder', 'handheld_push', 'product_macro', 'wide_establishing', 'fast_cut_montage'] as const);
  const energyModeRaw = String(ci.energyMode ?? 'auto').trim().toLowerCase();
  const energyMode = ['auto', 'high', 'calm'].includes(energyModeRaw) ? (energyModeRaw as 'auto' | 'high' | 'calm') : 'auto';

  if (!effectGoals.length || !narrativeFormats.length) {
    throw new Error('GENERATION_PAYLOAD_CREATIVE_INTENT_INCOMPLETE');
  }

  const startFrameRaw = input.startFrame;
  const startFrame = startFrameRaw && typeof startFrameRaw === 'object'
    ? (() => {
        const sf = startFrameRaw as Record<string, unknown>;
        const styleRaw = String(sf.style ?? '').trim();
        const style = styleRaw && ['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'].includes(styleRaw)
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
      effectGoals,
      narrativeFormats,
      shotStyles,
      energyMode
    },
    startFrame,
    userEditedFlowScript: String(input.userEditedFlowScript ?? '').trim().slice(0, 4000) || undefined
  };
};

const parseScriptV2 = (raw: unknown) => {
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
    .filter((scene): scene is { order: number; action: string; lines?: Array<{ speaker: string; text: string; tone?: string; startHintSeconds?: number; endHintSeconds?: number }>; onScreenText?: string } => Boolean(scene));

  if (!scenes.length) return undefined;

  return {
    language: String(input.language ?? '').trim().slice(0, 20) || undefined,
    openingHook: String(input.openingHook ?? '').trim().slice(0, 180) || undefined,
    narration: String(input.narration ?? '').trim().slice(0, 2000) || undefined,
    scenes
  };
};

const parseUserControls = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;

  const parseEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
  };

  return {
    ctaStrength: parseEnum(input.ctaStrength, ['soft', 'balanced', 'strong'] as const, 'balanced'),
    motionIntensity: parseEnum(input.motionIntensity, ['low', 'medium', 'high'] as const, 'medium'),
    shotPace: parseEnum(input.shotPace, ['relaxed', 'balanced', 'fast'] as const, 'balanced'),
    visualStyle: parseEnum(input.visualStyle, ['clean', 'cinematic', 'ugc'] as const, 'clean')
  };
};

const ensureRunPermissionIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  const user = await requireRequestUser(req);
  await assertCanRunJob(user);
  return user;
};

const ensurePublishPermissionIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  const user = await requireRequestUser(req);
  await assertCanPublish(user);
  return user;
};

const ensureAuthIfRequired = async (req: IncomingMessage) => {
  if (!authRequired()) return null;
  return requireRequestUser(req);
};

export const buildApiServer = () =>
  createServer(async (req, res) => {
    applyCors(req, res);

    if ((req.method ?? 'GET') === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'faceless-api', authRequired: authRequired() });
      }

      if (method === 'POST' && path === '/v1/auth/signup') {
        const body = await readJsonBody(req);
        const email = String(body.email ?? '').trim();
        const password = String(body.password ?? '');
        if (!email || password.length < 8) {
          throw new Error('AUTH_INPUT_INVALID:email/password');
        }

        const session = await signupWithEmailPassword(email, password);
        const entitlement = await canRunJob(session.user);

        return sendJson(res, 200, {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          requiresEmailConfirmation: session.requiresEmailConfirmation,
          user: {
            id: session.user.id,
            email: session.user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted
          },
          canRunJob: entitlement.allow,
          reason: entitlement.reason
        });
      }

      if (method === 'POST' && path === '/v1/auth/login') {
        const body = await readJsonBody(req);
        const email = String(body.email ?? '').trim();
        const password = String(body.password ?? '');
        if (!email || !password) {
          throw new Error('AUTH_INPUT_INVALID:email/password');
        }

        const session = await loginWithEmailPassword(email, password);
        const entitlement = await canRunJob(session.user);

        return sendJson(res, 200, {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          requiresEmailConfirmation: session.requiresEmailConfirmation,
          user: {
            id: session.user.id,
            email: session.user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted
          },
          canRunJob: entitlement.allow,
          reason: entitlement.reason
        });
      }

      if (method === 'GET' && path === '/v1/auth/me') {
        const user = await resolveRequestUser(req);
        if (!user) {
          if (authRequired()) throw new Error('AUTH_REQUIRED');
          return sendJson(res, 200, {
            authenticated: false,
            authRequired: false,
            canRunJob: true,
            reason: 'AUTH_OPTIONAL_MODE'
          });
        }

        const entitlement = await canRunJob(user);
        return sendJson(res, 200, {
          authenticated: true,
          authRequired: authRequired(),
          canRunJob: entitlement.allow,
          reason: entitlement.reason,
          user: {
            id: user.id,
            email: user.email,
            plan: entitlement.record.plan,
            subscriptionStatus: entitlement.record.subscriptionStatus,
            allowlisted: entitlement.record.allowlisted,
            creditsRemaining: entitlement.record.creditsRemaining,
            monthlyJobLimit: entitlement.record.monthlyJobLimit,
            jobsUsed: entitlement.record.jobsUsed
          }
        });
      }

      if (method === 'GET' && /^\/v1\/brands\/[^/]+$/.test(path)) {
        await ensureRunPermissionIfRequired(req);
        const organizationId = decodeURIComponent(path.split('/')[3] ?? '').trim();
        if (!organizationId) throw new Error('ORGANIZATION_ID_REQUIRED');
        const profile = getBrandProfileHandler(organizationId);
        return sendJson(res, 200, profile);
      }

      if (method === 'PUT' && /^\/v1\/brands\/[^/]+$/.test(path)) {
        await ensureRunPermissionIfRequired(req);
        const organizationId = decodeURIComponent(path.split('/')[3] ?? '').trim();
        if (!organizationId) throw new Error('ORGANIZATION_ID_REQUIRED');

        const body = await readJsonBody(req);
        const profile = parseBrandProfile(body);
        if (!profile) throw new Error('BRAND_PROFILE_INVALID');

        const saved = upsertBrandProfileHandler(organizationId, profile);
        return sendJson(res, 200, saved);
      }

      if (method === 'POST' && path === '/v1/projects') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const created = createProjectHandler({
          organizationId: String(body.organizationId ?? ''),
          topic: String(body.topic ?? ''),
          language: String(body.language ?? 'de'),
          voice: String(body.voice ?? 'de_female_01'),
          variantType: parseVariantType(body.variantType)
        });
        return sendJson(res, 201, created);
      }

      if (method === 'POST' && path === '/v1/script/draft') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const draft = await createScriptDraftHandler({
          topic: String(body.topic ?? ''),
          variantType: parseVariantType(body.variantType),
          organizationId: String(body.organizationId ?? '').trim() || undefined,
          moodPreset: parseMoodPreset(body.moodPreset),
          creativeIntent: parseCreativeIntent(body.creativeIntent),
          brandProfile: parseBrandProfile(body.brandProfile)
        });
        return sendJson(res, 200, draft);
      }

      if (method === 'POST' && path === '/v1/startframes/upload') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const uploaded = await uploadStartFrameHandler({
          organizationId: String(body.organizationId ?? '').trim(),
          fileName: String(body.fileName ?? '').trim(),
          mimeType: String(body.mimeType ?? 'image/jpeg').trim() as 'image/png' | 'image/jpeg' | 'image/webp',
          imageBase64: String(body.imageBase64 ?? '').trim()
        });

        return sendJson(res, 200, uploaded);
      }

      if (method === 'POST' && path === '/v1/startframes/preflight') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const preflight = createStartFramePreflightHandler({
          topic: String(body.topic ?? ''),
          conceptId: String(body.conceptId ?? '').trim() || undefined,
          startFrameCandidateId: String(body.startFrameCandidateId ?? '').trim() || undefined,
          startFrameStyle: String(body.startFrameStyle ?? '').trim()
            ? (String(body.startFrameStyle) as
                | 'storefront_hero'
                | 'product_macro'
                | 'owner_portrait'
                | 'hands_at_work'
                | 'before_after_split')
            : undefined,
          startFrameCustomPrompt: String(body.startFrameCustomPrompt ?? '').trim() || undefined,
          startFrameReferenceHint: String(body.startFrameReferenceHint ?? '').trim() || undefined,
          startFrameUploadObjectPath: String(body.startFrameUploadObjectPath ?? '').trim() || undefined
        });

        return sendJson(res, 200, preflight);
      }

      if (method === 'POST' && path === '/v1/startframes/candidates') {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const candidates = await createStartFrameCandidatesHandler({
          topic: String(body.topic ?? ''),
          conceptId: String(body.conceptId ?? '').trim() || undefined,
          moodPreset: parseMoodPreset(body.moodPreset),
          creativeIntent: parseCreativeIntent(body.creativeIntent),
          limit: Number(body.limit ?? 3)
        });
        return sendJson(res, 200, candidates);
      }

      if (method === 'POST' && /^\/v1\/projects\/[^/]+\/select$/.test(path)) {
        const user = await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const projectId = path.split('/')[3];
        const generationPayload = parseGenerationPayload(body.generationPayload);

        const selected = selectConceptHandler({
          projectId,
          conceptId: String(body.conceptId ?? 'concept_web_vertical_slice'),
          moodPreset: parseMoodPreset(body.moodPreset),
          creativeIntent: parseCreativeIntent(body.creativeIntent),
          storyboardLight: parseStoryboardLight(body.storyboardLight),
          brandProfile: parseBrandProfile(body.brandProfile),
          generationPayload,
          approvedScript: String(body.approvedScript ?? ''),
          approvedScriptV2: parseScriptV2(body.approvedScriptV2),
          startFrameCandidateId: String(body.startFrameCandidateId ?? '').trim() || generationPayload?.startFrame?.candidateId,
          startFrameStyle: String(body.startFrameStyle ?? '').trim()
            ? (String(body.startFrameStyle) as
                | 'storefront_hero'
                | 'product_macro'
                | 'owner_portrait'
                | 'hands_at_work'
                | 'before_after_split')
            : generationPayload?.startFrame?.style,
          startFrameCustomLabel: String(body.startFrameCustomLabel ?? '').trim() || undefined,
          startFrameCustomPrompt: String(body.startFrameCustomPrompt ?? '').trim() || generationPayload?.startFrame?.customPrompt,
          startFrameReferenceHint: String(body.startFrameReferenceHint ?? '').trim() || generationPayload?.startFrame?.referenceHint,
          startFrameUploadObjectPath:
            String(body.startFrameUploadObjectPath ?? '').trim() || generationPayload?.startFrame?.uploadObjectPath,
          audioMode: parseAudioMode(body.audioMode),
          userControls: parseUserControls(body.userControls),
          variantType: parseVariantType(body.variantType)
        });

        if (user) {
          await registerJobConsumption(user);
        }

        return sendJson(res, 200, selected);
      }

      if (method === 'POST' && /^\/v1\/projects\/[^/]+\/generate$/.test(path)) {
        await ensureRunPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const jobId = String(body.jobId ?? '');
        const done = await generateHandler(jobId, { forceFail: Boolean(body.forceFail) });
        return sendJson(res, 200, done);
      }

      if (method === 'POST' && /^\/v1\/jobs\/[^/]+\/publish$/.test(path)) {
        if (!autoPublishEnabled()) {
          throw new Error('NOT_ENTITLED:FEATURE_DISABLED_MVP');
        }

        await ensurePublishPermissionIfRequired(req);

        const body = await readJsonBody(req);
        const jobId = path.split('/')[3];
        const parsedTargets = Array.isArray(body.targets) ? body.targets : ['tiktok', 'instagram'];
        const targets = parsedTargets
          .map((x) => String(x))
          .filter((x): x is 'tiktok' | 'instagram' | 'youtube' => ['tiktok', 'instagram', 'youtube'].includes(x));
        const published = await publishJobHandler(jobId, targets.length ? targets : ['tiktok', 'instagram']);
        return sendJson(res, 200, published);
      }

      if (method === 'GET' && /^\/v1\/jobs\/[^/]+$/.test(path)) {
        await ensureAuthIfRequired(req);
        const jobId = path.split('/')[3];
        const current = getJobHandler(jobId);
        return sendJson(res, 200, current);
      }

      if (method === 'GET' && /^\/v1\/jobs\/[^/]+\/assets$/.test(path)) {
        await ensureAuthIfRequired(req);
        const jobId = path.split('/')[3];
        const assets = getJobAssetsHandler(jobId);
        return sendJson(res, 200, assets);
      }

      if (method === 'GET' && /^\/v1\/ledger\/[^/]+$/.test(path)) {
        await ensureAuthIfRequired(req);
        const organizationId = path.split('/')[3];
        const ledger = getLedgerHandler(organizationId);
        return sendJson(res, 200, ledger);
      }

      if (method === 'GET' && path === '/v1/admin/snapshot') {
        await ensureAuthIfRequired(req);
        const admin = getAdminSnapshotHandler();
        return sendJson(res, 200, admin);
      }

      if (method === 'POST' && path === '/v1/admin/alerts/test') {
        await ensureAuthIfRequired(req);
        if (!testAlertAllowed()) throw new Error('ALERT_TEST_NOT_ALLOWED');

        const sent = await sendStandardTestAlert();
        return sendJson(res, 200, { ok: true, ...sent });
      }

      if (method === 'GET' && path === '/v1/dlq') {
        await ensureAuthIfRequired(req);
        const dlq = await getDeadLetterHandler();
        return sendJson(res, 200, dlq);
      }

      if (method === 'POST' && /^\/v1\/dlq\/[^/]+\/replay$/.test(path)) {
        await ensureAuthIfRequired(req);
        const deadLetterId = decodeURIComponent(path.split('/')[3]);
        const replayed = await replayDeadLetterHandler(deadLetterId);
        return sendJson(res, 200, replayed);
      }

      return sendJson(res, 404, { error: 'NOT_FOUND', method, path });
    } catch (error) {
      return handleError(res, error);
    }
  });

export const startApiServer = async (port = 3001) => {
  await ensureQueueRuntime();
  const server = buildApiServer();

  return new Promise<{ server: ReturnType<typeof buildApiServer>; port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, port: resolvedPort });
    });
  });
};
