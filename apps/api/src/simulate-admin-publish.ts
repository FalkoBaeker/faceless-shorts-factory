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

const waitForStatus = async (
  base: string,
  jobId: string,
  expected: 'READY' | 'PUBLISHED' | 'FAILED',
  options?: { acceptPublishedAsReady?: boolean },
  timeoutMs = resolveWaitTimeoutMs()
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();
    const status = String(job.status);
    if (status === expected) return job;
    if (expected === 'READY' && options?.acceptPublishedAsReady && status === 'PUBLISHED') return job;

    if (expected === 'PUBLISHED') {
      if (status === 'FAILED') {
        throw new Error(`JOB_TERMINAL_STATUS_UNEXPECTED:${jobId}:${expected}:${status}`);
      }
      await sleep(200);
      continue;
    }

    const terminalStatuses = expected === 'READY' ? new Set(['FAILED', 'PUBLISHED']) : new Set(['READY', 'PUBLISHED']);
    if (terminalStatuses.has(status)) {
      throw new Error(`JOB_TERMINAL_STATUS_UNEXPECTED:${jobId}:${expected}:${String(job.status)}`);
    }
    await sleep(200);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}:${expected}`);
};

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  const organizationId = 'org_http_demo_publish';

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        topic: 'Fenster und Türen einstellen',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_publish_1', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero' })
    });
    const select = await selectRes.json();

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });

    const prePublish = await waitForStatus(base, select.jobId, 'READY', { acceptPublishedAsReady: true });

    let publishQueued: { status?: string; targets?: string[]; posts?: unknown[] };
    if (String(prePublish.status) === 'PUBLISHED') {
      publishQueued = { status: 'PUBLISH_PENDING', targets: ['tiktok', 'youtube'], posts: [] };
    } else {
      const publishRes = await fetch(`${base}/v1/jobs/${select.jobId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets: ['tiktok', 'youtube'] })
      });
      publishQueued = await publishRes.json();
    }

    let job: { status?: string };
    let publishSettled = false;
    try {
      job = await waitForStatus(base, select.jobId, 'PUBLISHED', undefined, Math.min(resolveWaitTimeoutMs(), 30_000));
      publishSettled = true;
    } catch {
      const fallbackRes = await fetch(`${base}/v1/jobs/${select.jobId}`);
      job = await fallbackRes.json();
    }

    const adminRes = await fetch(`${base}/v1/admin/snapshot`);
    const admin = await adminRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          publishQueuedStatus: publishQueued.status,
          publishTargets: publishQueued.targets,
          postCount: (publishQueued.posts ?? []).length,
          jobStatus: job.status,
          publishSettled,
          adminTotals: admin.totals
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
