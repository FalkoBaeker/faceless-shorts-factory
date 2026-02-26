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

const stateChipTone: Record<JobUiState, string> = {
  loading: 'chip-neutral',
  empty: 'chip-neutral',
  progress: 'chip-warning',
  ready: 'chip-success',
  error: 'chip-danger'
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
        <button className="button" type="button" aria-label="Download Demo Asset">
          Download final.mp4
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
            Laufzeitstatus, Queue-Metriken und Ergebniszustände auf einen Blick.
          </h1>
        </div>
        <p className="hero-text">
          Diese Seite zeigt alle relevanten Zustände für den späteren Live-Betrieb: Loading, Empty,
          Progress, Ready und Error.
        </p>
        <div className="action-row">
          <span className={`chip ${stateChipTone[currentState]}`}>
            Aktiver Zustand: {jobStateLabels[currentState]}
          </span>
          <span className="chip chip-neutral">Provider: {queueMetricsMock.provider}</span>
        </div>
      </section>

      <section className="section-card" style={{ marginBottom: 12 }} aria-label="State Switcher">
        <h2 className="section-title">State Preview</h2>
        <p className="section-copy">Zum schnellen UI-Check kannst du jeden Zustand einzeln anzeigen.</p>
        <div className="state-toggle-row" role="tablist" aria-label="Job state toggles">
          {jobStateOrder.map((state) => (
            <Link
              key={state}
              href={`/job-status?state=${state}`}
              className={`state-toggle ${currentState === state ? 'active' : ''}`}
              role="tab"
              aria-selected={currentState === state}
              aria-controls="job-state-panel"
            >
              {jobStateLabels[state]}
            </Link>
          ))}
        </div>
      </section>

      <div id="job-state-panel" style={{ marginBottom: 12 }}>
        {statePanel[currentState]}
      </div>

      <div style={{ marginBottom: 12 }}>
        <JobRuntimePanel initialJobId={jobIdParam ?? ''} />
      </div>

      <section className="section-card" aria-labelledby="metrics-title">
        <h2 id="metrics-title" className="section-title">
          Queue & Runtime Metrics (Mock)
        </h2>
        <dl className="status-grid">
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

        <div className="action-row" style={{ marginTop: 2 }}>
          <Link href="/review" className="button-ghost">
            Zurück zu Review
          </Link>
          <Link href="/" className="button-ghost">
            Neuer Wizard-Start
          </Link>
        </div>
      </section>

      <div className="sticky-cta" role="complementary" aria-label="Primary mobile action">
        <Link href="/job-status?state=ready" className="button">
          Ready-State anzeigen
        </Link>
      </div>
    </PageFrame>
  );
}
