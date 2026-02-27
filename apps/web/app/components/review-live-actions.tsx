'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createProject,
  createScriptDraft,
  createStartFrameCandidates,
  selectConcept,
  triggerGenerate,
  type ApiError,
  type StartFrameCandidatePayload
} from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

const premium60Enabled = (process.env.NEXT_PUBLIC_ENABLE_PREMIUM_60 ?? 'false').trim().toLowerCase() === 'true';

const conceptOptions = [
  {
    id: 'concept_web_vertical_slice',
    label: 'Vertical Slice',
    whatHappens: 'Hook, dann kurze Nutzenpunkte, dann klarer CTA.',
    primary: true
  },
  {
    id: 'concept_offer_focus',
    label: 'Angebot im Fokus',
    whatHappens: 'Startet mit Offer-Highlight und endet mit Handlungsdruck.',
    primary: true
  },
  {
    id: 'concept_problem_solution',
    label: 'Problem → Lösung',
    whatHappens: 'Zeigt erst Schmerzpunkt, dann direkte Lösung in zwei Steps.',
    primary: true
  },
  {
    id: 'concept_before_after',
    label: 'Vorher / Nachher',
    whatHappens: 'Öffnet mit sichtbarem Kontrast und schließt mit Wirkung + CTA.',
    primary: true
  },
  {
    id: 'concept_testimonial',
    label: 'Kundenstimme',
    whatHappens: 'Beginnt mit Testimonial-Zitat, dann Beweisbild und CTA.',
    primary: false
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
  const [startFrameCandidates, setStartFrameCandidates] = useState<StartFrameCandidatePayload[]>([]);
  const [selectedStartFrameCandidateId, setSelectedStartFrameCandidateId] = useState('');
  const [scriptDraft, setScriptDraft] = useState('');
  const [scriptAccepted, setScriptAccepted] = useState(false);
  const [scriptMeta, setScriptMeta] = useState<{ targetSeconds: number; estimatedSeconds: number; suggestedWords: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [startFrameBusy, setStartFrameBusy] = useState(false);
  const [status, setStatus] = useState('');

  const primaryConceptOptions = useMemo(() => conceptOptions.filter((option) => option.primary), []);
  const advancedConceptOptions = useMemo(() => conceptOptions.filter((option) => !option.primary), []);

  const selectedConcept = useMemo(() => conceptOptions.find((option) => option.id === conceptId) ?? conceptOptions[0], [conceptId]);

  const selectedMoodLabel = useMemo(
    () => moodOptions.find((option) => option.id === moodPreset)?.label ?? moodPreset,
    [moodPreset]
  );

  const selectedStartFrameCandidate = useMemo(
    () => startFrameCandidates.find((candidate) => candidate.candidateId === selectedStartFrameCandidateId) ?? null,
    [startFrameCandidates, selectedStartFrameCandidateId]
  );

  const resetStartFrameCandidates = () => {
    setStartFrameCandidates([]);
    setSelectedStartFrameCandidateId('');
  };

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
      resetStartFrameCandidates();
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
    setStatus('Script akzeptiert. Als Nächstes: Startframe-Kandidaten erzeugen und einen auswählen.');
  };

  const prepareStartFrames = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    if (!scriptAccepted) {
      setStatus('Bitte zuerst Script akzeptieren, bevor du Startframe-Kandidaten erzeugst.');
      return;
    }

    setStartFrameBusy(true);
    setStatus(`Erzeuge Startframe-Kandidaten für ${selectedConcept.label} ...`);
    try {
      const response = await createStartFrameCandidates(token, {
        topic,
        conceptId,
        moodPreset,
        limit: 3
      });

      setStartFrameCandidates(response.candidates);
      setSelectedStartFrameCandidateId('');
      setStatus('Startframe-Kandidaten bereit. Bitte wähle einen Candidate aus.');
    } catch (error) {
      setStatus(`Startframe-Kandidaten fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setStartFrameBusy(false);
    }
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

    if (!selectedStartFrameCandidate) {
      setStatus('Bitte zuerst Startframe-Kandidaten erzeugen und genau einen auswählen.');
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
        `Wähle final Storyboard (${selectedConcept.label}) + Startframe (${selectedStartFrameCandidate.label}) und starte Render ...`
      );
      const selection = await selectConcept(token, project.projectId, {
        variantType,
        conceptId,
        moodPreset,
        approvedScript: scriptDraft.trim(),
        startFrameCandidateId: selectedStartFrameCandidate.candidateId,
        startFrameStyle: selectedStartFrameCandidate.style
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
        Echter End-to-End Pfad: Topic → Mood → Script Review (Pflicht) → Concept (Primary-first) → Startframe-Candidates (Pflicht) → Generate → Job-Status → Download.
      </p>

      <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="auth-field">
          <span>Topic</span>
          <input
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              setScriptAccepted(false);
              resetStartFrameCandidates();
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
            resetStartFrameCandidates();
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
              resetStartFrameCandidates();
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
              resetStartFrameCandidates();
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
            resetStartFrameCandidates();
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
        Storyboard / Concept (Primary)
      </h3>
      <div className="chip-wrap" role="list" aria-label="Concept Auswahl (Primary)">
        {primaryConceptOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`state-toggle ${conceptId === option.id ? 'active' : ''}`}
            onClick={() => {
              setConceptId(option.id);
              resetStartFrameCandidates();
            }}
            aria-pressed={conceptId === option.id}
            title={option.whatHappens}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        {selectedConcept.whatHappens}
      </p>

      <details className="section-card" style={{ marginTop: 0 }}>
        <summary className="section-title" style={{ cursor: 'pointer' }}>
          Erweiterte Concept-Optionen
        </summary>
        <p className="section-copy">Optional für feinere Narrative-Varianten.</p>
        <div className="chip-wrap" role="list" aria-label="Concept Auswahl (Erweitert)">
          {advancedConceptOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`state-toggle ${conceptId === option.id ? 'active' : ''}`}
              onClick={() => {
                setConceptId(option.id);
                resetStartFrameCandidates();
              }}
              aria-pressed={conceptId === option.id}
              title={option.whatHappens}
            >
              {option.label}
            </button>
          ))}
        </div>
      </details>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Startframe-Kandidaten (Pflicht)
      </h3>
      <div className="action-row" style={{ marginTop: 8 }}>
        <button className="button-ghost" type="button" disabled={busy || startFrameBusy || !scriptAccepted} onClick={prepareStartFrames}>
          {startFrameBusy ? 'Erzeuge Kandidaten ...' : '3 Startframe-Kandidaten erzeugen'}
        </button>
      </div>

      {startFrameCandidates.length ? (
        <div className="chip-wrap" role="list" aria-label="Startframe Candidate Auswahl">
          {startFrameCandidates.map((candidate) => (
            <button
              key={candidate.candidateId}
              type="button"
              className={`state-toggle ${selectedStartFrameCandidateId === candidate.candidateId ? 'active' : ''}`}
              onClick={() => setSelectedStartFrameCandidateId(candidate.candidateId)}
              aria-pressed={selectedStartFrameCandidateId === candidate.candidateId}
              title={candidate.description}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="section-copy" style={{ marginTop: 0 }}>
          Noch keine Kandidaten erzeugt.
        </p>
      )}

      {selectedStartFrameCandidate ? (
        <p className="section-copy" style={{ marginTop: 0 }}>
          Gewählt: {selectedStartFrameCandidate.label} ({selectedStartFrameCandidate.candidateId})
        </p>
      ) : null}

      <div className="action-row">
        <button className="button" type="button" disabled={busy || !scriptAccepted || !selectedStartFrameCandidate} onClick={runFlow}>
          {busy ? 'Flow läuft ...' : 'Echten Video-Flow starten'}
        </button>
      </div>

      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}

      <div className="action-row" style={{ marginTop: 0 }}>
        <span className="chip chip-neutral">Mood: {selectedMoodLabel}</span>
        <span className="chip chip-neutral">Concept: {selectedConcept.label}</span>
        <span className={`chip ${selectedStartFrameCandidate ? 'chip-success' : 'chip-warning'}`}>
          {selectedStartFrameCandidate ? 'Startframe gewählt' : 'Startframe fehlt'}
        </span>
      </div>
    </article>
  );
}
