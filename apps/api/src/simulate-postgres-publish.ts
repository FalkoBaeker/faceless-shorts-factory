import { publishNow, getPublishPosts, getPublishedJobsCount } from './services/publish-service.ts';

const jobId = 'job_pg_publish_probe';
const posts = publishNow(jobId, ['tiktok', 'youtube']);
const listed = getPublishPosts(jobId);
const count = getPublishedJobsCount();

console.log(
  JSON.stringify(
    {
      ok: posts.length === 2 && listed.length === 2 && count >= 1,
      postCount: posts.length,
      listedCount: listed.length,
      publishedJobsCount: count,
      targets: posts.map((p) => p.target)
    },
    null,
    2
  )
);
