import { setTimeout as sleep } from 'node:timers/promises';
import {
  createProjectHandler,
  selectConceptHandler,
  generateHandler,
  getJobHandler
} from './handlers.ts';
import { closeQueueRuntime } from './orchestration/queue-runtime.ts';

if (!process.env.SIM_PROVIDER_FALLBACK) process.env.SIM_PROVIDER_FALLBACK = 'true';

const resolveWaitTimeoutMs = () => {
  const simTimeoutMs = Number(process.env.SIM_WAIT_TIMEOUT_MS ?? 0);
  if (Number.isFinite(simTimeoutMs) && simTimeoutMs > 0) return Math.floor(simTimeoutMs);
  const e2eTimeoutMs = Number(process.env.E2E_JOB_TIMEOUT_MS ?? 0);
  const videoStageTimeoutMs = Number(process.env.VIDEO_STAGE_TIMEOUT_MS ?? 0);
  const stageWithHeadroomMs = Number.isFinite(videoStageTimeoutMs) && videoStageTimeoutMs > 0 ? videoStageTimeoutMs + 120_000 : 0;
  const e2eFallbackMs = Number.isFinite(e2eTimeoutMs) && e2eTimeoutMs > 0 ? Math.floor(e2eTimeoutMs) : 0;
  return Math.max(600_000, e2eFallbackMs, stageWithHeadroomMs);
};

const waitForTerminal = async (jobId: string, timeoutMs = resolveWaitTimeoutMs()) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = getJobHandler(jobId);
    if (current.status === 'READY' || current.status === 'FAILED') return current;
    await sleep(200);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}`);
};

const run = async () => {
  try {
    const project = createProjectHandler({
      organizationId: 'org_demo',
      topic: 'Rohr verstopft',
      language: 'de',
      voice: 'de_female_01',
      variantType: 'SHORT_15'
    });

    const selection = selectConceptHandler({
      projectId: project.projectId,
      conceptId: 'concept_1', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero'
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
  } finally {
    void closeQueueRuntime();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
