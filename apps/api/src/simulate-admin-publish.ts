import { setTimeout as sleep } from 'node:timers/promises';
import { startApiServer } from './server.ts';

const waitForStatus = async (
  base: string,
  jobId: string,
  expected: 'READY' | 'PUBLISHED' | 'FAILED',
  timeoutMs = 20_000
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();
    if (job.status === expected) return job;
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
      body: JSON.stringify({ conceptId: 'concept_publish_1', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15' })
    });
    const select = await selectRes.json();

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });

    await waitForStatus(base, select.jobId, 'READY');

    const publishRes = await fetch(`${base}/v1/jobs/${select.jobId}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: ['tiktok', 'youtube'] })
    });
    const publishQueued = await publishRes.json();

    const job = await waitForStatus(base, select.jobId, 'PUBLISHED');

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
          adminTotals: admin.totals
        },
        null,
        2
      )
    );
  } finally {
    server.close();
  }
};

run();
