import { getPersistenceBackend } from '../persistence/backend.ts';
import { postgresSkeleton } from '../persistence/postgres-skeleton.ts';

export type PublishTarget = 'tiktok' | 'instagram' | 'youtube';

export type PublishPost = {
  target: PublishTarget;
  postUrl: string;
};

const publishedByJob = new Map<string, PublishPost[]>();

export const publishNow = (jobId: string, targets: PublishTarget[]): PublishPost[] => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.publishNow() as never;
  }

  const existing = publishedByJob.get(jobId);
  if (existing) return existing;

  const posts = targets.map((target) => ({
    target,
    postUrl: `https://social.local/${target}/${jobId}`
  }));

  publishedByJob.set(jobId, posts);
  return posts;
};

export const getPublishPosts = (jobId: string): PublishPost[] => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.listPublishPosts() as never;
  }
  return publishedByJob.get(jobId) ?? [];
};

export const getPublishedJobsCount = (): number => {
  if (getPersistenceBackend() === 'postgres') {
    return postgresSkeleton.getPublishedJobsCount() as never;
  }
  return publishedByJob.size;
};
