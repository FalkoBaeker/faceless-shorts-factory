import { setTimeout as sleep } from 'node:timers/promises';
import { startApiServer } from './server.ts';

const waitForStatus = async (base: string, jobId: string, expected: 'FAILED' | 'READY', timeoutMs = 20_000) => {
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
  const organizationId = 'org_http_demo_failure';

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        topic: 'Leistungsausfall prüfen',
        language: 'de',
        voice: 'de_male_01',
        variantType: 'MASTER_30'
      })
    });
    const project = await projectRes.json();

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptId: 'concept_http_fail', variantType: 'MASTER_30' })
    });
    const select = await selectRes.json();

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId, forceFail: true })
    });

    const generated = await waitForStatus(base, select.jobId, 'FAILED');

    const ledgerRes = await fetch(`${base}/v1/ledger/${organizationId}`);
    const ledger = await ledgerRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          generatedStatus: generated.status,
          timelineLength: generated.timeline?.length ?? 0,
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
