import { getPersistenceBackend } from './persistence/backend.ts';
import { postgresSkeleton } from './persistence/postgres-skeleton.ts';

export type TimelineEvent = { at: string; event: string; detail?: string };

export type JobRecord = {
  id: string;
  projectId: string;
  status: string;
  timeline: TimelineEvent[];
};

const jobs = new Map<string, JobRecord>();

export const saveJob = (job: JobRecord): void => {
  if (getPersistenceBackend() === 'postgres') {
    postgresSkeleton.saveJob();
    return;
  }
  jobs.set(job.id, job);
};

export const getJob = (jobId: string): JobRecord | null => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.getJob() as never;
  }
  return jobs.get(jobId) ?? null;
};

export const listJobs = (): JobRecord[] => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.listJobs() as never;
  }
  return Array.from(jobs.values());
};

export const appendTimelineEvent = (jobId: string, event: TimelineEvent): JobRecord | null => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.appendTimelineEvent() as never;
  }

  const job = jobs.get(jobId);
  if (!job) return null;
  job.timeline.push(event);
  jobs.set(jobId, job);
  return job;
};
