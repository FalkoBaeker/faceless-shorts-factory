import type {
  CreateProjectRequest,
  CreateProjectResponse,
  SelectConceptRequest,
  SelectConceptResponse,
  JobStatusResponse,
  LedgerResponse,
  PublishResponse,
  AdminSnapshotResponse
} from './contracts.ts';
import { createProject, getProject, setProjectStatus } from './project-store.ts';
import { startJob } from './services/job-service.ts';
import { getJob } from './job-store.ts';
import { reserveCredit, listLedger, getLedgerBalance } from './services/billing-service.ts';
import { getPublishPosts } from './services/publish-service.ts';
import { getAdminSnapshot } from './services/admin-service.ts';
import {
  enqueueGeneration,
  enqueuePublish,
  listDeadLetters,
  replayDeadLetter,
  ensureQueueRuntime
} from './orchestration/queue-runtime.ts';

export const createProjectHandler = (payload: CreateProjectRequest): CreateProjectResponse => {
  const project = createProject({
    organizationId: payload.organizationId,
    topic: payload.topic,
    language: payload.language,
    voice: payload.voice,
    variantType: payload.variantType
  });

  return {
    projectId: project.id,
    status: project.status,
    createdAt: project.createdAt
  };
};

export const selectConceptHandler = (payload: SelectConceptRequest): SelectConceptResponse => {
  const project = getProject(payload.projectId);
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${payload.projectId}`);
  }

  setProjectStatus(payload.projectId, 'SELECTED');

  const job = startJob({
    projectId: payload.projectId,
    variantType: payload.variantType
  });

  reserveCredit(project.organizationId, job.id);

  const estimatedSeconds = payload.variantType === 'SHORT_15' ? 16 : 32;

  return {
    jobId: job.id,
    creditReservationStatus: 'RESERVED',
    estimatedSeconds
  };
};

export const generateHandler = async (jobId: string, options?: { forceFail?: boolean }): Promise<JobStatusResponse> => {
  const existing = getJob(jobId);
  if (!existing) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  if (existing.status === 'READY' || existing.status === 'FAILED') {
    return {
      jobId: existing.id,
      status: existing.status as JobStatusResponse['status'],
      timeline: existing.timeline
    };
  }

  await ensureQueueRuntime();
  await enqueueGeneration(jobId, { forceFail: Boolean(options?.forceFail), failMode: options?.forceFail ? 'hard' : undefined });

  const updated = getJob(jobId);
  if (!updated) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  return {
    jobId: updated.id,
    status: updated.status as JobStatusResponse['status'],
    timeline: updated.timeline
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

  return {
    jobId: job.id,
    status: job.status as JobStatusResponse['status'],
    timeline: job.timeline
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
