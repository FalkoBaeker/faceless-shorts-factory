import { createProject } from './project-store.ts';
import { startJob, transitionJob } from './services/job-service.ts';
import { publishNow, getPublishPosts, getPublishedJobsCount } from './services/publish-service.ts';

const project = createProject({
  organizationId: 'org_pg_publish_probe',
  topic: 'PG publish probe',
  language: 'de',
  voice: 'de_female_01',
  variantType: 'SHORT_15'
});

const jobId = startJob({ projectId: project.id, variantType: 'SHORT_15' }).id;
transitionJob(jobId, 'READY', 'probe-ready');

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
