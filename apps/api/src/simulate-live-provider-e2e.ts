import { setTimeout as sleep } from 'node:timers/promises';
import type { Server } from 'node:http';
import { startApiServer } from './server.ts';
import { closeQueueRuntime } from './orchestration/queue-runtime.ts';
import { closePgPool } from './persistence/pg-pool.ts';

type AssetEvent = {
  event: string;
  detail?: string;
  parsed?: {
    kind?: string;
    objectPath?: string;
    signedUrl?: string;
    bytes?: number;
    mimeType?: string;
    provider?: string;
  };
};

const parseDetail = (detail?: string): AssetEvent['parsed'] => {
  if (!detail) return undefined;
  try {
    return JSON.parse(detail) as AssetEvent['parsed'];
  } catch {
    return undefined;
  }
};

const waitForStatus = async (
  base: string,
  jobId: string,
  timeoutMs = Math.max(900_000, Number(process.env.E2E_JOB_TIMEOUT_MS ?? 900_000))
) => {
  const started = Date.now();
  let poll = 0;

  while (Date.now() - started < timeoutMs) {
    poll += 1;
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = (await res.json()) as {
      status: string;
      timeline: Array<{ event: string; detail?: string }>;
      jobId: string;
    };

    console.log(JSON.stringify({ poll, status: job.status, timelineLength: job.timeline.length }));

    if (['READY', 'FAILED'].includes(job.status)) return job;
    await sleep(2_000);
  }

  throw new Error(`JOB_TIMEOUT:${jobId}`);
};

const probeSignedUrl = async (url: string) => {
  const res = await fetch(url);
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    ok: res.ok,
    status: res.status,
    bytes: bytes.length,
    contentType: res.headers.get('content-type') ?? 'unknown'
  };
};

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    server.close(() => done());
    setTimeout(() => done(), 4_000).unref();
  });
};

const withCleanupTimeout = async (label: string, promise: Promise<unknown>, timeoutMs = 8_000) => {
  let timedOut = false;
  await Promise.race([
    promise.catch((error) => {
      console.warn(JSON.stringify({ event: 'cleanup_error', label, detail: String((error as Error)?.message ?? error) }));
    }),
    sleep(timeoutMs).then(() => {
      timedOut = true;
    })
  ]);

  if (timedOut) {
    console.warn(JSON.stringify({ event: 'cleanup_timeout', label, timeoutMs }));
  }
};

const cleanupResources = async (server: Server) => {
  await withCleanupTimeout('http_server_close', closeServer(server));
  await withCleanupTimeout('queue_runtime_close', closeQueueRuntime());
  await withCleanupTimeout('pg_pool_close', closePgPool());
};

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  let exitCode = 1;

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_provider_live',
        topic: 'Sommerangebot für lokale Bäckerei in Berlin',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = (await projectRes.json()) as { projectId: string };

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_provider_live', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15' })
    });
    const select = (await selectRes.json()) as { jobId: string };

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });

    const final = await waitForStatus(base, select.jobId);

    const assetEvents: AssetEvent[] = final.timeline
      .filter((event) => event.event.startsWith('ASSET_'))
      .map((event) => ({
        event: event.event,
        detail: event.detail,
        parsed: parseDetail(event.detail)
      }));

    const probes: Array<{ event: string; objectPath: string; signedUrl: string; probe: Awaited<ReturnType<typeof probeSignedUrl>> }> = [];
    for (const event of assetEvents) {
      if (!event.parsed?.signedUrl || !event.parsed?.objectPath) continue;
      const probe = await probeSignedUrl(event.parsed.signedUrl);
      probes.push({
        event: event.event,
        objectPath: event.parsed.objectPath,
        signedUrl: event.parsed.signedUrl,
        probe
      });
    }

    const adminRes = await fetch(`${base}/v1/admin/snapshot`);
    const admin = await adminRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          jobId: select.jobId,
          finalStatus: final.status,
          timelineLength: final.timeline.length,
          assetEvents,
          probes,
          providerHealth: admin.providerHealth,
          totals: admin.totals
        },
        null,
        2
      )
    );

    exitCode = final.status === 'READY' ? 0 : 1;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'simulate_live_provider_e2e_error',
        detail: String((error as Error)?.message ?? error)
      })
    );
    exitCode = 1;
  } finally {
    await cleanupResources(server);
    await sleep(50);
    process.exit(exitCode);
  }
};

void run();
