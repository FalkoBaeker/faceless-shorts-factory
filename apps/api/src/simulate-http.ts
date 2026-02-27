import { setTimeout as sleep } from 'node:timers/promises';
import { startApiServer } from './server.ts';

const waitForTerminal = async (base: string, jobId: string, timeoutMs = 20_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/v1/jobs/${jobId}`);
    const job = await res.json();
    if (job.status === 'READY' || job.status === 'FAILED') return job;
    await sleep(200);
  }
  throw new Error(`JOB_TIMEOUT:${jobId}`);
};

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  const organizationId = 'org_http_demo_success';

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        topic: 'Abfluss reinigen',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_http_1', moodPreset: 'commercial_cta', approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.', variantType: 'SHORT_15', startFrameStyle: 'storefront_hero' })
    });
    const select = await selectRes.json();

    const generateRes = await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });
    const generated = await generateRes.json();

    const final = await waitForTerminal(base, select.jobId);

    const ledgerRes = await fetch(`${base}/v1/ledger/${organizationId}`);
    const ledger = await ledgerRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          projectStatus: project.status,
          reservation: select.creditReservationStatus,
          generatedStatus: generated.status,
          finalStatus: final.status,
          timelineLength: final.timeline?.length ?? 0,
          ledgerBalance: ledger.balance,
          ledgerTypes: (ledger.entries ?? []).map((e: any) => e.type)
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
