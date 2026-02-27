import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { startApiServer } from './server.ts';

const waitForStatus = async (
  base: string,
  jobId: string,
  expected: string,
  timeoutMs = Math.max(
    Number(process.env.E2E_JOB_TIMEOUT_MS ?? 0),
    Number(process.env.VIDEO_STAGE_TIMEOUT_MS ?? 1_800_000) + 120_000,
    240_000
  )
) => {
  const pollSleepMs = Math.max(1_000, Number(process.env.RESTART_SIM_POLL_MS ?? 2_000));
  const started = Date.now();
  let poll = 0;

  while (Date.now() - started < timeoutMs) {
    poll += 1;
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();

    const status = String(job.status ?? 'unknown');
    const timelineLength = Array.isArray(job.timeline) ? job.timeline.length : 0;
    console.log(JSON.stringify({ phase: 'waitForStatus', poll, status, timelineLength }));

    if (status === expected) return job;
    if (status === 'FAILED') {
      throw new Error(`JOB_FAILED:${jobId}:${status}`);
    }

    await sleep(pollSleepMs);
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
  const first = await startApiServer(0);
  const firstBase = `http://127.0.0.1:${first.port}`;

  let jobId = '';
  let exitCode = 0;

  try {
    const projectRes = await fetch(`${firstBase}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_restart_probe',
        topic: 'restart probe',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${firstBase}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_restart', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero' })
    });
    const select = await selectRes.json();
    jobId = select.jobId;

    console.log(JSON.stringify({ phase: 'phase1_init', projectId: project.projectId, jobId }));

    await fetch(`${firstBase}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId })
    });

    await waitForStatus(firstBase, jobId, 'READY');
    console.log(JSON.stringify({ phase: 'phase1_ready', jobId }));
  } catch (error) {
    console.error(`RESTART_SMOKE_PHASE1_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await closeServer(first.server);
  }

  await sleep(300);

  const second = await startApiServer(0);
  const secondBase = `http://127.0.0.1:${second.port}`;

  try {
    console.log(JSON.stringify({ phase: 'phase2_restart_check', jobId }));

    const jobRes = await fetch(`${secondBase}/v1/jobs/${jobId}`);
    const job = await jobRes.json();

    const statusEvents = (job.timeline ?? []).filter((event: any) => String(event.event).startsWith('STATUS_'));

    const ok = job.status === 'READY';
    if (!ok) exitCode = 1;

    console.log(
      JSON.stringify(
        {
          ok,
          persistedStatusAfterRestart: job.status,
          statusEventCount: statusEvents.length
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`RESTART_SMOKE_PHASE2_FAILED:${String((error as Error)?.message ?? error)}`);
    exitCode = 1;
  } finally {
    await closeServer(second.server);
  }

  process.exit(exitCode);
};

run().catch((error) => {
  console.error(`RESTART_SMOKE_FATAL:${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
