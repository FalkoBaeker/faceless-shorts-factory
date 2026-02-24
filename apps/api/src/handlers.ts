import type {
  CreateProjectRequest,
  CreateProjectResponse,
  SelectConceptRequest,
  SelectConceptResponse,
  JobStatusResponse
} from './contracts.ts';
import { createProject, getProject, setProjectStatus } from './project-store.ts';
import { startJob, transitionJob } from './services/job-service.ts';
import { getJob } from './job-store.ts';

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

  const estimatedSeconds = payload.variantType === 'SHORT_15' ? 16 : 32;

  return {
    jobId: job.id,
    creditReservationStatus: 'RESERVED',
    estimatedSeconds
  };
};

export const generateHandler = (jobId: string): JobStatusResponse => {
  transitionJob(jobId, 'VIDEO_PENDING', 'video provider enqueued');
  transitionJob(jobId, 'AUDIO_PENDING', 'tts provider enqueued');
  transitionJob(jobId, 'ASSEMBLY_PENDING', 'video+audio ready');
  transitionJob(jobId, 'RENDERING', 'render pipeline started');
  transitionJob(jobId, 'READY', 'render complete');

  const job = getJob(jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND:${jobId}`);

  return {
    jobId: job.id,
    status: job.status as JobStatusResponse['status'],
    timeline: job.timeline
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
