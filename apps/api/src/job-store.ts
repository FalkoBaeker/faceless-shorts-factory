export type TimelineEvent = { at: string; event: string; detail?: string };

export type JobRecord = {
  id: string;
  projectId: string;
  status: string;
  timeline: TimelineEvent[];
};

const jobs = new Map<string, JobRecord>();

export const saveJob = (job: JobRecord): void => {
  jobs.set(job.id, job);
};

export const getJob = (jobId: string): JobRecord | null => {
  return jobs.get(jobId) ?? null;
};

export const listJobs = (): JobRecord[] => {
  return Array.from(jobs.values());
};

export const appendTimelineEvent = (jobId: string, event: TimelineEvent): JobRecord | null => {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.timeline.push(event);
  jobs.set(jobId, job);
  return job;
};
