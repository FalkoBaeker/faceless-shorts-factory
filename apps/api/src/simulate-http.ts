import { startApiServer } from './server.ts';

const run = async () => {
  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org_http_demo',
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
      body: JSON.stringify({ conceptId: 'concept_http_1', variantType: 'SHORT_15' })
    });
    const select = await selectRes.json();

    const generateRes = await fetch(`${base}/v1/projects/${project.projectId}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: select.jobId })
    });
    const generated = await generateRes.json();

    const jobRes = await fetch(`${base}/v1/jobs/${select.jobId}`);
    const fetched = await jobRes.json();

    console.log(
      JSON.stringify(
        {
          port,
          projectStatus: project.status,
          reservation: select.creditReservationStatus,
          generatedStatus: generated.status,
          fetchedStatus: fetched.status,
          timelineLength: fetched.timeline?.length ?? 0
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
