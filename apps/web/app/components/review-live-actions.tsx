'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, selectConcept, triggerGenerate, type ApiError } from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

const conceptOptions = [
  {
    id: 'concept_web_vertical_slice',
    label: 'Vertical Slice',
    description: 'Klassischer Hook → Nutzenpunkte → klarer CTA.'
  },
  {
    id: 'concept_offer_focus',
    label: 'Angebot im Fokus',
    description: 'Starker Offer-Hook mit Preis-/Mehrwert-Fokus.'
  },
  {
    id: 'concept_problem_solution',
    label: 'Problem → Lösung',
    description: 'Typisches Problem zeigen und kurz lösen.'
  },
  {
    id: 'concept_before_after',
    label: 'Vorher / Nachher',
    description: 'Direkter Kontrast mit klarer Verbesserung.'
  },
  {
    id: 'concept_testimonial',
    label: 'Kundenstimme',
    description: 'Social Proof + Beweis + CTA.'
  }
] as const;

type ConceptId = (typeof conceptOptions)[number]['id'];

const startFrameOptions = [
  {
    id: 'storefront_hero',
    label: 'Storefront Hero',
    description: 'Laden/Brand als klarer Startframe.'
  },
  {
    id: 'product_macro',
    label: 'Produkt-Makro',
    description: 'Detailaufnahme des Kernprodukts.'
  },
  {
    id: 'owner_portrait',
    label: 'Owner Portrait',
    description: 'Persönlicher Start mit Vertrauenssignal.'
  },
  {
    id: 'hands_at_work',
    label: 'Hands at Work',
    description: 'Handwerk/Arbeitsprozess als Einstieg.'
  },
  {
    id: 'before_after_split',
    label: 'Before/After Split',
    description: 'Vorher-Nachher schon im ersten Frame.'
  }
] as const;

type StartFrameStyle = (typeof startFrameOptions)[number]['id'];

const asApiMessage = (error: unknown) => {
  const api = error as Partial<ApiError>;
  return api?.message ?? String(error);
};

export function ReviewLiveActions() {
  const router = useRouter();
  const [topic, setTopic] = useState('Sommerangebot für lokale Bäckerei in Berlin');
  const [variantType, setVariantType] = useState<'SHORT_15' | 'MASTER_30'>('SHORT_15');
  const [conceptId, setConceptId] = useState<ConceptId>('concept_web_vertical_slice');
  const [startFrameStyle, setStartFrameStyle] = useState<StartFrameStyle>('storefront_hero');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const selectedConceptLabel = useMemo(
    () => conceptOptions.find((option) => option.id === conceptId)?.label ?? conceptId,
    [conceptId]
  );

  const selectedStartFrameLabel = useMemo(
    () => startFrameOptions.find((option) => option.id === startFrameStyle)?.label ?? startFrameStyle,
    [startFrameStyle]
  );

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

      setStatus(`Wähle Storyboard (${selectedConceptLabel}) + Startframe (${selectedStartFrameLabel}) ...`);
      const selection = await selectConcept(token, project.projectId, {
        variantType,
        conceptId,
        startFrameStyle
      });

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
    <article id="live-mvp-flow" className="section-card" aria-labelledby="review-live-title">
      <h2 id="review-live-title" className="section-title">
        Live MVP Flow (ECHTE API-Daten)
      </h2>
      <p className="section-copy">
        Echter End-to-End Pfad: Project → Storyboard/Concept → Generate → Job-Status → Download.
      </p>

      <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="auth-field">
          <span>Topic</span>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Video-Länge
      </h3>
      <div className="state-toggle-row" role="tablist" aria-label="Variant toggle">
        <button
          type="button"
          className={`state-toggle ${variantType === 'SHORT_15' ? 'active' : ''}`}
          onClick={() => setVariantType('SHORT_15')}
        >
          SHORT_15 (15s)
        </button>
        <button
          type="button"
          className={`state-toggle ${variantType === 'MASTER_30' ? 'active' : ''}`}
          onClick={() => setVariantType('MASTER_30')}
        >
          MASTER_30 (30s)
        </button>
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Storyboard / Concept
      </h3>
      <div className="chip-wrap" role="list" aria-label="Concept Auswahl">
        {conceptOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`state-toggle ${conceptId === option.id ? 'active' : ''}`}
            onClick={() => setConceptId(option.id)}
            aria-pressed={conceptId === option.id}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        {conceptOptions.find((option) => option.id === conceptId)?.description}
      </p>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Startframe
      </h3>
      <div className="chip-wrap" role="list" aria-label="Startframe Auswahl">
        {startFrameOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`state-toggle ${startFrameStyle === option.id ? 'active' : ''}`}
            onClick={() => setStartFrameStyle(option.id)}
            aria-pressed={startFrameStyle === option.id}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        {startFrameOptions.find((option) => option.id === startFrameStyle)?.description}
      </p>

      <div className="action-row">
        <button className="button" type="button" disabled={busy} onClick={runFlow}>
          {busy ? 'Flow läuft ...' : 'Echten Video-Flow starten'}
        </button>
      </div>

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}
    </article>
  );
}
