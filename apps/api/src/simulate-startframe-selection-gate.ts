import { startApiServer } from './server.ts';

const run = async () => {
  process.env.AUTH_REQUIRED = 'false';

  const { server, port } = await startApiServer(0);
  const base = `http://127.0.0.1:${port}`;
  const organizationId = `org_startframe_gate_${Date.now()}`;

  try {
    const projectRes = await fetch(`${base}/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        topic: 'Sommerangebot für lokale Bäckerei in Berlin',
        language: 'de',
        voice: 'de_female_01',
        variantType: 'SHORT_15'
      })
    });
    const project = await projectRes.json();

    const missingStartframeRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conceptId: 'concept_web_vertical_slice',
        moodPreset: 'commercial_cta',
        approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.',
        variantType: 'SHORT_15'
      })
    });
    const missingStartframe = await missingStartframeRes.json();

    if (missingStartframeRes.status !== 400 || String(missingStartframe.error ?? '') !== 'STARTFRAME_SELECTION_REQUIRED') {
      throw new Error(
        `EXPECTED_STARTFRAME_SELECTION_REQUIRED:${missingStartframeRes.status}:${String(missingStartframe.error ?? '')}`
      );
    }

    const candidatesRes = await fetch(`${base}/v1/startframes/candidates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: 'Sommerangebot für lokale Bäckerei in Berlin',
        conceptId: 'concept_web_vertical_slice',
        moodPreset: 'commercial_cta',
        limit: 3
      })
    });
    const candidatesPayload = await candidatesRes.json();
    const candidates = Array.isArray(candidatesPayload.candidates) ? candidatesPayload.candidates : [];

    if (candidatesRes.status !== 200 || candidates.length < 3) {
      throw new Error(`CANDIDATES_TOO_SHORT:${candidatesRes.status}:${candidates.length}`);
    }

    const selectedCandidate = candidates[0];

    const selectRes = await fetch(`${base}/v1/projects/${project.projectId}/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conceptId: 'concept_web_vertical_slice',
        moodPreset: 'commercial_cta',
        approvedScript: 'Kurzes, klares Skript mit Abschlusssatz und CTA.',
        variantType: 'SHORT_15',
        startFrameCandidateId: selectedCandidate.candidateId,
        startFrameStyle: selectedCandidate.style
      })
    });
    const select = await selectRes.json();

    if (selectRes.status !== 200) {
      throw new Error(`SELECT_FAILED:${selectRes.status}:${String(select.error ?? '')}`);
    }

    const jobRes = await fetch(`${base}/v1/jobs/${select.jobId}`);
    const job = await jobRes.json();

    const selectedStartframeEvent = (job.timeline ?? []).find((event: any) => event.event === 'SELECTED_STARTFRAME');
    if (!selectedStartframeEvent?.detail) {
      throw new Error('SELECTED_STARTFRAME_EVENT_MISSING');
    }

    let parsedDetail: { candidateId?: string; style?: string } | null = null;
    try {
      parsedDetail = JSON.parse(selectedStartframeEvent.detail);
    } catch {
      parsedDetail = null;
    }

    if (!parsedDetail?.candidateId || parsedDetail.candidateId !== selectedCandidate.candidateId) {
      throw new Error(`SELECTED_STARTFRAME_CANDIDATE_MISMATCH:${selectedCandidate.candidateId}:${String(parsedDetail?.candidateId ?? '')}`);
    }

    console.log(
      JSON.stringify(
        {
          check: 'STARTFRAME_SELECTION_GATE',
          gateError: missingStartframe.error,
          candidates: candidates.map((candidate: any) => ({
            candidateId: candidate.candidateId,
            style: candidate.style,
            label: candidate.label
          })),
          selectedCandidateId: selectedCandidate.candidateId,
          selectedStyle: selectedCandidate.style,
          timelineEvent: parsedDetail,
          ok: true
        },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(JSON.stringify({ check: 'STARTFRAME_SELECTION_GATE', ok: false, error: String(error?.message ?? error) }, null, 2));
    process.exit(1);
  });
