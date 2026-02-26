import { setTimeout as sleep } from 'node:timers/promises';
import {
  createProjectHandler,
  selectConceptHandler,
  generateHandler,
  getJobHandler
} from './handlers.ts';

const waitForTerminal = async (jobId: string, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = getJobHandler(jobId);
    if (current.status === 'READY' || current.status === 'FAILED') return current;
    await sleep(200);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}`);
};

const run = async () => {
  const project = createProjectHandler({
    organizationId: 'org_demo',
    topic: 'Rohr verstopft',
    language: 'de',
    voice: 'de_female_01',
    variantType: 'SHORT_15'
  });

  const selection = selectConceptHandler({
    projectId: project.projectId,
    conceptId: 'concept_1',
    variantType: 'SHORT_15'
  });

  await generateHandler(selection.jobId);
  const done = await waitForTerminal(selection.jobId);
  const fetched = getJobHandler(selection.jobId);

  console.log(
    JSON.stringify(
      {
        project,
        selection,
        finalStatus: done.status,
        timelineLength: done.timeline.length,
        fetchedStatus: fetched.status
      },
      null,
      2
    )
  );
};

run();
