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

  const storyboardMeta = useMemo(() => {
    const event = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'VIDEO_CONCEPT_APPLIED' && entry.detail);
    if (!event?.detail) return null;
    try {
      const parsed = JSON.parse(event.detail) as {
        conceptId?: string;
        moodPreset?: string;
        startFrameStyle?: string;
        startFrameCandidateId?: string;
        startFrameLabel?: string;
      };
      return {
        conceptId: parsed.conceptId ?? 'unknown',
        moodPreset: parsed.moodPreset ?? 'unknown',
        startFrameStyle: parsed.startFrameStyle ?? 'unknown',
        startFrameCandidateId: parsed.startFrameCandidateId ?? 'unknown',
        startFrameLabel: parsed.startFrameLabel ?? parsed.startFrameStyle ?? 'unknown'
      };
    } catch {
      return null;
    }
  }, [job]);

  const userControlsMeta = useMemo(() => {
    const event = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'USER_CONTROLS_ENFORCED' && entry.detail);
    if (!event?.detail) return null;

    try {
      const parsed = JSON.parse(event.detail) as {
        ctaStrength?: string;
        motionIntensity?: string;
        shotPace?: string;
        visualStyle?: string;
      };
      return {
        ctaStrength: parsed.ctaStrength ?? 'balanced',
        motionIntensity: parsed.motionIntensity ?? 'medium',
        shotPace: parsed.shotPace ?? 'balanced',
        visualStyle: parsed.visualStyle ?? 'clean'
      };
    } catch {
      return null;
    }
  }, [job]);

  const motionMeta = useMemo(() => {
    const enforced = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'MOTION_ENFORCED' && entry.detail);
    const finalMotion = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'FINAL_MOTION_OK' && entry.detail);

    const parse = (detail?: string) => {
      if (!detail) return null;
      try {
        return JSON.parse(detail) as {
          motionPhases?: number;
          minPhasesRequired?: number;
          longestStaticSeconds?: number;
          maxStaticSecondsAllowed?: number;
          attempts?: number;
          withinThreshold?: boolean;
        };
      } catch {
        return null;
      }
    };

    return {
      enforced: parse(enforced?.detail),
      final: parse(finalMotion?.detail)
    };
  }, [job]);

  const finalSyncMeta = useMemo(() => {
    const event = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'FINAL_SYNC_OK' && entry.detail);
    if (!event?.detail) return null;

    try {
      const parsed = JSON.parse(event.detail) as {
        mode?: string;
        tempo?: number;
        targetSeconds?: number;
        outputSeconds?: number;
        avDeltaSeconds?: number;
      };
      return {
        mode: String(parsed.mode ?? 'unknown'),
        tempo: Number(parsed.tempo ?? 1),
        targetSeconds: Number(parsed.targetSeconds ?? 0),
        outputSeconds: Number(parsed.outputSeconds ?? 0),
        avDeltaSeconds: Number(parsed.avDeltaSeconds ?? 0)
      };
    } catch {
      return null;
    }
  }, [job]);

  const captionSafeAreaMeta = useMemo(() => {
    const event = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'CAPTION_SAFE_AREA_APPLIED' && entry.detail);
    if (!event?.detail) return null;

    try {
      const parsed = JSON.parse(event.detail) as {
        scale?: number;
        marginX?: number;
        marginY?: number;
        safeWidth?: number;
        safeHeight?: number;
      };
      return {
        scale: Number(parsed.scale ?? 0),
        marginX: Number(parsed.marginX ?? 0),
        marginY: Number(parsed.marginY ?? 0),
        safeWidth: Number(parsed.safeWidth ?? 0),
        safeHeight: Number(parsed.safeHeight ?? 0)
      };
    } catch {
      return null;
    }
  }, [job]);

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

      {storyboardMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-neutral">Mood: {storyboardMeta.moodPreset}</span>
          <span className="chip chip-neutral">Concept: {storyboardMeta.conceptId}</span>
          <span className="chip chip-neutral">Startframe: {storyboardMeta.startFrameLabel}</span>
          <span className="chip chip-neutral">Candidate: {storyboardMeta.startFrameCandidateId}</span>
        </div>
      ) : null}

      {userControlsMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-neutral">Controls</span>
          <span className="chip chip-neutral">CTA: {userControlsMeta.ctaStrength}</span>
          <span className="chip chip-neutral">Motion: {userControlsMeta.motionIntensity}</span>
          <span className="chip chip-neutral">Pace: {userControlsMeta.shotPace}</span>
          <span className="chip chip-neutral">Style: {userControlsMeta.visualStyle}</span>
        </div>
      ) : null}

      {finalSyncMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-success">Final Sync: {finalSyncMeta.avDeltaSeconds.toFixed(3)}s Drift</span>
          <span className="chip chip-neutral">Mode: {finalSyncMeta.mode}</span>
          <span className="chip chip-neutral">Tempo: {finalSyncMeta.tempo.toFixed(3)}x</span>
          <span className="chip chip-neutral">
            Dauer: {finalSyncMeta.outputSeconds.toFixed(2)}s / Ziel {finalSyncMeta.targetSeconds.toFixed(2)}s
          </span>
        </div>
      ) : null}

      {motionMeta.enforced || motionMeta.final ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          {motionMeta.enforced ? (
            <span className={`chip ${motionMeta.enforced.withinThreshold ? 'chip-success' : 'chip-warning'}`}>
              Motion Guard: {motionMeta.enforced.motionPhases ?? 0}/{motionMeta.enforced.minPhasesRequired ?? 0} Phasen
            </span>
          ) : null}
          {motionMeta.enforced ? (
            <span className="chip chip-neutral">
              Statisch max: {(motionMeta.enforced.longestStaticSeconds ?? 0).toFixed(2)}s / {(motionMeta.enforced.maxStaticSecondsAllowed ?? 0).toFixed(2)}s
            </span>
          ) : null}
          {motionMeta.enforced ? (
            <span className="chip chip-neutral">Attempts: {motionMeta.enforced.attempts ?? 1}</span>
          ) : null}
          {motionMeta.final ? (
            <span className="chip chip-success">Final Motion checked</span>
          ) : null}
        </div>
      ) : null}

      {captionSafeAreaMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-success">Caption Safe Area angewendet</span>
          <span className="chip chip-neutral">Scale: {captionSafeAreaMeta.scale.toFixed(3)}</span>
          <span className="chip chip-neutral">
            Ränder: {captionSafeAreaMeta.marginX}px / {captionSafeAreaMeta.marginY}px
          </span>
          <span className="chip chip-neutral">
            Fläche: {captionSafeAreaMeta.safeWidth}×{captionSafeAreaMeta.safeHeight}
          </span>
        </div>
      ) : null}

      <ul className="list-clean" aria-label="Runtime timeline">
        {(job?.timeline ?? []).slice(-10).reverse().map((event) => (
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
