import { startApiServer } from './server.ts';

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
      body: JSON.stringify({ conceptId: 'concept_publish_1', variantType: 'SHORT_15' })
    });
    const select = await selectRes.json();

    await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });

    const publishRes = await fetch(`${base}/v1/jobs/${select.jobId}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets: ['tiktok', 'youtube'] })
    });
    const published = await publishRes.json();

    const jobRes = await fetch(`${base}/v1/jobs/${select.jobId}`);
    const job = await jobRes.json();

    const adminRes = await fetch(`${base}/v1/admin/snapshot`);
    const admin = await adminRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          publishedStatus: published.status,
          publishTargets: published.targets,
          postCount: (published.posts ?? []).length,
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
