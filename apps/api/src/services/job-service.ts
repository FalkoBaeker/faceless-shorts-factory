import { randomUUID } from 'node:crypto';
import { saveJob, getJob, type JobRecord } from '../job-store.ts';
import { buildRunPlan } from '../../../../workers/pipeline/src/run-plan.ts';
import { isTransitionAllowed, type VideoJobStatus } from '../../../../workers/pipeline/src/state-machine.ts';

export type StartJobInput = {
  projectId: string;
  variantType: 'SHORT_15' | 'MASTER_30';
};

export const startJob = (input: StartJobInput): JobRecord => {
  const jobId = randomUUID();
  const plan = buildRunPlan(input.variantType);

  const job: JobRecord = {
    id: jobId,
    projectId: input.projectId,
    status: 'SELECTED',
    timeline: [
      {
        at: new Date().toISOString(),
        event: 'JOB_CREATED',
        detail: `target=${plan.targetSeconds}s segments=${plan.segments.join('+')} trim=${plan.trimToSeconds}s`
      }
    ]
  };

  saveJob(job);
  return job;
};

export const transitionJob = (jobId: string, toStatus: string, detail?: string): JobRecord | null => {
  const job = getJob(jobId);
  if (!job) return null;

  if (job.status === toStatus) return job;

  const from = job.status as VideoJobStatus;
  const to = toStatus as VideoJobStatus;
  if (!isTransitionAllowed(from, to)) {
    job.timeline.push({
      at: new Date().toISOString(),
      event: 'TRANSITION_REJECTED',
      detail: `${from}->${to}`
    });
    saveJob(job);
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }

  job.status = toStatus;
  job.timeline.push({
    at: new Date().toISOString(),
    event: `STATUS_${toStatus}`,
    detail
  });

  saveJob(job);
  return getJob(jobId);
};
