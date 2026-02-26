'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJob, fetchJobAssets, triggerAlertTest, type ApiError, type JobAssetsPayload, type JobPayload } from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

type Props = {
  initialJobId: string;
};

const asApiMessage = (error: unknown) => {
  const api = error as Partial<ApiError>;
  return api?.message ?? String(error);
};

export function JobRuntimePanel({ initialJobId }: Props) {
  const [jobId, setJobId] = useState(initialJobId);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [assets, setAssets] = useState<JobAssetsPayload | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertResult, setAlertResult] = useState('');

  useEffect(() => {
    setJobId(initialJobId);
  }, [initialJobId]);

  const pollJob = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Kein Token vorhanden. Bitte zuerst einloggen.');
      return;
    }
    if (!jobId) {
      setStatus('Bitte Job ID eingeben.');
      return;
    }

    setBusy(true);
    try {
      const current = await fetchJob(token, jobId);
      setJob(current);
      setStatus(`Job geladen: ${current.status}`);

      if (current.status === 'READY' || current.status === 'PUBLISHED') {
        const listed = await fetchJobAssets(token, jobId);
        setAssets(listed);
      }
    } catch (error) {
      setStatus(`Job-Abfrage fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const loop = async () => {
      const token = readStoredToken();
      if (!token || cancelled) return;

      try {
        const current = await fetchJob(token, jobId);
        if (cancelled) return;
        setJob(current);

        if (current.status === 'READY' || current.status === 'PUBLISHED') {
          const listed = await fetchJobAssets(token, jobId);
          if (cancelled) return;
          setAssets(listed);
          return;
        }
      } catch {
        // keep manual status message for button action only
      }

      if (!cancelled) {
        window.setTimeout(() => {
          void loop();
        }, 2500);
      }
    };

    void loop();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const finalVideo = useMemo(() => {
    const entries = assets?.assets ?? [];
    return entries.find((entry) => entry.kind === 'final_video') ?? null;
  }, [assets]);

  const sendAlert = async () => {
    const token = readStoredToken();
    if (!token) {
      setAlertResult('Kein Token vorhanden. Login erforderlich.');
      return;
    }

    try {
      const result = await triggerAlertTest(token);
      setAlertResult(`Alert test: sent=${result.sent} target=${result.target} detail=${result.detail}`);
    } catch (error) {
      setAlertResult(`Alert test failed: ${asApiMessage(error)}`);
    }
  };

  return (
    <article className="section-card" aria-labelledby="runtime-title">
      <h2 id="runtime-title" className="section-title">
        Real Runtime Status (API, kein Mock)
      </h2>
      <p className="section-copy">Mit Job-ID werden echte API-Daten abgefragt. Hier siehst du die echte Statuskette bis READY und den echten Export-Download.</p>

      <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="auth-field">
          <span>Job ID</span>
          <input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="job_xxx" />
        </label>
      </div>

      <div className="action-row">
        <button type="button" className="button" disabled={busy} onClick={pollJob}>
          {busy ? 'Lädt ...' : 'Job jetzt laden'}
        </button>
        <button type="button" className="button-ghost" onClick={sendAlert}>
          Test-Alert senden
        </button>
      </div>

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}
      {alertResult ? <p className="section-copy" style={{ marginTop: 0 }}>{alertResult}</p> : null}

      <ul className="list-clean" aria-label="Runtime timeline">
        {(job?.timeline ?? []).slice(-6).reverse().map((event) => (
          <li className="step-item" key={`${event.at}-${event.event}`}>
            <div>
              <p className="step-name">{event.event}</p>
              <p className="step-sub">{event.at}</p>
            </div>
            <span className="badge">{job?.status ?? 'unknown'}</span>
          </li>
        ))}
      </ul>

      {finalVideo ? (
        <div className="section-card" style={{ marginTop: 4 }}>
          <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
            Export bereit
          </h3>
          <p className="section-copy">Finales Asset liegt vor und kann heruntergeladen werden.</p>
          <div className="action-row">
            <a className="button" href={finalVideo.signedUrl} target="_blank" rel="noreferrer">
              Export herunterladen
            </a>
          </div>
          <p className="section-copy" style={{ marginTop: 0 }}>
            {finalVideo.objectPath}
          </p>
        </div>
      ) : null}
    </article>
  );
}
