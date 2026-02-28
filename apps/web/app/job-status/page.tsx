import Link from 'next/link';
import type { ReactElement } from 'react';
import { JobRuntimePanel } from '../components/job-runtime-panel';
import { PageFrame } from '../components/page-frame';
import {
  jobStateLabels,
  jobStateOrder,
  productionProgressEvents,
  queueMetricsMock,
  type JobUiState
} from '../lib/mock-data';

const resolveState = (value: string | null): JobUiState => {
  if (!value) return 'progress';
  return jobStateOrder.includes(value as JobUiState) ? (value as JobUiState) : 'progress';
};

function LoadingState() {
  return (
    <article className="section-card" aria-live="polite" aria-busy="true">
      <h2 className="section-title">Render Job wird geladen</h2>
      <p className="section-copy">Metadaten werden synchronisiert, danach startet die Queue-Anzeige.</p>
      <div className="list-clean">
        <div className="skeleton long" />
        <div className="skeleton medium" />
        <div className="skeleton short" />
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <article className="section-card">
      <h2 className="section-title">Noch kein aktiver Job</h2>
      <p className="section-copy">
        Starte im Wizard ein Projekt, dann erscheint hier automatisch die Laufzeit-Ansicht.
      </p>
      <div className="action-row">
        <Link href="/" className="button">
          Zum Wizard Start
        </Link>
      </div>
    </article>
  );
}

function ProgressState() {
  return (
    <article className="section-card" aria-live="polite">
      <h2 className="section-title">Job läuft gerade</h2>
      <p className="section-copy">Provider-Jobs werden abgearbeitet. ETA: ca. 2–4 Minuten.</p>

      <div className="progress-track" aria-label="Render progress">
        <div className="progress-fill" />
      </div>

      <ul className="list-clean" aria-label="Pipeline Steps">
        {productionProgressEvents.map((event) => (
          <li className="step-item" key={event.label}>
            <div>
              <p className="step-name">{event.label}</p>
              <p className="step-sub">{event.time}</p>
            </div>
            <span
              className={`chip ${
                event.status === 'done'
                  ? 'chip-success'
                  : event.status === 'active'
                    ? 'chip-warning'
                    : 'chip-neutral'
              }`}
            >
              {event.status}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ReadyState() {
  return (
    <article className="section-card">
      <h2 className="section-title">Job abgeschlossen</h2>
      <p className="section-copy">Asset ist bereit für Download/Export (MVP ohne Auto-Publish).</p>
      <div className="action-row">
        <button className="button-ghost" type="button" aria-label="Download Demo Asset (Mock)">
          Demo-Download (Mock)
        </button>
        <button className="button-ghost" type="button" aria-label="Open export checklist">
          Export prüfen
        </button>
      </div>
      <p className="section-copy" style={{ marginTop: 4 }}>
        Auto-Publish bleibt im MVP deaktiviert, Connector bleibt nachrüstbar.
      </p>
    </article>
  );
}

function ErrorState() {
  return (
    <article className="section-card" aria-live="assertive">
      <h2 className="section-title">Render fehlgeschlagen</h2>
      <p className="section-copy">
        Fehler: <strong>TTS_PROVIDER_TIMEOUT</strong>. Fallback ist verfügbar, Retry kann direkt ausgelöst
        werden.
      </p>
      <div className="action-row">
        <button className="button" type="button" aria-label="Retry failed job">
          Retry mit Fallback
        </button>
        <Link href="/job-status?state=progress" className="button-ghost">
          Zur Progress-Ansicht
        </Link>
      </div>
    </article>
  );
}

const statePanel: Record<JobUiState, ReactElement> = {
  loading: <LoadingState />,
  empty: <EmptyState />,
  progress: <ProgressState />,
  ready: <ReadyState />,
  error: <ErrorState />
};

type SearchParams = Promise<{ state?: string | string[]; jobId?: string | string[] }>;

export default async function JobStatusPage({ searchParams }: { searchParams?: SearchParams }) {
  const resolvedParams = (await searchParams) ?? {};
  const stateParam = Array.isArray(resolvedParams.state) ? resolvedParams.state[0] : resolvedParams.state;
  const jobIdParam = Array.isArray(resolvedParams.jobId) ? resolvedParams.jobId[0] : resolvedParams.jobId;
  const currentState = resolveState(stateParam ?? null);

  return (
    <PageFrame activePath="/job-status">
      <section className="hero-card" aria-labelledby="status-title">
        <div>
          <p className="kicker">Job Status</p>
          <h1 id="status-title" className="hero-title">
            Reale Laufzeitdaten und Download an einem Ort.
          </h1>
        </div>
        <p className="hero-text">
          Nutze primär den Block „Real Runtime Status (API, kein Mock)“. Dort läuft die echte Polling-Ansicht für
          deinen Job.
        </p>
        <div className="action-row">
          <span className="chip chip-success">Real Runtime aktiv</span>
          <Link href="/review" className="button">
            Neuen echten Flow starten
          </Link>
        </div>
      </section>

      <div style={{ marginBottom: 12 }}>
        <JobRuntimePanel initialJobId={jobIdParam ?? ''} />
      </div>

      <details className="section-card" style={{ marginBottom: 12 }}>
        <summary className="section-title" style={{ cursor: 'pointer' }}>
          Optionale State Preview (Mock) öffnen
        </summary>
        <p className="section-copy">Nur für visuelle UI-Checks, nicht der echte Runtime-Flow.</p>

        <div className="state-toggle-row" role="tablist" aria-label="Job state toggles">
          {jobStateOrder.map((state) => (
            <Link
              key={state}
              href={`/job-status?state=${state}${jobIdParam ? `&jobId=${encodeURIComponent(jobIdParam)}` : ''}`}
              className={`state-toggle ${currentState === state ? 'active' : ''}`}
              role="tab"
              aria-selected={currentState === state}
              aria-controls="job-state-panel"
            >
              {jobStateLabels[state]}
            </Link>
          ))}
        </div>

        <div id="job-state-panel" style={{ marginTop: 10 }}>
          {statePanel[currentState]}
        </div>
      </details>

      <details className="section-card" aria-labelledby="metrics-title" style={{ marginBottom: 12 }}>
        <summary id="metrics-title" className="section-title" style={{ cursor: 'pointer' }}>
          Queue & Runtime Metrics (Mock)
        </summary>
        <dl className="status-grid" style={{ marginTop: 10 }}>
          <div className="status-kpi">
            <dt>Queue Depth</dt>
            <dd>{queueMetricsMock.queueDepth}</dd>
          </div>
          <div className="status-kpi">
            <dt>Ø Render Time</dt>
            <dd>{queueMetricsMock.avgRenderTimeSec}s</dd>
          </div>
          <div className="status-kpi">
            <dt>Retry Budget</dt>
            <dd>{queueMetricsMock.retryBudgetLeft}</dd>
          </div>
        </dl>
      </details>

      <section className="section-card" aria-label="Navigation">
        <div className="action-row">
          <Link href="/review" className="button">
            Zum echten Review-Flow
          </Link>
          <Link href="/" className="button-ghost">
            Neuer Wizard-Start
          </Link>
        </div>
      </section>
    </PageFrame>
  );
}
