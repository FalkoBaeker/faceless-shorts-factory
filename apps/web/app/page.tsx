const steps = ['onboarding', 'input', 'ideation', 'storyboard', 'selection', 'generation', 'review', 'publish'];

export default function WizardStartPage() {
  return (
    <main>
      <h1>Faceless Shorts Factory — Wizard Start</h1>
      <p>Minimaler Einstieg für den webbasierten Wizard-Flow.</p>
      <ul>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <a href="/review">Zur Review-Preview</a>
    </main>
  );
}
