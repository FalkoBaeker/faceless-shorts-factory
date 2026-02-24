import { getPersistenceBackend } from './persistence/backend.ts';
import { postgresJobRepo } from './persistence/postgres-job-repo.ts';

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
    postgresJobRepo.save(job);
    return;
  }
  jobs.set(job.id, job);
};

export const getJob = (jobId: string): JobRecord | null => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresJobRepo.getById(jobId);
  }
  return jobs.get(jobId) ?? null;
};

export const listJobs = (): JobRecord[] => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresJobRepo.list();
  }
  return Array.from(jobs.values());
};

export const appendTimelineEvent = (jobId: string, event: TimelineEvent): JobRecord | null => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresJobRepo.appendEvent(jobId, event);
  }

  const job = jobs.get(jobId);
  if (!job) return null;
  job.timeline.push(event);
  jobs.set(jobId, job);
  return job;
};
