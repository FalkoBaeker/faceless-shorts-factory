import type {
  CreateProjectRequest,
  CreateProjectResponse,
  SelectConceptRequest,
  SelectConceptResponse,
  ScriptV2,
  ScriptDraftRequest,
  ScriptDraftResponse,
  StartFrameUploadRequest,
  StartFrameUploadResponse,
  StartFrameCandidatesRequest,
  StartFrameCandidatesResponse,
  StartFramePreflightRequest,
  StartFramePreflightResponse,
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
import { getBrandProfile, upsertBrandProfile } from './brand-profile-store.ts';
import {
  evaluateStartframePolicyPreflight,
  startFrameLabelByStyle,
  startFramePromptByStyle
} from './services/startframe-policy.ts';

const premium60Enabled = () => (process.env.ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

const normalizeVariantType = (variantType: 'SHORT_15' | 'MASTER_30'): 'SHORT_15' | 'MASTER_30' => {
  if (variantType === 'MASTER_30' && premium60Enabled()) {
    return 'MASTER_30';
  }
  return 'SHORT_15';
};

const estimatedSecondsForVariant = (variantType: 'SHORT_15' | 'MASTER_30') =>
  variantType === 'MASTER_30' && premium60Enabled() ? 60 : 30;

const normalizeScriptV2 = (input: ScriptV2 | undefined): ScriptV2 | undefined => {
  if (!input || !Array.isArray(input.scenes)) return undefined;

  const scenes = input.scenes
    .slice(0, 8)
    .map((scene, index) => {
      const action = String(scene?.action ?? '').trim().slice(0, 240);
      if (!action) return null;

      const lines = Array.isArray(scene?.lines)
        ? scene.lines
            .slice(0, 12)
            .map((line) => {
              const speaker = String(line?.speaker ?? '').trim().slice(0, 40);
              const text = String(line?.text ?? '').trim().slice(0, 180);
              if (!speaker || !text) return null;

              return {
                speaker,
                text,
                tone: String(line?.tone ?? '').trim().slice(0, 40) || undefined,
                startHintSeconds:
                  Number.isFinite(line?.startHintSeconds) && Number(line.startHintSeconds) >= 0
                    ? Number(line.startHintSeconds)
                    : undefined,
                endHintSeconds:
                  Number.isFinite(line?.endHintSeconds) && Number(line.endHintSeconds) >= 0
                    ? Number(line.endHintSeconds)
                    : undefined
              };
            })
            .filter(
              (line): line is {
                speaker: string;
                text: string;
                tone?: string;
                startHintSeconds?: number;
                endHintSeconds?: number;
              } => Boolean(line)
            )
        : undefined;

      return {
        order: Number.isFinite(scene?.order) ? Math.max(1, Math.floor(Number(scene.order))) : index + 1,
        action,
        lines: lines?.length ? lines : undefined,
        onScreenText: String(scene?.onScreenText ?? '').trim().slice(0, 120) || undefined
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

const buildScriptFromV2 = (input: ScriptV2 | undefined): string => {
  const normalized = normalizeScriptV2(input);
  if (!normalized) return '';

  const segments: string[] = [];
  if (normalized.openingHook) segments.push(normalized.openingHook);
  if (normalized.narration) segments.push(normalized.narration);

  for (const scene of normalized.scenes) {
    segments.push(scene.action);
    for (const line of scene.lines ?? []) {
      segments.push(`${line.speaker}: ${line.text}`);
    }
    if (scene.onScreenText) segments.push(scene.onScreenText);
  }

  const text = segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  return /[.!?…]$/.test(text) ? text : `${text}.`;
};

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

const mapBrandProfileForApi = (
  profile: ReturnType<typeof getBrandProfile>
): {
  companyName: string;
  websiteUrl?: string;
  logoUrl?: string;
  brandTone?: string;
  primaryColorHex?: string;
  secondaryColorHex?: string;
  ctaStyle?: 'soft' | 'balanced' | 'strong';
  audienceHint?: string;
  valueProposition?: string;
} | null => {
  if (!profile) return null;
  return {
    companyName: profile.companyName,
    websiteUrl: profile.websiteUrl,
    logoUrl: profile.logoUrl,
    brandTone: profile.brandTone,
    primaryColorHex: profile.primaryColorHex,
    secondaryColorHex: profile.secondaryColorHex,
    ctaStyle: profile.ctaStyle,
    audienceHint: profile.audienceHint,
    valueProposition: profile.valueProposition
  };
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

  const hookTemplateId = typeof compilerDetail?.hookTemplateId === 'string' ? compilerDetail.hookTemplateId : null;
  const firstSecondQualityThreshold =
    compilerDetail?.firstSecondQualityThreshold === 'strict' || compilerDetail?.firstSecondQualityThreshold === 'relaxed'
      ? compilerDetail.firstSecondQualityThreshold
      : null;

  const imageDiagnosticsEvent = [...timeline].reverse().find((event) => event.event === 'IMAGE_MODEL_DIAGNOSTICS');
  const imageDiagnosticsDetail = parseTimelineDetail(imageDiagnosticsEvent?.detail);
  const imageModelDiagnostics = imageDiagnosticsDetail
    ? {
        configuredPrimaryModel:
          typeof imageDiagnosticsDetail.configuredPrimaryModel === 'string'
            ? imageDiagnosticsDetail.configuredPrimaryModel
            : null,
        configuredFallbackModel:
          typeof imageDiagnosticsDetail.configuredFallbackModel === 'string'
            ? imageDiagnosticsDetail.configuredFallbackModel
            : null,
        attemptedModels: Array.isArray(imageDiagnosticsDetail.attemptedModels)
          ? imageDiagnosticsDetail.attemptedModels.map((value) => String(value))
          : [],
        modelUsed: typeof imageDiagnosticsDetail.modelUsed === 'string' ? imageDiagnosticsDetail.modelUsed : null,
        fallbackUsed: Boolean(imageDiagnosticsDetail.fallbackUsed)
      }
    : null;

  const calmExceptionApplied =
    Boolean(compilerDetail?.calmExceptionApplied) || timeline.some((event) => event.event === 'CALM_MODE_EXCEPTION_APPLIED');

  if (
    !intentRules.length &&
    !hookRule &&
    !hookTemplateId &&
    !shotStyleSet.length &&
    !safetyConstraints.length &&
    !calmExceptionApplied &&
    !firstSecondQualityThreshold &&
    !imageModelDiagnostics
  ) {
    return undefined;
  }

  return {
    intentRules,
    hookRule,
    hookTemplateId,
    firstSecondQualityThreshold,
    shotStyleSet,
    safetyConstraints,
    calmExceptionApplied,
    imageModel: imageModelDiagnostics
  };
};

export const getBrandProfileHandler = (organizationId: string) => {
  const profile = getBrandProfile(organizationId);
  return {
    organizationId,
    profile: mapBrandProfileForApi(profile),
    updatedAt: profile?.updatedAt
  };
};

export const upsertBrandProfileHandler = (
  organizationId: string,
  payload: {
    companyName: string;
    websiteUrl?: string;
    logoUrl?: string;
    brandTone?: string;
    primaryColorHex?: string;
    secondaryColorHex?: string;
    ctaStyle?: 'soft' | 'balanced' | 'strong';
    audienceHint?: string;
    valueProposition?: string;
  }
) => {
  const saved = upsertBrandProfile(organizationId, payload);
  return {
    organizationId,
    profile: mapBrandProfileForApi(saved),
    updatedAt: saved.updatedAt
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

const resolveStartFrameSource = (input: { hasUploadedReference: boolean; hasCustomPrompt: boolean; hasSelection: boolean }) => {
  if (input.hasUploadedReference || input.hasCustomPrompt) return 'uploaded_asset' as const;
  if (input.hasSelection) return 'generated_candidate' as const;
  return 'none' as const;
};

export const createStartFramePreflightHandler = (payload: StartFramePreflightRequest): StartFramePreflightResponse => {
  const topic = String(payload.topic ?? '').trim();
  if (!topic) throw new Error('TOPIC_REQUIRED');

  const hasUploadedReference = Boolean(String(payload.startFrameUploadObjectPath ?? '').trim());
  const hasCustomPrompt = Boolean(String(payload.startFrameCustomPrompt ?? '').trim());

  const selectedStartFrame = hasUploadedReference || hasCustomPrompt
    ? {
        style: (payload.startFrameStyle ?? 'owner_portrait') as
          | 'storefront_hero'
          | 'product_macro'
          | 'owner_portrait'
          | 'hands_at_work'
          | 'before_after_split',
        label: 'Eigenes Referenzbild'
      }
    : resolveSelectedStartFrame({
        topic,
        conceptId: payload.conceptId,
        moodPreset: 'commercial_cta',
        startFrameCandidateId: payload.startFrameCandidateId,
        startFrameStyle: payload.startFrameStyle
      });

  const source = resolveStartFrameSource({
    hasUploadedReference,
    hasCustomPrompt,
    hasSelection: Boolean(selectedStartFrame || payload.startFrameStyle || payload.startFrameCandidateId)
  });

  const policy = evaluateStartframePolicyPreflight({
    topic,
    conceptId: payload.conceptId,
    startFrameStyle: selectedStartFrame?.style,
    startFrameCandidateId: payload.startFrameCandidateId,
    startFrameLabel: selectedStartFrame?.label,
    startFrameCustomPrompt: payload.startFrameCustomPrompt,
    startFrameReferenceHint: payload.startFrameReferenceHint,
    startFrameUploadObjectPath: payload.startFrameUploadObjectPath
  });

  return {
    decision: policy.decision,
    reasonCode: policy.reasonCode,
    userMessage: policy.userMessage,
    remediation: policy.remediation,
    source,
    precedenceRuleApplied: 'UPLOAD_WINS_OVER_CANDIDATE',
    effectiveStartFrameStyle: policy.effectiveStartFrameStyle ?? selectedStartFrame?.style,
    effectiveStartFrameLabel:
      policy.effectiveStartFrameLabel ??
      (selectedStartFrame?.style ? startFrameLabelByStyle[selectedStartFrame.style] : selectedStartFrame?.label),
    matchedSignals: policy.matchedSignals
  };
};

export const selectConceptHandler = (payload: SelectConceptRequest): SelectConceptResponse => {
  const project = getProject(payload.projectId);
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${payload.projectId}`);
  }

  const generationPayload = payload.generationPayload;
  const usingGenerationPayload = Boolean(generationPayload);
  const conceptId = String(payload.conceptId ?? 'concept_web_vertical_slice') || 'concept_web_vertical_slice';
  const effectiveTopic = String(generationPayload?.topic ?? project.topic).trim() || project.topic;

  const persistedBrandProfile = mapBrandProfileForApi(getBrandProfile(project.organizationId));
  const brandProfile = generationPayload?.brandProfile ?? payload.brandProfile ?? persistedBrandProfile ?? null;

  const variantType = normalizeVariantType(payload.variantType);
  const audioMode = payload.audioMode ?? 'voiceover';
  const fallbackMoodPreset = payload.moodPreset ?? 'commercial_cta';

  const creativeIntentInput = (generationPayload?.creativeIntent as SelectConceptRequest['creativeIntent']) ?? payload.creativeIntent;
  const creativeIntent = normalizeCreativeIntent(creativeIntentInput, fallbackMoodPreset, conceptId);
  const moodPreset = deriveLegacyMoodPresetFromIntent(creativeIntentInput, fallbackMoodPreset, conceptId);
  const storyboardLight = normalizeStoryboardLight(payload.storyboardLight);

  const approvedScriptV2 = normalizeScriptV2(payload.approvedScriptV2);
  const approvedScriptLegacy = String(payload.approvedScript ?? '').trim();
  const userEditedFlowScript = String(generationPayload?.userEditedFlowScript ?? '').trim();
  const approvedScript = approvedScriptLegacy || buildScriptFromV2(approvedScriptV2) || userEditedFlowScript;

  if (!usingGenerationPayload && !approvedScript) {
    throw new Error('SCRIPT_ACCEPTANCE_REQUIRED');
  }

  const customPrompt = String(payload.startFrameCustomPrompt ?? generationPayload?.startFrame?.customPrompt ?? '').trim();
  const customLabel = String(payload.startFrameCustomLabel ?? '').trim() || 'Eigenes Referenzbild';
  const customReferenceHint = String(payload.startFrameReferenceHint ?? generationPayload?.startFrame?.referenceHint ?? '').trim();
  const uploadObjectPath = String(payload.startFrameUploadObjectPath ?? generationPayload?.startFrame?.uploadObjectPath ?? '').trim();
  const hasUploadedReference = uploadObjectPath.length > 0;
  const startFrameMode = hasUploadedReference ? 'uploaded_asset' : customPrompt.length > 0 ? 'uploaded_reference' : 'generated_candidate';
  const effectiveStartFrameSource = hasUploadedReference || customPrompt.length > 0 ? 'uploaded_asset' : 'generated_candidate';

  const selectedStartFrame =
    customPrompt.length > 0 || hasUploadedReference
      ? {
          candidateId: `sfc_custom_${Date.now()}`,
          style: payload.startFrameStyle ?? generationPayload?.startFrame?.style ?? 'owner_portrait',
          label: customLabel,
          description: 'Nutzerdefinierter Startframe aus Upload-Referenz',
          prompt:
            customPrompt ||
            'Nutze das hochgeladene Referenzbild als visuelle Leitplanke für Shot 1 und den gesamten Look des Videos.',
          thumbnailUrl: ''
        }
      : resolveSelectedStartFrame({
          topic: effectiveTopic,
          conceptId,
          moodPreset,
          creativeIntent,
          startFrameCandidateId: payload.startFrameCandidateId ?? generationPayload?.startFrame?.candidateId,
          startFrameStyle: payload.startFrameStyle ?? generationPayload?.startFrame?.style
        });

  if (!selectedStartFrame) {
    throw new Error('STARTFRAME_SELECTION_REQUIRED');
  }

  const startFramePolicy = evaluateStartframePolicyPreflight({
    topic: effectiveTopic,
    conceptId,
    startFrameStyle: selectedStartFrame.style,
    startFrameCandidateId: selectedStartFrame.candidateId,
    startFrameLabel: selectedStartFrame.label,
    startFrameCustomPrompt: customPrompt,
    startFrameReferenceHint: customReferenceHint,
    startFrameUploadObjectPath: hasUploadedReference ? uploadObjectPath : undefined
  });

  if (startFramePolicy.decision === 'block') {
    throw new Error(`STARTFRAME_POLICY_PREFLIGHT_BLOCKED:${startFramePolicy.reasonCode}`);
  }

  const effectiveStartFrame =
    startFramePolicy.decision === 'fallback' && startFramePolicy.effectiveStartFrameStyle
      ? {
          ...selectedStartFrame,
          style: startFramePolicy.effectiveStartFrameStyle,
          label: startFramePolicy.effectiveStartFrameLabel ?? startFrameLabelByStyle[startFramePolicy.effectiveStartFrameStyle],
          prompt: startFramePolicy.effectiveStartFramePrompt ?? startFramePromptByStyle[startFramePolicy.effectiveStartFrameStyle],
          description: `${selectedStartFrame.description} (policy fallback)`
        }
      : selectedStartFrame;

  const legacyUserControlsProvided = Boolean(payload.userControls);
  const userControls = normalizeUserControlProfile(payload.userControls);

  const skipConsistency = usingGenerationPayload && !approvedScript;
  const consistency = skipConsistency
    ? {
        ok: true,
        score: 100,
        reasons: [] as string[],
        checks: [{ id: 'CONSISTENCY_SKIPPED_GENERATION_PAYLOAD', ok: true, detail: 'video_plan_v1_path' }]
      }
    : validateCreativeConsistency({
        script: approvedScript,
        conceptId,
        moodPreset,
        startFrameStyle: effectiveStartFrame.style,
        userControls: legacyUserControlsProvided ? userControls : undefined,
        creativeIntent: creativeIntentInput ? creativeIntent : undefined,
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

  if (generationPayload) {
    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'GENERATION_PAYLOAD_ACCEPTED',
      detail: JSON.stringify({
        topic: generationPayload.topic,
        startFrame: generationPayload.startFrame,
        creativeIntent: generationPayload.creativeIntent,
        hasUserEditedFlowScript: Boolean(generationPayload.userEditedFlowScript?.trim()),
        migrationMode: 'v1_additive'
      })
    });
  }

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'STORYBOARD_SELECTED',
    detail: JSON.stringify({
      conceptId,
      moodPreset,
      approvedScript,
      approvedScriptV2,
      startFrameCandidateId: effectiveStartFrame.candidateId,
      startFrameStyle: effectiveStartFrame.style,
      startFrameLabel: effectiveStartFrame.label,
      startFramePrompt: effectiveStartFrame.prompt,
      startFrameMode,
      effectiveStartFrameSource,
      precedenceRuleApplied: 'UPLOAD_WINS_OVER_CANDIDATE',
      startFrameReferenceHint: customReferenceHint || undefined,
      startFrameReferenceObjectPath: hasUploadedReference ? uploadObjectPath : undefined,
      startFramePolicy: {
        decision: startFramePolicy.decision,
        reasonCode: startFramePolicy.reasonCode,
        matchedSignals: startFramePolicy.matchedSignals
      },
      audioMode,
      audioModeCompatibility: {
        voiceover: 'stable',
        scene: 'experimental_fallback_to_voiceover_possible',
        hybrid: 'experimental_fallback_to_voiceover_possible'
      },
      creativeIntent,
      storyboardLight,
      brandProfile,
      generationPayload,
      migrationMode: generationPayload ? 'v1_additive' : undefined,
      userControls: legacyUserControlsProvided ? userControls : undefined
    })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: startFramePolicy.decision === 'fallback' ? 'STARTFRAME_POLICY_PREFLIGHT_FALLBACK' : 'STARTFRAME_POLICY_PREFLIGHT_PASSED',
    detail: JSON.stringify({
      decision: startFramePolicy.decision,
      reasonCode: startFramePolicy.reasonCode,
      userMessage: startFramePolicy.userMessage,
      remediation: startFramePolicy.remediation,
      matchedSignals: startFramePolicy.matchedSignals,
      effectiveStartFrameStyle: effectiveStartFrame.style,
      effectiveStartFrameLabel: effectiveStartFrame.label
    })
  });

  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'AUDIO_MODE_SELECTED',
    detail: JSON.stringify({
      selectedAudioMode: audioMode,
      compatibility: {
        voiceover: 'stable',
        scene: 'experimental',
        hybrid: 'experimental'
      }
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

  if (brandProfile) {
    appendTimelineEvent(job.id, {
      at: new Date().toISOString(),
      event: 'BRAND_PROFILE_APPLIED',
      detail: JSON.stringify(brandProfile)
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
      candidateId: effectiveStartFrame.candidateId,
      style: effectiveStartFrame.style,
      label: effectiveStartFrame.label,
      startFrameMode,
      effectiveStartFrameSource,
      precedenceRuleApplied: 'UPLOAD_WINS_OVER_CANDIDATE',
      policyDecision: startFramePolicy.decision,
      policyReasonCode: startFramePolicy.reasonCode,
      referenceObjectPath: hasUploadedReference ? uploadObjectPath : undefined
    })
  });

  const scriptAcceptanceDetail = approvedScript || (usingGenerationPayload ? 'VIDEO_PLAN_V1_ACCEPTED' : '');
  appendTimelineEvent(job.id, {
    at: new Date().toISOString(),
    event: 'SCRIPT_ACCEPTED',
    detail: scriptAcceptanceDetail
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

  const organizationId = String((payload as { organizationId?: string }).organizationId ?? '').trim();
  const persistedBrandProfile = organizationId ? mapBrandProfileForApi(getBrandProfile(organizationId)) : null;
  const effectiveBrandProfile = payload.brandProfile ?? persistedBrandProfile ?? undefined;

  const draft = await generateScriptDraft({
    topic,
    variantType,
    moodPreset,
    creativeIntent,
    brandProfile: effectiveBrandProfile
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
