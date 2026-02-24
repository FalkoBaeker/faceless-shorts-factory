import { randomUUID } from 'node:crypto';
import { createProject, getProject } from './project-store.ts';
import { saveJob, getJob, type JobRecord } from './job-store.ts';
import { getPgClient } from './persistence/postgres-client.ts';

const project = createProject({
  organizationId: 'org_pg_probe',
  topic: 'PG probe',
  language: 'de',
  voice: 'de_female_01',
  variantType: 'SHORT_15'
});

const loadedProject = getProject(project.id);

const jobId = randomUUID();
const job: JobRecord = {
  id: jobId,
  projectId: project.id,
  status: 'SELECTED',
  timeline: []
};
saveJob(job);
const loadedJob = getJob(jobId);

console.log(
  JSON.stringify(
    {
      ok: Boolean(loadedProject && loadedJob),
      client: getPgClient(),
      projectId: loadedProject?.id ?? null,
      jobId: loadedJob?.id ?? null
    },
    null,
    2
  )
);
