'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  fetchJob,
  fetchJobAssets,
  triggerAlertTest,
  type ApiError,
  type JobAssetsPayload,
  type JobPayload,
  type JobStatus
} from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

type Props = {
  initialJobId: string;
};

const asApiMessage = (error: unknown) => {
  const api = error as Partial<ApiError>;
  return api?.message ?? String(error);
};

const pendingStatuses: JobStatus[] = [
  'DRAFT',
  'IDEATION_PENDING',
  'IDEATION_READY',
  'STORYBOARD_PENDING',
  'STORYBOARD_READY',
  'SELECTED',
  'VIDEO_PENDING',
  'AUDIO_PENDING',
  'ASSEMBLY_PENDING',
  'RENDERING',
  'PUBLISH_PENDING'
];

const isPendingStatus = (status?: JobStatus | null) => Boolean(status && pendingStatuses.includes(status));

const userFacingStatus = (status?: JobStatus | null) => {
  if (!status) {
    return {
      title: 'Warte auf Job-Status',
      copy: 'Sobald eine Job-ID vorhanden ist, wird der Laufzeitstatus geladen.',
      chip: 'WARTET',
      tone: 'chip-neutral'
    };
  }

  if (status === 'READY' || status === 'PUBLISHED') {
    return {
      title: 'Video ist bereit',
      copy: 'Dein Render ist abgeschlossen. Du kannst jetzt direkt die MP4 herunterladen.',
      chip: status,
      tone: 'chip-success'
    };
  }

  if (status === 'FAILED') {
    return {
      title: 'Erstellung fehlgeschlagen',
      copy: 'Der Job ist in einen Fehler gelaufen. Prüfe unten die Diagnose und starte bei Bedarf neu.',
      chip: status,
      tone: 'chip-danger'
    };
  }

  return {
    title: 'Video wird erstellt ...',
    copy: 'Typisch 2–4 Minuten. Du kannst die technischen Details bei Bedarf aufklappen.',
    chip: 'IN PROGRESS',
    tone: 'chip-warning'
  };
};

export function JobRuntimePanel({ initialJobId }: Props) {
  const [jobId, setJobId] = useState(initialJobId);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [assets, setAssets] = useState<JobAssetsPayload | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertResult, setAlertResult] = useState('');
  const [downloadState, setDownloadState] = useState<'idle' | 'success' | 'error'>('idle');
  const [downloadMessage, setDownloadMessage] = useState('');
  const [finalSoraPrompt, setFinalSoraPrompt] = useState('');
  const [finalSoraPromptStatus, setFinalSoraPromptStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

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
      setStatus(userFacingStatus(current.status).copy);

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

  const finalSoraPromptAsset = useMemo(() => {
    const entries = assets?.assets ?? [];
    return (
      entries.find((entry) => entry.kind === 'sora_prompt_step2') ??
      entries.find((entry) => entry.kind === 'sora_prompt_step1') ??
      null
    );
  }, [assets]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!finalSoraPromptAsset?.signedUrl) {
        setFinalSoraPrompt('');
        setFinalSoraPromptStatus('idle');
        return;
      }

      setFinalSoraPromptStatus('loading');
      try {
        const res = await fetch(finalSoraPromptAsset.signedUrl, { cache: 'no-store' });
        const text = await res.text();
        if (!res.ok) throw new Error(`PROMPT_FETCH_FAILED:${res.status}`);
        if (!cancelled) {
          setFinalSoraPrompt(text.trim());
          setFinalSoraPromptStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          setFinalSoraPrompt(`Prompt konnte nicht geladen werden: ${asApiMessage(error)}`);
          setFinalSoraPromptStatus('error');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [finalSoraPromptAsset]);

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
        startFrameMode?: string;
        effectiveStartFrameSource?: string;
        precedenceRuleApplied?: string;
        startFrameReferenceObjectPath?: string | null;
      };
      return {
        conceptId: parsed.conceptId ?? 'unknown',
        moodPreset: parsed.moodPreset ?? 'unknown',
        startFrameStyle: parsed.startFrameStyle ?? 'unknown',
        startFrameCandidateId: parsed.startFrameCandidateId ?? 'unknown',
        startFrameLabel: parsed.startFrameLabel ?? parsed.startFrameStyle ?? 'unknown',
        startFrameMode: parsed.startFrameMode ?? 'unknown',
        effectiveStartFrameSource: parsed.effectiveStartFrameSource ?? 'unknown',
        precedenceRuleApplied: parsed.precedenceRuleApplied ?? 'UPLOAD_WINS_OVER_CANDIDATE',
        startFrameReferenceObjectPath: parsed.startFrameReferenceObjectPath ?? null
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

  const audioModeMeta = useMemo(() => {
    const event = [...(job?.timeline ?? [])]
      .reverse()
      .find((entry) => entry.event === 'AUDIO_MODE_APPLIED' && entry.detail);
    if (!event?.detail) return null;

    try {
      const parsed = JSON.parse(event.detail) as {
        selectedMode?: string;
        effectiveMode?: string;
        fallbackApplied?: boolean;
        fallbackReason?: string | null;
        sceneAudioDetected?: boolean;
      };
      return {
        selectedMode: parsed.selectedMode ?? 'voiceover',
        effectiveMode: parsed.effectiveMode ?? 'voiceover',
        fallbackApplied: Boolean(parsed.fallbackApplied),
        fallbackReason: parsed.fallbackReason ?? null,
        sceneAudioDetected: Boolean(parsed.sceneAudioDetected)
      };
    } catch {
      return null;
    }
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

  const explainabilityMeta = useMemo(() => job?.explainability ?? null, [job]);

  const currentStatus = (job?.status ?? null) as JobStatus | null;
  const primaryStatus = useMemo(() => userFacingStatus(currentStatus), [currentStatus]);
  const isPending = isPendingStatus(currentStatus);

  const billingMeta = useMemo(() => {
    if (job?.billing) {
      return {
        reserved: job.billing.reservation.reserved,
        reservationAt: job.billing.reservation.at,
        finalState: job.billing.finalization.state,
        finalAt: job.billing.finalization.at,
        note: job.billing.finalization.note,
        entries: job.billing.entries
      };
    }

    const timeline = job?.timeline ?? [];
    const reservedEvent = timeline.find((entry) => entry.event === 'BILLING_CREDIT_RESERVED');
    const releasedEvent = [...timeline].reverse().find((entry) => entry.event === 'BILLING_CREDIT_RELEASED');
    const committedEvent = [...timeline].reverse().find((entry) => entry.event === 'BILLING_CREDIT_COMMITTED');

    return {
      reserved: Boolean(reservedEvent),
      reservationAt: reservedEvent?.at ?? null,
      finalState: committedEvent ? 'COMMITTED' : releasedEvent ? 'RELEASED' : 'PENDING',
      finalAt: committedEvent?.at ?? releasedEvent?.at ?? null,
      note: committedEvent?.detail ?? releasedEvent?.detail ?? null,
      entries: []
    };
  }, [job]);

  const handleDownload = async () => {
    if (!finalVideo?.signedUrl) {
      setDownloadState('error');
      setDownloadMessage('Kein Download-Link gefunden.');
      return;
    }

    try {
      const anchor = document.createElement('a');
      anchor.href = finalVideo.signedUrl;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      anchor.download = `${jobId || 'faceless-short'}.mp4`;
      anchor.click();
      setDownloadState('success');
      setDownloadMessage('Download gestartet.');
    } catch (error) {
      setDownloadState('error');
      setDownloadMessage(`Download fehlgeschlagen: ${asApiMessage(error)}`);
    }
  };

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
      <p className="section-copy">Mit Job-ID werden echte API-Daten abgefragt. Hier siehst du den Live-Status, Download und Billing-Transparenz.</p>

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

      <section className="section-card" aria-live="polite" aria-busy={isPending}>
        <div className="action-row" style={{ marginTop: 0 }}>
          <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
            {primaryStatus.title}
          </h3>
          <span className={`chip ${primaryStatus.tone}`}>{primaryStatus.chip}</span>
        </div>
        <p className="section-copy" style={{ marginTop: 0 }}>{primaryStatus.copy}</p>

        {isPending ? (
          <div className="pending-indicator" aria-hidden="true">
            <div className="pending-indicator-bar" />
          </div>
        ) : null}

        <div className="action-row" style={{ marginTop: 0 }}>
          <span className={`chip ${billingMeta.reserved ? 'chip-success' : 'chip-warning'}`}>
            Credit reserviert: {billingMeta.reserved ? 'ja' : 'nein'}
          </span>
          <span className="chip chip-neutral">Finalisierung: {billingMeta.finalState}</span>
          {billingMeta.finalAt ? <span className="chip chip-neutral">Zeit: {billingMeta.finalAt}</span> : null}
        </div>
      </section>

      {finalVideo ? (
        <section className="section-card" style={{ marginTop: 4 }} aria-live="polite">
          <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
            Export bereit
          </h3>
          <p className="section-copy">Finales Asset liegt vor und kann heruntergeladen werden.</p>
          <div className="action-row">
            <button className="button" type="button" aria-label="Download MP4" onClick={() => void handleDownload()}>
              Download MP4
            </button>
            <a className="button-ghost" href={finalVideo.signedUrl} target="_blank" rel="noreferrer">
              In neuem Tab öffnen
            </a>
          </div>
          {downloadMessage ? (
            <p className={`section-copy ${downloadState === 'error' ? 'status-error' : 'status-success'}`} style={{ marginTop: 0 }}>
              {downloadMessage}
            </p>
          ) : null}
          <p className="section-copy" style={{ marginTop: 0 }}>
            {finalVideo.objectPath}
          </p>
        </section>
      ) : null}

      {finalSoraPromptAsset ? (
        <section className="section-card" style={{ marginTop: 4 }} aria-live="polite">
          <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
            Final verwendeter Sora-Prompt
          </h3>
          <p className="section-copy">
            Quelle: {finalSoraPromptAsset.kind === 'sora_prompt_step2' ? 'Step2 (inkl. User-Edit)' : 'Step1 (ohne Step2-Override)'}
          </p>
          <textarea
            readOnly
            value={
              finalSoraPromptStatus === 'loading'
                ? 'Lade Prompt ...'
                : finalSoraPrompt || 'Kein Prompt-Inhalt verfügbar.'
            }
            rows={14}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <p className="section-copy" style={{ marginTop: 0 }}>
            {finalSoraPromptAsset.objectPath}
          </p>
        </section>
      ) : null}

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}
      {alertResult ? <p className="section-copy" style={{ marginTop: 0 }}>{alertResult}</p> : null}

      <details className="section-card" style={{ marginTop: 0 }}>
        <summary className="section-title" style={{ cursor: 'pointer' }}>Technische Details / Diagnose</summary>

        {storyboardMeta ? (
          <div className="action-row" style={{ marginTop: 0 }}>
            <span className="chip chip-neutral">Mood: {storyboardMeta.moodPreset}</span>
            <span className="chip chip-neutral">Concept: {storyboardMeta.conceptId}</span>
            <span className="chip chip-neutral">Startframe: {storyboardMeta.startFrameLabel}</span>
            <span className="chip chip-neutral">Source: {storyboardMeta.effectiveStartFrameSource}</span>
            <span className="chip chip-neutral">Mode: {storyboardMeta.startFrameMode}</span>
            <span className="chip chip-neutral">Rule: {storyboardMeta.precedenceRuleApplied}</span>
            <span className="chip chip-neutral">Candidate: {storyboardMeta.startFrameCandidateId}</span>
            {storyboardMeta.startFrameReferenceObjectPath ? (
              <span className="chip chip-neutral">Reference: attached</span>
            ) : null}
          </div>
        ) : null}

        {explainabilityMeta ? (
          <div className="action-row" style={{ marginTop: 0 }}>
            <span className="chip chip-neutral">Hook Rule: {explainabilityMeta.hookRule ?? 'none'}</span>
            <span className="chip chip-neutral">Hook Template: {explainabilityMeta.hookTemplateId ?? 'none'}</span>
            <span className="chip chip-neutral">
              First-second threshold: {explainabilityMeta.firstSecondQualityThreshold ?? 'n/a'}
            </span>
            {explainabilityMeta.imageModel ? (
              <>
                <span className="chip chip-neutral">Image model used: {explainabilityMeta.imageModel.modelUsed ?? 'unknown'}</span>
                <span className="chip chip-neutral">
                  Primary/Fallback: {explainabilityMeta.imageModel.configuredPrimaryModel ?? 'n/a'} / {explainabilityMeta.imageModel.configuredFallbackModel ?? 'n/a'}
                </span>
                <span className={`chip ${explainabilityMeta.imageModel.fallbackUsed ? 'chip-warning' : 'chip-success'}`}>
                  Image fallback: {explainabilityMeta.imageModel.fallbackUsed ? 'yes' : 'no'}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {audioModeMeta ? (
          <div className="action-row" style={{ marginTop: 0 }}>
            <span className="chip chip-neutral">Audio selected: {audioModeMeta.selectedMode}</span>
            <span className="chip chip-neutral">Audio effective: {audioModeMeta.effectiveMode}</span>
            <span className={`chip ${audioModeMeta.fallbackApplied ? 'chip-warning' : 'chip-success'}`}>
              Fallback: {audioModeMeta.fallbackApplied ? 'yes' : 'no'}
            </span>
            {audioModeMeta.fallbackReason ? <span className="chip chip-neutral">Reason: {audioModeMeta.fallbackReason}</span> : null}
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

        {billingMeta.entries.length ? (
          <ul className="list-clean" aria-label="Billing entries">
            {billingMeta.entries.slice(-5).reverse().map((entry) => (
              <li className="step-item" key={entry.id}>
                <div>
                  <p className="step-name">BILLING_{entry.type}</p>
                  <p className="step-sub">{entry.createdAt}</p>
                </div>
                <span className="badge">{entry.amount}</span>
              </li>
            ))}
          </ul>
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
      </details>
    </article>
  );
}
