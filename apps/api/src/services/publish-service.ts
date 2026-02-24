export type PublishTarget = 'tiktok' | 'instagram' | 'youtube';

export type PublishPost = {
  target: PublishTarget;
  postUrl: string;
};

const publishedByJob = new Map<string, PublishPost[]>();

export const publishNow = (jobId: string, targets: PublishTarget[]): PublishPost[] => {
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
  return publishedByJob.get(jobId) ?? [];
};

export const getPublishedJobsCount = (): number => {
  return publishedByJob.size;
};
