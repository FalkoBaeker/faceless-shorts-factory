import { setTimeout as sleep } from 'node:timers/promises';
import { startApiServer } from './server.ts';
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

const waitForStatus = async (base: string, jobId: string, expected: string, timeoutMs = resolveWaitTimeoutMs()) => {
  const terminalStatuses = new Set(['READY', 'FAILED', 'PUBLISHED']);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();
    if (job.status === expected) return job;
    if (terminalStatuses.has(String(job.status))) {
      throw new Error(`JOB_TERMINAL_STATUS_UNEXPECTED:${jobId}:${expected}:${String(job.status)}`);
    }
    await sleep(200);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}:${expected}`);
};

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_idem_probe',
        topic: 'idempotency probe',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_idem', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero' })
    });
    const select = await selectRes.json();

    await Promise.all([
      fetch(`${base}/v1/projects/${project.projectId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: select.jobId })
      }),
      fetch(`${base}/v1/projects/${project.projectId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: select.jobId })
      })
    ]);

    const done = await waitForStatus(base, select.jobId, 'READY');
    const statusEvents = (done.timeline ?? []).filter((event: any) => String(event.event).startsWith('STATUS_'));
    const counts = statusEvents.reduce((acc: Record<string, number>, event: any) => {
      acc[event.event] = (acc[event.event] ?? 0) + 1;
      return acc;
    }, {});

    const duplicated = Object.values(counts).some((value) => value > 1);

    console.log(
      JSON.stringify(
        {
          ok: !duplicated,
          jobStatus: done.status,
          statusEventCounts: counts,
          timelineLength: done.timeline?.length ?? 0
        },
        null,
        2
      )
    );
  } finally {
    server.close();
    void closeQueueRuntime();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
