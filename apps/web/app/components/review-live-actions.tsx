'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, selectConcept, triggerGenerate, type ApiError } from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

const asApiMessage = (error: unknown) => {
  const api = error as Partial<ApiError>;
  return api?.message ?? String(error);
};

export function ReviewLiveActions() {
  const router = useRouter();
  const [topic, setTopic] = useState('Sommerangebot für lokale Bäckerei in Berlin');
  const [variantType, setVariantType] = useState<'SHORT_15' | 'MASTER_30'>('SHORT_15');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const runFlow = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    setBusy(true);
    setStatus('Erstelle Projekt ...');
    try {
      const project = await createProject(token, {
        organizationId: 'org_web_mvp',
        topic,
        variantType
      });

      setStatus('Wähle Konzept & reserviere Job ...');
      const selection = await selectConcept(token, project.projectId, variantType);

      setStatus('Starte Generierung ...');
      await triggerGenerate(token, project.projectId, selection.jobId);

      router.push(`/job-status?jobId=${encodeURIComponent(selection.jobId)}&state=progress`);
    } catch (error) {
      setStatus(`Flow fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="section-card" aria-labelledby="review-live-title">
      <h2 id="review-live-title" className="section-title">
        Live MVP Flow (mit echten API-Daten)
      </h2>
      <p className="section-copy">
        Startet den echten Ablauf: Project → Select → Generate. Ergebnis wird auf der Job-Status-Seite verfolgt.
      </p>

      <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="auth-field">
          <span>Topic</span>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
      </div>

      <div className="state-toggle-row" role="tablist" aria-label="Variant toggle">
        <button
          type="button"
          className={`state-toggle ${variantType === 'SHORT_15' ? 'active' : ''}`}
          onClick={() => setVariantType('SHORT_15')}
        >
          SHORT_15
        </button>
        <button
          type="button"
          className={`state-toggle ${variantType === 'MASTER_30' ? 'active' : ''}`}
          onClick={() => setVariantType('MASTER_30')}
        >
          MASTER_30
        </button>
      </div>

      <div className="action-row">
        <button className="button" type="button" disabled={busy} onClick={runFlow}>
          {busy ? 'Flow läuft ...' : 'Live Flow starten'}
        </button>
      </div>

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}
    </article>
  );
}
