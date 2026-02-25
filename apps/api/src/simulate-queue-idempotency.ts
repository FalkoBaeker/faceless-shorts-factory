import { setTimeout as sleep } from 'node:timers/promises';
import { startApiServer } from './server.ts';

const waitForStatus = async (base: string, jobId: string, expected: string, timeoutMs = 20_000) => {
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
      body: JSON.stringify({ conceptId: 'concept_idem', variantType: 'SHORT_15' })
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
  }
};

run();
