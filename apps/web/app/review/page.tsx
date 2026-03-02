import Link from 'next/link';
import { PageFrame } from '../components/page-frame';
import { ReviewLiveActions } from '../components/review-live-actions';
import { reviewMock, selectedVariant } from '../lib/mock-data';

export default function ReviewPreviewPage() {
  return (
    <PageFrame activePath="/review">
      <section className="hero-card" aria-labelledby="review-title">
        <div>
          <p className="kicker">Review / Generate</p>
          <h1 id="review-title" className="hero-title">
            Hier startest du den echten Video-Flow.
          </h1>
        </div>

        <p className="hero-text">
          Fokus auf den Fast-MVP-Pfad: Topic + Branding + Intent setzen, Ablauf generieren und akzeptieren/bearbeiten,
          Startframe wählen und Video erstellen.
        </p>

        <div className="action-row">
          <Link href="#live-mvp-flow" className="button">
            Zum echten Flow (Primär)
          </Link>
          <Link href="/job-status" className="button-ghost">
            Zum Runtime-Status
          </Link>
          <span className="chip chip-success">Real Flow aktiv</span>
          <span className="chip chip-neutral">Variant: {selectedVariant.title}</span>
        </div>
      </section>

      <div style={{ marginBottom: 12 }}>
        <ReviewLiveActions />
      </div>

      <section className="section-card" aria-labelledby="real-flow-checklist" style={{ marginBottom: 12 }}>
        <h2 id="real-flow-checklist" className="section-title">
          Kurze Checkliste
        </h2>

        <ol className="list-clean">
          <li className="step-item">
            <div>
              <p className="step-name">1) Login auf der Startseite</p>
              <p className="step-sub">Buttons: „Login starten“ oder „Signup starten“</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">2) Topic + Branding + Intent setzen, Ablauf generieren und akzeptieren</p>
              <p className="step-sub">Ohne „Ablauf akzeptieren / bearbeiten“ wird Video erstellen blockiert.</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">3) Startframe wählen und Video erstellen</p>
              <p className="step-sub">Danach Statusfolge: VIDEO_PENDING → AUDIO_PENDING → RENDERING → READY</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">4) Export herunterladen</p>
              <p className="step-sub">In /job-status im Block „Real Runtime Status (API, kein Mock)“</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
        </ol>

        <div className="action-row" style={{ marginTop: 8 }}>
          <Link href="/job-status" className="button-ghost">
            Zum Job-Status
          </Link>
          <Link href="/" className="button-ghost">
            Zurück zum Start
          </Link>
        </div>
      </section>

      <details className="section-card" style={{ marginBottom: 12 }}>
        <summary className="section-title" style={{ cursor: 'pointer' }}>
          Optionale Mock-Vorschau anzeigen
        </summary>
        <p className="section-copy">
          Dieser Bereich ist nur UI-Preview und nicht Teil des echten Generierungs-Workflows.
        </p>

        <article className="section-card" aria-labelledby="caption-title" style={{ marginTop: 8 }}>
          <h2 id="caption-title" className="section-title">
            Caption (Mock)
          </h2>
          <p className="caption-box">{reviewMock.caption}</p>

          <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
            Hashtags
          </h3>
          <div className="chip-wrap" role="list" aria-label="Hashtags">
            {reviewMock.hashtags.map((tag) => (
              <span className="badge" key={tag} role="listitem">
                {tag}
              </span>
            ))}
          </div>
        </article>

        <article className="section-card" aria-labelledby="publish-title" style={{ marginTop: 8 }}>
          <h2 id="publish-title" className="section-title">
            Export Targets (Mock)
          </h2>
          <p className="section-copy">Auto-Publish bleibt im MVP deaktiviert.</p>
          <ul className="list-clean" aria-label="Export targets list">
            {reviewMock.postTargets.map((target) => (
              <li className="step-item" key={target}>
                <div>
                  <p className="step-name" style={{ textTransform: 'capitalize' }}>
                    {target}
                  </p>
                  <p className="step-sub">Connector vorbereitet, Live-Posting im MVP deaktiviert</p>
                </div>
                <span className="chip chip-warning">deferred</span>
              </li>
            ))}
          </ul>
        </article>
      </details>
    </PageFrame>
  );
}
