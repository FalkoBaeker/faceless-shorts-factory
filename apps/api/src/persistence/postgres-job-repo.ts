import type { JobRecord, TimelineEvent } from '../job-store.ts';
import { getPgClient } from './postgres-client.ts';

const jobs = new Map<string, JobRecord>();

export const postgresJobRepo = {
  save: (job: JobRecord): void => {
    getPgClient();
    jobs.set(job.id, job);
  },

  getById: (jobId: string): JobRecord | null => {
    getPgClient();
    return jobs.get(jobId) ?? null;
  },

  list: (): JobRecord[] => {
    getPgClient();
    return Array.from(jobs.values());
  },

  appendEvent: (jobId: string, event: TimelineEvent): JobRecord | null => {
    getPgClient();
    const job = jobs.get(jobId);
    if (!job) return null;
    job.timeline.push(event);
    jobs.set(jobId, job);
    return job;
  }
};
