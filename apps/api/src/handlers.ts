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
import { startJob, transitionJob } from './services/job-service.ts';
import { getJob } from './job-store.ts';
import { reserveCredit, commitCredit, releaseCredit, listLedger, getLedgerBalance } from './services/billing-service.ts';
import { publishNow, type PublishTarget } from './services/publish-service.ts';
import { getAdminSnapshot } from './services/admin-service.ts';

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

export const generateHandler = (jobId: string, options?: { forceFail?: boolean }): JobStatusResponse => {
  const existing = getJob(jobId);
  if (!existing) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  if (existing.status === 'READY' || existing.status === 'FAILED') {
    return {
      jobId: existing.id,
      status: existing.status as JobStatusResponse['status'],
      timeline: existing.timeline
    };
  }

  const project = getProject(existing.projectId);
  if (!project) throw new Error(`PROJECT_NOT_FOUND:${existing.projectId}`);

  if (options?.forceFail) {
    transitionJob(jobId, 'FAILED', 'forced failure for simulation');
    releaseCredit(project.organizationId, jobId);
  } else {
    transitionJob(jobId, 'VIDEO_PENDING', 'video provider enqueued');
    transitionJob(jobId, 'AUDIO_PENDING', 'tts provider enqueued');
    transitionJob(jobId, 'ASSEMBLY_PENDING', 'video+audio ready');
    transitionJob(jobId, 'RENDERING', 'render pipeline started');
    transitionJob(jobId, 'READY', 'render complete');
    commitCredit(project.organizationId, jobId);
  }

  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  return {
    jobId: job.id,
    status: job.status as JobStatusResponse['status'],
    timeline: job.timeline
  };
};

export const publishJobHandler = (
  jobId: string,
  targets: Array<'tiktok' | 'instagram' | 'youtube'>
): PublishResponse => {
  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);
  if (job.status !== 'READY' && job.status !== 'PUBLISHED') {
    throw new Error(`JOB_NOT_PUBLISHABLE:${job.status}`);
  }

  transitionJob(jobId, 'PUBLISH_PENDING', 'publishing to social targets');
  const posts = publishNow(jobId, targets as PublishTarget[]);
  transitionJob(jobId, 'PUBLISHED', `published to ${targets.join(',')}`);

  return {
    jobId,
    status: 'PUBLISHED',
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
