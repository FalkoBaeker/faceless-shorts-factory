import type {
  CreateProjectRequest,
  CreateProjectResponse,
  SelectConceptRequest,
  SelectConceptResponse,
  ScriptDraftRequest,
  ScriptDraftResponse,
  StartFrameUploadRequest,
  StartFrameUploadResponse,
  StartFrameCandidatesRequest,
  StartFrameCandidatesResponse,
  JobStatusResponse,
  LedgerResponse,
  PublishResponse,
  AdminSnapshotResponse
} from './contracts.ts';
import { createProject, getProject, setProjectStatus } from './project-store.ts';
import { startJob } from './services/job-service.ts';
import { getJob, appendTimelineEvent } from './job-store.ts';
import { reserveCredit, listLedger, listLedgerForJob, getLedgerBalance } from './services/billing-service.ts';
import { getPublishPosts } from './services/publish-service.ts';
import { getAdminSnapshot } from './services/admin-service.ts';
import {
  enqueueGeneration,
  enqueuePublish,
  listDeadLetters,
  replayDeadLetter,
  ensureQueueRuntime
} from './orchestration/queue-runtime.ts';
import {
  generateScriptDraft,
  uploadStartFrameReference,
  generateStartFrameThumbnail
} from './providers/live-provider-runtime.ts';
import { buildStartFrameCandidates, resolveSelectedStartFrame } from './services/startframe-candidates.ts';
import {
  normalizeUserControlProfile,
  normalizeCreativeIntent,
  deriveLegacyMoodPresetFromIntent,
  normalizeStoryboardLight,
  validateCreativeConsistency,
  type ShotStyleTag
} from './services/creative-consistency.ts';

const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

const normalizeVariantType = (variantType: 'SHORT_15' | 'MASTER_30'): 'SHORT_15' | 'MASTER_30' => {
  if (variantType === 'MASTER_30' && premium60Enabled()) {
    return 'MASTER_30';
  }
  return 'SHORT_15';
};

const estimatedSecondsForVariant = (variantType: 'SHORT_15' | 'MASTER_30') =>
  variantType === 'MASTER_30' && premium60Enabled() ? 60 : 30;

const buildBillingLifecycle = (jobId: string, organizationId?: string) => {
  const entries = listLedgerForJob(jobId, organizationId);
  const reserved = entries.find((entry) => entry.type === 'RESERVED') ?? null;
  const finalized = [...entries]
    .reverse()
    .find((entry) => entry.type === 'COMMITTED' || entry.type === 'RELEASED') ?? null;

  return {
    reservation: {
      reserved: Boolean(reserved),
      at: reserved?.createdAt ?? null
    },
    finalization: {
      state: finalized?.type ?? 'PENDING',
      at: finalized?.createdAt ?? null,
      note: finalized?.note ?? null
    },
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      jobId: entry.jobId,
      createdAt: entry.createdAt,
      note: entry.note
    }))
  };
};

const parseTimelineDetail = (detail: string | undefined) => {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const buildExplainability = (timeline: Array<{ at: string; event: string; detail?: string }>) => {
  const compilerEvent = [...timeline].reverse().find((event) => event.event === 'PROMPT_COMPILER_V2_APPLIED');
  const compilerDetail = parseTimelineDetail(compilerEvent?.detail);

  const intentRules = Array.isArray(compilerDetail?.intentRules)
    ? compilerDetail.intentRules.map((value) => String(value))
    : [];
  const shotStyleSet = Array.isArray(compilerDetail?.shotStyleSet)
    ? compilerDetail.shotStyleSet.map((value) => String(value) as ShotStyleTag)
    : [];
  const safetyConstraints = Array.isArray(compilerDetail?.safetyConstraints)
    ? compilerDetail.safetyConstraints.map((value) => String(value))
    : [];

  const hookRule =
    typeof compilerDetail?.hookRule === 'string'
      ? compilerDetail.hookRule
      : timeline.some((event) => event.event === 'HOOK_ENHANCER_APPLIED')
        ? 'hook_enhancer_default'
        : null;

  const calmExceptionApplied =
    Boolean(compilerDetail?.calmExceptionApplied) || timeline.some((event) => event.event === 'CALM_MODE_EXCEPTION_APPLIED');

  if (!intentRules.length && !hookRule && !shotStyleSet.length && !safetyConstraints.length && !calmExceptionApplied) {
    return undefined;
  }

  return {
    intentRules,
    hookRule,
    shotStyleSet,
    safetyConstraints,
    calmExceptionApplied
  };
};

export const createProjectHandler = (payload: CreateProjectRequest): CreateProjectResponse => {
  const project = createProject({
    organizationId: payload.organizationId,
    topic: payload.topic,
    language: payload.language,
    voice: payload.voice,
    variantType: normalizeVariantType(payload.variantType)
  });

  return {
    projectId: project.id,
    status: project.status,
    createdAt: project.createdAt
  };
};

export const uploadStartFrameHandler = async (payload: StartFrameUploadRequest): Promise<StartFrameUploadResponse> => {
  const organizationId = String(payload.organizationId ?? '').trim();
  if (!organizationId) throw new Error('ORGANIZATION_ID_REQUIRED');

  const fileName = String(payload.fileName ?? '').trim() || 'startframe-upload.jpg';
  const mimeType = String(payload.mimeType ?? '').trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw new Error('STARTFRAME_UPLOAD_MIMETYPE_INVALID');
  }

  const base64Raw = String(payload.imageBase64 ?? '').trim().replace(/^data:[^;]+;base64,/, '');
  if (!base64Raw) throw new Error('STARTFRAME_UPLOAD_EMPTY');

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Raw, 'base64');
  } catch {
    throw new Error('STARTFRAME_UPLOAD_BASE64_INVALID');
  }

  if (!bytes.length) throw new Error('STARTFRAME_UPLOAD_EMPTY');

  return uploadStartFrameReference({
    organizationId,
    fileName,
    bytes,
    mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp'
  });
};

export const selectConceptHandler = (payload: SelectConceptRequest): SelectConceptResponse => {
  const project = getProject(payload.projectId);
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${payload.projectId}`);
  }

  const variantType = normalizeVariantType(payload.variantType);
  const fallbackMoodPreset = payload.moodPreset ?? 'commercial_cta';
  const creativeIntent = normalizeCreativeIntent(payload.creativeIntent, fallbackMoodPreset, payload.conceptId);
  const moodPreset = deriveLegacyMoodPresetFromIntent(payload.creativeIntent, fallbackMoodPreset, payload.conceptId);
  const storyboardLight = normalizeStoryboardLight(payload.storyboardLight);

  const approvedScript = String(payload.approvedScript ?? '').trim();
  if (!approvedScript) {
    throw new Error('SCRIPT_ACCEPTANCE_REQUIRED');
  }

  const customPrompt = String(payload.startFrameCustomPrompt ?? '').trim();
  const customLabel = String(payload.startFrameCustomLabel ?? '').trim() || 'Eigenes Referenzbild';
  const customReferenceHint = String(payload.startFrameReferenceHint ?? '').trim();
  const uploadObjectPath = String(payload.startFrameUploadObjectPath ?? '').trim();
  const hasUploadedReference = uploadObjectPath.length > 0;

  const selectedStartFrame =
    customPrompt.length > 0 || hasUploadedReference
      ? {
          candidateId: `sfc_custom_${Date.now()}`,
          style: payload.startFrameStyle ?? 'owner_portrait',
          label: customLabel,
          description: 'Nutzerdefinierter Startframe aus Upload-Referenz',
          prompt:
            customPrompt ||
            'Nutze das hochgeladene Referenzbild als visuelle Leitplanke für Shot 1 und den gesamten Look des Videos.',
          thumbnailUrl: ''
        }
      : resolveSelectedStartFrame({
          topic: project.topic,
          conceptId: payload.conceptId,
          moodPreset,
          creativeIntent,
          startFrameCandidateId: payload.startFrameCandidateId,
          startFrameStyle: payload.startFrameStyle
        });

  if (!selectedStartFrame) {
    throw new Error('STARTFRAME_SELECTION_REQUIRED');
  }

  const legacyUserControlsProvided = Boolean(payload.userControls);
  const userControls = normalizeUserControlProfile(payload.userControls);
  const consistency = validateCreativeConsistency({
    script: approvedScript,
    conceptId: payload.conceptId,
    moodPreset,
    startFrameStyle: selectedStartFrame.style,
    userControls: legacyUserControlsProvided ? userControls : undefined,
    creativeIntent: payload.creativeIntent ? creativeIntent : undefined,
    storyboardLight
  });

  if (!consistency.ok) {
    throw new Error(`CREATIVE_CONSISTENCY_FAILED:${consistency.reasons.join('|')}`);
  }

  setProjectStatus(payload.projectId, 'SELECTED');

  const job = startJob({
    projectId: payload.projectId,
    variantType
  });

  reserveCredit(project.organizationId, job.id);

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'BILLING_CREDIT_RESERVED',
    detail: 'amount=-1 type=RESERVED'
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'STORYBOARD_SELECTED',
    detail: JSON.stringify({
      conceptId: payload.conceptId,
      moodPreset,
      approvedScript,
      startFrameCandidateId: selectedStartFrame.candidateId,
      startFrameStyle: selectedStartFrame.style,
      startFrameLabel: selectedStartFrame.label,
      startFramePrompt: selectedStartFrame.prompt,
      startFrameMode: hasUploadedReference ? 'uploaded_asset' : customPrompt.length > 0 ? 'uploaded_reference' : 'generated_candidate',
      startFrameReferenceHint: customReferenceHint || undefined,
      startFrameReferenceObjectPath: hasUploadedReference ? uploadObjectPath : undefined,
      creativeIntent,
      storyboardLight,
      userControls: legacyUserControlsProvided ? userControls : undefined
    })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'CREATIVE_INTENT_SELECTED',
    detail: JSON.stringify(creativeIntent)
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'CREATIVE_INTENT_NORMALIZED',
    detail: JSON.stringify({
      fallbackMoodPreset,
      effectiveMoodPreset: moodPreset,
      effectGoals: creativeIntent.effectGoals.length,
      narrativeFormats: creativeIntent.narrativeFormats.length,
      shotStyles: creativeIntent.shotStyles?.length ?? 0,
      energyMode: creativeIntent.energyMode ?? 'auto'
    })
  });

  if (storyboardLight) {
    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'STORYBOARD_LIGHT_APPLIED',
      detail: JSON.stringify({
        beats: storyboardLight.beats,
        hookHint: storyboardLight.hookHint,
        ctaHint: storyboardLight.ctaHint,
        pacingHint: storyboardLight.pacingHint
      })
    });
  }

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'CONSISTENCY_CHECK_PASSED',
    detail: JSON.stringify({
      score: consistency.score,
      checks: consistency.checks
    })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'CONSISTENCY_V2_PASSED',
    detail: JSON.stringify({
      score: consistency.score,
      checks: consistency.checks
    })
  });

  const hookCheck = consistency.checks.find((check) => check.id === 'HOOK_FIRST_SECOND_QUALITY');
  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'HOOK_QUALITY_GATE_PASSED',
    detail: JSON.stringify({ ok: hookCheck?.ok ?? true, detail: hookCheck?.detail ?? 'n/a' })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'INTENT_ALIGNMENT_SCORE',
    detail: JSON.stringify({
      score: consistency.score,
      alignmentCheck:
        consistency.checks.find((check) => check.id === 'INTENT_SCRIPT_ALIGNMENT_SCORE_MIN')?.detail ?? 'n/a'
    })
  });

  if (legacyUserControlsProvided) {
    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'LEGACY_USER_CONTROLS_DEPRECATED',
      detail: JSON.stringify({ provided: true })
    });

    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'LEGACY_USER_CONTROLS_MAPPED_TO_INTENT',
      detail: JSON.stringify(userControls)
    });

    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'USER_CONTROLS_APPLIED',
      detail: JSON.stringify(userControls)
    });
  }

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'SELECTED_STARTFRAME',
    detail: JSON.stringify({
      candidateId: selectedStartFrame.candidateId,
      style: selectedStartFrame.style,
      label: selectedStartFrame.label,
      referenceObjectPath: hasUploadedReference ? uploadObjectPath : undefined
    })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'SCRIPT_ACCEPTED',
    detail: approvedScript
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'SELECTED_MOOD',
    detail: moodPreset
  });

  const estimatedSeconds = estimatedSecondsForVariant(variantType);

  return {
    jobId: job.id,
    creditReservationStatus: 'RESERVED',
    estimatedSeconds
  };
};

export const createScriptDraftHandler = async (payload: ScriptDraftRequest): Promise<ScriptDraftResponse> => {
  const topic = String(payload.topic ?? '').trim();
  if (!topic) throw new Error('TOPIC_REQUIRED');

  const variantType = normalizeVariantType(payload.variantType);
  const fallbackMoodPreset = payload.moodPreset ?? 'commercial_cta';
  const moodPreset = deriveLegacyMoodPresetFromIntent(payload.creativeIntent, fallbackMoodPreset, 'concept_web_vertical_slice');
  const creativeIntent = normalizeCreativeIntent(payload.creativeIntent, fallbackMoodPreset, 'concept_web_vertical_slice');

  const draft = await generateScriptDraft({
    topic,
    variantType,
    moodPreset,
    creativeIntent
  });

  return {
    script: draft.script,
    targetSeconds: draft.targetSeconds,
    estimatedSeconds: draft.estimatedSeconds,
    withinTarget: draft.withinTarget,
    suggestedWords: draft.suggestedWords
  };
};

export const createStartFrameCandidatesHandler = async (
  payload: StartFrameCandidatesRequest
): Promise<StartFrameCandidatesResponse> => {
  const topic = String(payload.topic ?? '').trim();
  if (!topic) throw new Error('TOPIC_REQUIRED');

  const fallbackMoodPreset = payload.moodPreset ?? 'commercial_cta';
  const moodPreset = deriveLegacyMoodPresetFromIntent(payload.creativeIntent, fallbackMoodPreset, payload.conceptId ?? 'concept_web_vertical_slice');
  const creativeIntent = normalizeCreativeIntent(payload.creativeIntent, fallbackMoodPreset, payload.conceptId ?? 'concept_web_vertical_slice');

  const baseCandidates = buildStartFrameCandidates({
    topic,
    conceptId: payload.conceptId,
    moodPreset,
    creativeIntent,
    limit: payload.limit
  });

  const candidates = await Promise.all(
    baseCandidates.map(async (candidate) => {
      const generated = await generateStartFrameThumbnail({
        candidateId: candidate.candidateId,
        topic,
        style: candidate.style,
        label: candidate.label,
        description: candidate.description,
        moodPreset
      });

      if (!generated?.signedUrl) return candidate;
      return {
        ...candidate,
        thumbnailUrl: generated.signedUrl
      };
    })
  );

  return { candidates };
};

export const generateHandler = async (jobId: string, options?: { forceFail?: boolean }): Promise<JobStatusResponse> => {
  const existing = getJob(jobId);
  if (!existing) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  if (existing.status === 'READY' || existing.status === 'FAILED') {
    const project = getProject(existing.projectId);

    return {
      jobId: existing.id,
      status: existing.status as JobStatusResponse['status'],
      timeline: existing.timeline,
      billing: buildBillingLifecycle(existing.id, project?.organizationId),
      explainability: buildExplainability(existing.timeline)
    };
  }

  const accepted = existing.timeline.some((event) => event.event === 'SCRIPT_ACCEPTED' && Boolean(event.detail?.trim()));
  if (!accepted) {
    throw new Error('SCRIPT_ACCEPTANCE_REQUIRED');
  }

  const consistencyChecked = existing.timeline.some(
    (event) => event.event === 'CONSISTENCY_CHECK_PASSED' || event.event === 'CONSISTENCY_V2_PASSED'
  );
  if (!consistencyChecked) {
    throw new Error('CREATIVE_CONSISTENCY_REQUIRED');
  }

  await ensureQueueRuntime();
  await enqueueGeneration(jobId, { forceFail: Boolean(options?.forceFail), failMode: options?.forceFail ? 'hard' : undefined });

  const updated = getJob(jobId);
  if (!updated) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  const project = getProject(updated.projectId);

  return {
    jobId: updated.id,
    status: updated.status as JobStatusResponse['status'],
    timeline: updated.timeline,
    billing: buildBillingLifecycle(updated.id, project?.organizationId),
    explainability: buildExplainability(updated.timeline)
  };
};

export const publishJobHandler = async (
  jobId: string,
  targets: Array<'tiktok' | 'instagram' | 'youtube'>
): Promise<PublishResponse> => {
  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);
  if (!['READY', 'PUBLISHED', 'PUBLISH_PENDING'].includes(job.status)) {
    throw new Error(`JOB_NOT_PUBLISHABLE:${job.status}`);
  }

  await ensureQueueRuntime();
  await enqueuePublish(jobId, targets);

  const current = getJob(jobId);
  const posts = getPublishPosts(jobId);

  return {
    jobId,
    status: (current?.status === 'PUBLISHED' ? 'PUBLISHED' : 'PUBLISH_PENDING') as PublishResponse['status'],
    targets,
    posts
  };
};

export const getJobHandler = (jobId: string): JobStatusResponse => {
  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  const project = getProject(job.projectId);

  return {
    jobId: job.id,
    status: job.status as JobStatusResponse['status'],
    timeline: job.timeline,
    billing: buildBillingLifecycle(job.id, project?.organizationId),
    explainability: buildExplainability(job.timeline)
  };
};

const parseAssetDetail = (detail?: string) => {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as {
      kind?: string;
      objectPath?: string;
      signedUrl?: string;
      bytes?: number;
      mimeType?: string;
      provider?: string;
    };
  } catch {
    return null;
  }
};

export const getJobAssetsHandler = (jobId: string) => {
  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  const assets = job.timeline
    .filter((event) => event.event.startsWith('ASSET_'))
    .map((event) => ({
      event: event.event,
      detail: parseAssetDetail(event.detail)
    }))
    .filter((entry) => entry.detail?.objectPath && entry.detail?.signedUrl)
    .map((entry) => ({
      event: entry.event,
      kind: entry.detail?.kind ?? 'unknown',
      objectPath: String(entry.detail?.objectPath),
      signedUrl: String(entry.detail?.signedUrl),
      bytes: typeof entry.detail?.bytes === 'number' ? entry.detail.bytes : null,
      mimeType: entry.detail?.mimeType ?? null,
      provider: entry.detail?.provider ?? null
    }));

  return {
    jobId,
    ready: job.status === 'READY' || job.status === 'PUBLISHED',
    assets
  };
};

export const getLedgerHandler = (organizationId: string): LedgerResponse => {
  const entries = listLedger(organizationId);
  return {
    organizationId,
    balance: getLedgerBalance(organizationId),
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      jobId: e.jobId,
      createdAt: e.createdAt,
      note: e.note
    }))
  };
};

export const getAdminSnapshotHandler = (): AdminSnapshotResponse => {
  return getAdminSnapshot();
};

export const getDeadLetterHandler = async () => {
  const entries = await listDeadLetters(50);
  return { total: entries.length, entries };
};

export const replayDeadLetterHandler = async (deadLetterId: string) => {
  const result = await replayDeadLetter(deadLetterId);
  return result;
};
