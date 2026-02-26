import Link from 'next/link';
import { PageFrame } from '../components/page-frame';
import { ReviewLiveActions } from '../components/review-live-actions';
import { reviewMock, selectedVariant } from '../lib/mock-data';

export default function ReviewPreviewPage() {
  return (
    <PageFrame activePath="/review">
      <section className="hero-card" aria-labelledby="review-title">
        <div>
          <p className="kicker">Review Preview</p>
          <h1 id="review-title" className="hero-title">
            Inhalte prüfen, Feinschliff setzen und dann in den Export-Flow wechseln.
          </h1>
        </div>

        <p className="hero-text">
          Wichtig: Große Teile dieser Seite sind Preview-/Mock-UI. Der echte API-Flow startet nur im Block
          <strong> „Live MVP Flow (ECHTE API-Daten)“</strong> weiter unten.
        </p>

        <div className="action-row">
          <span className="chip chip-success">Status: {reviewMock.status}</span>
          <span className="chip chip-neutral">Variant: {selectedVariant.title}</span>
          <span className="chip chip-neutral">Job: {reviewMock.jobId}</span>
        </div>
      </section>

      <section className="section-card" aria-labelledby="real-flow-title" style={{ marginBottom: 12 }}>
        <h2 id="real-flow-title" className="section-title">
          So testest du den echten Flow
        </h2>
        <ol className="list-clean">
          <li className="step-item">
            <div>
              <p className="step-name">1) Auf der Startseite einloggen</p>
              <p className="step-sub">Buttons: „Login starten“ oder „Signup starten“</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">2) Topic setzen und „Echten Video-Flow starten“ klicken</p>
              <p className="step-sub">Block: „Live MVP Flow (ECHTE API-Daten)“</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">3) Auf /job-status bis READY warten</p>
              <p className="step-sub">Erwartete Statusfolge: VIDEO_PENDING → AUDIO_PENDING → RENDERING → READY</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
          <li className="step-item">
            <div>
              <p className="step-name">4) „Export herunterladen“ klicken</p>
              <p className="step-sub">Signed URL wird direkt geöffnet</p>
            </div>
            <span className="chip chip-success">real</span>
          </li>
        </ol>

        <div className="action-row" style={{ marginTop: 8 }}>
          <Link href="#live-mvp-flow" className="button">
            Zum Live-Flow-Block springen
          </Link>
        </div>
      </section>

      <section className="grid-two" style={{ marginBottom: 12 }}>
        <article className="section-card" aria-labelledby="preview-panel-title">
          <h2 id="preview-panel-title" className="section-title">
            Video Preview (Mock)
          </h2>
          <p className="section-copy">Platzhalter für späteren Player mit Frame-Scrubber und Audio-Mute.</p>
          <div
            aria-label="Video preview placeholder"
            style={{
              minHeight: 220,
              borderRadius: 14,
              border: '1px solid rgba(136, 155, 235, 0.28)',
              background:
                'linear-gradient(130deg, rgba(123,141,255,0.24), rgba(87,211,255,0.16), rgba(136,155,235,0.1))',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <span className="badge">30s Master Preview</span>
          </div>
        </article>

        <article className="section-card" aria-labelledby="qa-panel-title">
          <h2 id="qa-panel-title" className="section-title">
            Quick Quality Check (Mock)
          </h2>
          <ul className="list-clean">
            <li className="step-item">
              <div>
                <p className="step-name">Hook klar in den ersten 2 Sekunden</p>
                <p className="step-sub">Text + Visual greifen direkt</p>
              </div>
              <span className="chip chip-success">ok</span>
            </li>
            <li className="step-item">
              <div>
                <p className="step-name">Voiceover passt zum Shot-Timing</p>
                <p className="step-sub">Keine hörbare Lücke im Übergang</p>
              </div>
              <span className="chip chip-success">ok</span>
            </li>
            <li className="step-item">
              <div>
                <p className="step-name">Brand-CTA ist konkret genug</p>
                <p className="step-sub">Kontaktweg + nächster Schritt sichtbar</p>
              </div>
              <span className="chip chip-warning">check</span>
            </li>
          </ul>
        </article>
      </section>

      <section className="grid-two" style={{ marginBottom: 12 }}>
        <article className="section-card" aria-labelledby="caption-title">
          <h2 id="caption-title" className="section-title">
            Caption
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

        <article className="section-card" aria-labelledby="publish-title">
          <h2 id="publish-title" className="section-title">
            Export Targets (Auto-Publish später)
          </h2>
          <p className="section-copy">MVP liefert Assets exportbereit, Social-Posting bleibt deaktiviert.</p>
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

          <p className="section-copy" style={{ marginTop: 4 }}>
            CTA: <strong>{reviewMock.ctaText}</strong>
          </p>
        </article>
      </section>

      <div style={{ marginBottom: 12 }}>
        <ReviewLiveActions />
      </div>

      <section className="section-card" aria-label="Review actions">
        <div className="action-row">
          <Link href="/" className="button-ghost">
            Zurück zum Start
          </Link>
          <Link href="/job-status?state=progress" className="button">
            Job-Status öffnen
          </Link>
          <Link href="/job-status?state=error" className="button-ghost">
            Error-State ansehen
          </Link>
        </div>
      </section>

      <div className="sticky-cta" role="complementary" aria-label="Primary mobile action">
        <Link href="/job-status?state=progress" className="button">
          Weiter zu Job-Status
        </Link>
      </div>
    </PageFrame>
  );
}
