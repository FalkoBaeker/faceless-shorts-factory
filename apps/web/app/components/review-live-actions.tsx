'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject, createScriptDraft, selectConcept, triggerGenerate, type ApiError } from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

const premium60Enabled = (process.env.NEXT_PUBLIC_ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

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

type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

const moodOptions: Array<{ id: MoodPreset; label: string; description: string }> = [
  {
    id: 'commercial_cta',
    label: 'Commercial mit CTA',
    description: 'Direkt, nutzenorientiert, mit klarem Abschluss-Call-to-Action.'
  },
  {
    id: 'problem_solution',
    label: 'Problem → Lösung',
    description: 'Zeigt erst das Problem und dann die konkrete Lösung.'
  },
  {
    id: 'testimonial',
    label: 'Testimonial',
    description: 'Vertrauensaufbau durch Kundenstimme / Social Proof.'
  },
  {
    id: 'humor_light',
    label: 'Humor light',
    description: 'Leicht humorvoll, aber markenkonform und mit CTA.'
  }
];

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
  const [moodPreset, setMoodPreset] = useState<MoodPreset>('commercial_cta');
  const [conceptId, setConceptId] = useState<ConceptId>('concept_web_vertical_slice');
  const [startFrameStyle, setStartFrameStyle] = useState<StartFrameStyle>('storefront_hero');
  const [scriptDraft, setScriptDraft] = useState('');
  const [scriptAccepted, setScriptAccepted] = useState(false);
  const [scriptMeta, setScriptMeta] = useState<{ targetSeconds: number; estimatedSeconds: number; suggestedWords: number } | null>(null);
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

  const selectedMoodLabel = useMemo(
    () => moodOptions.find((option) => option.id === moodPreset)?.label ?? moodPreset,
    [moodPreset]
  );

  const prepareScript = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    setBusy(true);
    setStatus('Erzeuge Script-Entwurf ...');
    try {
      const draft = await createScriptDraft(token, { topic, variantType, moodPreset });
      setScriptDraft(draft.script);
      setScriptAccepted(false);
      setScriptMeta({
        targetSeconds: draft.targetSeconds,
        estimatedSeconds: draft.estimatedSeconds,
        suggestedWords: draft.suggestedWords
      });
      setStatus(
        draft.withinTarget
          ? `Script bereit (${Math.round(draft.estimatedSeconds)}s von ${draft.targetSeconds}s). Bitte prüfen und akzeptieren.`
          : `Script zu lang (${Math.round(draft.estimatedSeconds)}s). Bitte kürzen oder regenerieren.`
      );
    } catch (error) {
      setStatus(`Script-Entwurf fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptScript = () => {
    if (!scriptDraft.trim()) {
      setStatus('Script ist leer. Bitte zuerst Script erzeugen.');
      return;
    }
    setScriptAccepted(true);
    setStatus('Script akzeptiert. Du kannst jetzt den Flow starten.');
  };

  const runFlow = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    if (!scriptAccepted || !scriptDraft.trim()) {
      setStatus('Bitte zuerst ein Script erzeugen, prüfen und mit "Script akzeptieren" bestätigen.');
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

      setStatus(
        `Wähle Mood (${selectedMoodLabel}), Storyboard (${selectedConceptLabel}) + Startframe (${selectedStartFrameLabel}) ...`
      );
      const selection = await selectConcept(token, project.projectId, {
        variantType,
        conceptId,
        moodPreset,
        approvedScript: scriptDraft.trim(),
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
        Echter End-to-End Pfad: Topic → Mood → Script Review (Pflicht) → Storyboard/Startframe → Generate → Job-Status → Download.
      </p>

      <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="auth-field">
          <span>Topic</span>
          <input
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              setScriptAccepted(false);
            }}
          />
        </label>
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Video-Länge
      </h3>
      <div className="state-toggle-row" role="tablist" aria-label="Variant toggle">
        <button
          type="button"
          className={`state-toggle ${variantType === 'SHORT_15' ? 'active' : ''}`}
          onClick={() => {
            setVariantType('SHORT_15');
            setScriptAccepted(false);
          }}
        >
          STANDARD_30 (30s)
        </button>
        {premium60Enabled ? (
          <button
            type="button"
            className={`state-toggle ${variantType === 'MASTER_30' ? 'active' : ''}`}
            onClick={() => {
              setVariantType('MASTER_30');
              setScriptAccepted(false);
            }}
          >
            PREMIUM_60 (60s)
          </button>
        ) : null}
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Mood / Grundstimmung
      </h3>
      <div className="chip-wrap" role="list" aria-label="Mood Auswahl">
        {moodOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`state-toggle ${moodPreset === option.id ? 'active' : ''}`}
            onClick={() => {
              setMoodPreset(option.id);
              setScriptAccepted(false);
            }}
            aria-pressed={moodPreset === option.id}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        {moodOptions.find((option) => option.id === moodPreset)?.description}
      </p>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Script Review (Pflicht)
      </h3>
      <div className="action-row" style={{ marginTop: 8 }}>
        <button className="button-ghost" type="button" disabled={busy} onClick={prepareScript}>
          Script erzeugen / regenerieren
        </button>
        <button className="button" type="button" disabled={busy || !scriptDraft.trim()} onClick={acceptScript}>
          Script akzeptieren
        </button>
      </div>

      <label className="auth-field" style={{ marginTop: 8 }}>
        <span>Skripttext (editierbar)</span>
        <textarea
          value={scriptDraft}
          onChange={(event) => {
            setScriptDraft(event.target.value);
            setScriptAccepted(false);
          }}
          rows={7}
          placeholder="Erzeuge zuerst einen Script-Entwurf."
        />
      </label>

      {scriptMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-neutral">Target: {scriptMeta.targetSeconds}s</span>
          <span className="chip chip-neutral">Estimate: {Math.round(scriptMeta.estimatedSeconds)}s</span>
          <span className="chip chip-neutral">Wörter Ziel: ~{scriptMeta.suggestedWords}</span>
          <span className={`chip ${scriptAccepted ? 'chip-success' : 'chip-warning'}`}>
            {scriptAccepted ? 'Script akzeptiert' : 'Script noch nicht akzeptiert'}
          </span>
        </div>
      ) : null}

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
        <button className="button" type="button" disabled={busy || !scriptAccepted} onClick={runFlow}>
          {busy ? 'Flow läuft ...' : 'Echten Video-Flow starten'}
        </button>
      </div>

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}
    </article>
  );
}
