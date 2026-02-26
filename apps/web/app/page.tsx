import Link from 'next/link';
import { PageFrame } from './components/page-frame';
import {
  availableVariants,
  selectedVariant,
  wizardMeta,
  wizardOverviewCards,
  wizardStepList
} from './lib/mock-data';
import { AuthPanel } from './components/auth-panel';

const prettyStep = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function WizardStartPage() {
  return (
    <PageFrame activePath="/">
      <section className="hero-card" aria-labelledby="wizard-title">
        <div>
          <p className="kicker">Mobile-first Wizard</p>
          <h1 id="wizard-title" className="hero-title">
            Von Idee zu publish-fertigem Short in einem klaren Flow.
          </h1>
        </div>

        <p className="hero-text">
          Einstieg ins MVP. Der echte End-to-End Lauf startet in /review im Block
          „Live MVP Flow (ECHTE API-Daten)“, danach geht es automatisch nach /job-status.
        </p>

        <div className="metrics-grid" aria-label="Wizard Kennzahlen">
          <article className="metric">
            <p className="metric-label">Flow Steps</p>
            <p className="metric-value">{wizardMeta.totalSteps}</p>
          </article>
          <article className="metric">
            <p className="metric-label">Varianten</p>
            <p className="metric-value">{wizardMeta.availableVariants}</p>
          </article>
          <article className="metric">
            <p className="metric-label">Use Case</p>
            <p className="metric-value">SMB Growth</p>
          </article>
        </div>

        <div className="action-row">
          <Link href="/review" className="button">
            Review öffnen
          </Link>
          <Link href="/job-status?state=progress" className="button-ghost">
            Direkt zum Job-Status
          </Link>
        </div>
      </section>

      <div style={{ marginBottom: 12 }}>
        <AuthPanel />
      </div>

      <section className="grid-three" aria-label="Wizard Überblick" style={{ marginBottom: 12 }}>
        {wizardOverviewCards.map((card) => (
          <article className="section-card" key={card.title}>
            <p className="kicker">{card.stepRange}</p>
            <h2 className="section-title">{card.title}</h2>
            <p className="section-copy">{card.description}</p>
          </article>
        ))}
      </section>

      <section className="grid-two" aria-label="Paketvergleich" style={{ marginBottom: 12 }}>
        {availableVariants.map((variant) => (
          <article className="section-card" key={variant.type}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                {variant.title}
              </h2>
              <span className="badge">{variant.tier}</span>
            </div>
            <p className="section-copy">{variant.subtitle}</p>
            <ul className="list-clean" aria-label={`${variant.title} Eigenschaften`}>
              <li className="step-item">
                <div>
                  <p className="step-name">Segment Pattern</p>
                  <p className="step-sub">Planung der Shot-Dauer</p>
                </div>
                <span className="badge">{variant.segmentPattern}</span>
              </li>
              <li className="step-item">
                <div>
                  <p className="step-name">Finale Länge</p>
                  <p className="step-sub">Ausgespielte Asset-Dauer</p>
                </div>
                <span className="badge">{variant.finalSeconds}s</span>
              </li>
            </ul>
          </article>
        ))}
      </section>

      <section className="section-card" aria-labelledby="wizard-steps-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <h2 id="wizard-steps-title" className="section-title" style={{ margin: 0 }}>
            Wizard Steps
          </h2>
          <span className="chip chip-success">Default: {selectedVariant.type}</span>
        </div>

        <ol className="list-clean" style={{ counterReset: 'wizard-step' }}>
          {wizardStepList.map((step, index) => (
            <li className="step-item" key={step}>
              <div>
                <p className="step-name">
                  {index + 1}. {prettyStep(step)}
                </p>
                <p className="step-sub">Teil des End-to-End Flows bis Publish</p>
              </div>
              <span className="badge">active</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="sticky-cta" role="complementary" aria-label="Primary mobile action">
        <Link href="/review" className="button">
          Weiter zu Review
        </Link>
      </div>
    </PageFrame>
  );
}
