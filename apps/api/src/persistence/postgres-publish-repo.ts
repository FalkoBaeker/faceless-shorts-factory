import type { PublishPost, PublishTarget } from '../services/publish-service.ts';
import { getPgClient } from './postgres-client.ts';

const postsByJob = new Map<string, PublishPost[]>();

export const postgresPublishRepo = {
  publishNow: (jobId: string, targets: PublishTarget[]): PublishPost[] => {
    getPgClient();
    const existing = postsByJob.get(jobId);
    if (existing) return existing;
    const posts = targets.map((target) => ({
      target,
      postUrl: `https://social.local/${target}/${jobId}`
    }));
    postsByJob.set(jobId, posts);
    return posts;
  },

  listForJob: (jobId: string): PublishPost[] => {
    getPgClient();
    return postsByJob.get(jobId) ?? [];
  },

  publishedJobsCount: (): number => {
    getPgClient();
    return postsByJob.size;
  }
};
