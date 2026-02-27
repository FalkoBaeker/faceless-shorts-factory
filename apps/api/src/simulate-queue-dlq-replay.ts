import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { startApiServer } from './server.ts';

const waitForStatus = async (
  base: string,
  jobId: string,
  expected: string,
  timeoutMs = Math.max(180_000, Number(process.env.E2E_JOB_TIMEOUT_MS ?? 180_000))
) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();
    if (job.status === expected) return job;
    await sleep(300);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}:${expected}`);
};

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    server.close(() => finish());
    setTimeout(() => finish(), 4_000).unref();
  });
};

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  let exitCode = 0;

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_dlq_probe',
        topic: 'dlq probe',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_dlq', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero' })
    });
    const select = await selectRes.json();

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId, forceFail: true })
    });

    await waitForStatus(base, select.jobId, 'FAILED');

    const dlqRes = await fetch(`${base}/v1/dlq`);
    const dlq = await dlqRes.json();
    const entry = (dlq.entries ?? []).find((item: any) => item?.data?.jobId === select.jobId);
    if (!entry?.id) throw new Error('DLQ_ENTRY_NOT_FOUND_FOR_JOB');

    const replayRes = await fetch(`${base}/v1/dlq/${encodeURIComponent(entry.id)}/replay`, {
      method: 'POST'
    });
    const replay = await replayRes.json();

    const done = await waitForStatus(base, select.jobId, 'READY');

    const ok = replay.replayed === true && done.status === 'READY';
    if (!ok) exitCode = 1;

    console.log(
      JSON.stringify(
        {
          ok,
          failedThenRecovered: true,
          deadLetterId: entry.id,
          replayJobId: replay.jobId,
          finalStatus: done.status
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`DLQ_REPLAY_SMOKE_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await closeServer(server);
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`DLQ_REPLAY_SMOKE_FATAL:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
