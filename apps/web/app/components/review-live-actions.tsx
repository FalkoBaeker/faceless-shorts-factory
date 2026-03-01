'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  createProject,
  createScriptDraft,
  createStartFrameCandidates,
  fetchBrandProfile,
  preflightStartFrame,
  uploadStartFrameReference,
  upsertBrandProfile,
  selectConcept,
  triggerGenerate,
  type ApiError,
  type AudioMode,
  type BrandProfilePayload,
  type CreativeIntentPayload,
  type MoodPreset,
  type ShotStyleTag,
  type StartFrameCandidatePayload,
  type StartFramePreflightPayload,
  type StoryboardLightPayload
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

const defaultStyleByConcept: Record<ConceptId, 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split'> = {
  concept_web_vertical_slice: 'storefront_hero',
  concept_offer_focus: 'product_macro',
  concept_problem_solution: 'before_after_split',
  concept_before_after: 'before_after_split',
  concept_testimonial: 'owner_portrait'
};

const effectGoalOptions: Array<{ id: CreativeIntentPayload['effectGoals'][number]['id']; label: string; description: string }> = [
  { id: 'sell_conversion', label: 'Verkaufen', description: 'Klarer Conversion-Fokus mit starker Handlungsorientierung.' },
  { id: 'funny', label: 'Humorvoll', description: 'Leichter, sympathischer Humor ohne billig zu wirken.' },
  { id: 'cringe_hook', label: 'Cringe-Hook', description: 'Absichtlich auffälliger Hook für Stop-Scroll-Moment.' },
  { id: 'testimonial_trust', label: 'Vertrauen', description: 'Social Proof / Kundenstimme und Glaubwürdigkeit.' },
  { id: 'urgency_offer', label: 'Dringlichkeit', description: 'Zeitdruck/Angebotsdruck, aber markenkonform.' }
];

const narrativeFormatOptions: Array<{ id: CreativeIntentPayload['narrativeFormats'][number]['id']; label: string; description: string }> = [
  { id: 'commercial', label: 'Commercial', description: 'Klassischer Werbefluss mit CTA-Finale.' },
  { id: 'offer_focus', label: 'Offer Focus', description: 'Angebot und Mehrwert stehen im Zentrum.' },
  { id: 'problem_solution', label: 'Problem → Lösung', description: 'Schmerzpunkt und direkte Lösung in kurzer Sequenz.' },
  { id: 'before_after', label: 'Before / After', description: 'Vorher/Nachher-Kontrast als Story-Rückgrat.' },
  { id: 'dialog', label: 'Dialog', description: 'Szenische Gesprächsstruktur statt Monolog.' }
];

const shotStyleOptions: Array<{ id: ShotStyleTag; label: string }> = [
  { id: 'cinematic_closeup', label: 'Cinematic Closeup' },
  { id: 'over_shoulder', label: 'Over-Shoulder' },
  { id: 'handheld_push', label: 'Handheld Push' },
  { id: 'product_macro', label: 'Product Macro' },
  { id: 'wide_establishing', label: 'Wide Establishing' },
  { id: 'fast_cut_montage', label: 'Fast-Cut Montage' }
];

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

const deriveMoodFromIntent = (intent: CreativeIntentPayload): MoodPreset => {
  const effectIds = intent.effectGoals.map((entry) => entry.id);
  const narrativeIds = intent.narrativeFormats.map((entry) => entry.id);

  if (effectIds.includes('funny')) return 'humor_light';
  if (effectIds.includes('testimonial_trust') || narrativeIds.includes('dialog')) return 'testimonial';
  if (narrativeIds.includes('problem_solution') || narrativeIds.includes('before_after')) return 'problem_solution';
  return 'commercial_cta';
};

const buildStoryboardFromScript = (script: string): StoryboardLightPayload => {
  const sentences = script
    .split(/(?<=[.!?…])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const beats = (sentences.slice(0, 4).length ? sentences.slice(0, 4) : ['Hook eröffnen', 'Kernnutzen zeigen', 'CTA Abschluss'])
    .map((sentence, index) => ({
      beatId: `beat_${index + 1}`,
      order: index + 1,
      action: sentence,
      visualHint: index === 0 ? 'Schneller visueller Einstieg' : undefined,
      dialogueHint: undefined,
      onScreenTextHint: undefined
    }));

  return {
    beats,
    hookHint: beats[0]?.action,
    ctaHint: beats[beats.length - 1]?.action,
    pacingHint: 'dynamic'
  };
};

const asApiMessage = (error: unknown) => {
  const api = error as Partial<ApiError>;
  return api?.message ?? String(error);
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.trim()) {
        resolve(reader.result);
        return;
      }
      reject(new Error('UPLOAD_PREVIEW_READ_FAILED'));
    };
    reader.onerror = () => reject(new Error('UPLOAD_PREVIEW_READ_FAILED'));
    reader.readAsDataURL(file);
  });

const toBase64Payload = (dataUrl: string) => dataUrl.replace(/^data:[^;]+;base64,/, '');

export function ReviewLiveActions() {
  const router = useRouter();
  const [topic, setTopic] = useState('Sommerangebot für lokale Bäckerei in Berlin');
  const [variantType, setVariantType] = useState<'SHORT_15' | 'MASTER_30'>('SHORT_15');
  const [audioMode, setAudioMode] = useState<AudioMode>('voiceover');
  const [effectGoals, setEffectGoals] = useState<Array<CreativeIntentPayload['effectGoals'][number]['id']>>(['sell_conversion']);
  const [narrativeFormats, setNarrativeFormats] = useState<Array<CreativeIntentPayload['narrativeFormats'][number]['id']>>(['commercial']);
  const [energyMode, setEnergyMode] = useState<'auto' | 'high' | 'calm'>('auto');
  const [shotStyles, setShotStyles] = useState<ShotStyleTag[]>(['cinematic_closeup', 'product_macro']);
  const [conceptId, setConceptId] = useState<ConceptId>('concept_web_vertical_slice');
  const [startFrameCandidates, setStartFrameCandidates] = useState<StartFrameCandidatePayload[]>([]);
  const [selectedStartFrameCandidateId, setSelectedStartFrameCandidateId] = useState('');
  const [uploadedStartFrame, setUploadedStartFrame] = useState<
    | {
        fileName: string;
        previewUrl: string;
        objectPath: string;
        signedUrl: string;
        bytes: number;
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      }
    | null
  >(null);
  // legacy userControls removed in P1 (T26)
  const [scriptDraft, setScriptDraft] = useState('');
  const [storyboardLight, setStoryboardLight] = useState<StoryboardLightPayload>({
    beats: [
      { beatId: 'beat_1', order: 1, action: 'Hook in Sekunde 1', visualHint: 'Stop-scroll Moment' },
      { beatId: 'beat_2', order: 2, action: 'Kernnutzen visuell zeigen' },
      { beatId: 'beat_3', order: 3, action: 'Klarer CTA mit next step' }
    ],
    hookHint: 'Knalliger Einstieg',
    ctaHint: 'Jetzt testen/anfragen',
    pacingHint: 'dynamic'
  });
  const [scriptAccepted, setScriptAccepted] = useState(false);
  const [scriptMeta, setScriptMeta] = useState<{ targetSeconds: number; estimatedSeconds: number; suggestedWords: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [startFrameBusy, setStartFrameBusy] = useState(false);
  const [startFramePolicy, setStartFramePolicy] = useState<StartFramePreflightPayload | null>(null);
  const [status, setStatus] = useState('');
  const [brandProfile, setBrandProfile] = useState<BrandProfilePayload>({
    companyName: '',
    brandTone: 'friendly',
    primaryColorHex: '#D35400',
    secondaryColorHex: '#F4D03F',
    ctaStyle: 'balanced'
  });
  const [brandBusy, setBrandBusy] = useState(false);

  const primaryConceptOptions = useMemo(() => conceptOptions.filter((option) => option.primary), []);
  const advancedConceptOptions = useMemo(() => conceptOptions.filter((option) => !option.primary), []);

  const selectedConcept = useMemo(() => conceptOptions.find((option) => option.id === conceptId) ?? conceptOptions[0], [conceptId]);

  const creativeIntent = useMemo<CreativeIntentPayload>(
    () => ({
      effectGoals: effectGoals.map((id, index) => ({ id, weight: Math.max(0.2, 1 - index * 0.15), priority: (index < 3 ? index + 1 : 3) as 1 | 2 | 3 })),
      narrativeFormats: narrativeFormats.map((id, index) => ({
        id,
        weight: Math.max(0.2, 1 - index * 0.15),
        priority: (index < 3 ? index + 1 : 3) as 1 | 2 | 3
      })),
      shotStyles: shotStyles.map((id, index) => ({ id, weight: Math.max(0.2, 1 - index * 0.1), priority: (index < 3 ? index + 1 : 3) as 1 | 2 | 3 })),
      energyMode
    }),
    [effectGoals, narrativeFormats, shotStyles, energyMode]
  );

  const moodPreset = useMemo(() => deriveMoodFromIntent(creativeIntent), [creativeIntent]);
  const selectedMoodLabel = useMemo(
    () => moodOptions.find((option) => option.id === moodPreset)?.label ?? moodPreset,
    [moodPreset]
  );

  const selectedStartFrameCandidate = useMemo(
    () => startFrameCandidates.find((candidate) => candidate.candidateId === selectedStartFrameCandidateId) ?? null,
    [startFrameCandidates, selectedStartFrameCandidateId]
  );

  const activeStartframe = useMemo(() => {
    if (uploadedStartFrame) {
      return {
        source: 'uploaded_asset' as const,
        label: uploadedStartFrame.fileName,
        detail: 'Upload aktiv — Upload gewinnt gegenüber Kandidatenauswahl.'
      };
    }

    if (selectedStartFrameCandidate) {
      return {
        source: 'generated_candidate' as const,
        label: selectedStartFrameCandidate.label,
        detail: 'Kein Upload aktiv — ausgewählter Kandidat ist wirksam.'
      };
    }

    return {
      source: 'none' as const,
      label: 'Kein Startframe gewählt',
      detail: 'Bitte Kandidat auswählen oder Bild hochladen.'
    };
  }, [uploadedStartFrame, selectedStartFrameCandidate]);

  const organizationId = 'org_web_mvp';

  useEffect(() => {
    let cancelled = false;

    const loadBrandProfile = async () => {
      const token = readStoredToken();
      if (!token) return;

      try {
        const payload = await fetchBrandProfile(token, organizationId);
        if (!cancelled && payload.profile) {
          setBrandProfile((prev) => ({ ...prev, ...payload.profile }));
        }
      } catch {
        // non-blocking for initial render
      }
    };

    void loadBrandProfile();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const generationBlocker = useMemo(() => {
    if (!brandProfile.companyName?.trim()) return 'Bitte Brand Onboarding mit Firmenname speichern.';
    if (!effectGoals.length) return 'Bitte mindestens ein Effect Goal wählen.';
    if (!narrativeFormats.length) return 'Bitte mindestens ein Narrative Format wählen.';
    if (!scriptAccepted || !scriptDraft.trim()) return 'Script prüfen und akzeptieren.';
    if (!selectedStartFrameCandidate && !uploadedStartFrame) return 'Startframe wählen oder eigenes Bild hochladen.';
    if (startFramePolicy?.decision === 'block') {
      return `${startFramePolicy.userMessage} (${startFramePolicy.reasonCode})`;
    }
    return null;
  }, [
    effectGoals.length,
    narrativeFormats.length,
    scriptAccepted,
    scriptDraft,
    selectedStartFrameCandidate,
    uploadedStartFrame,
    startFramePolicy,
    brandProfile.companyName
  ]);

  const resetStartFrameCandidates = () => {
    setStartFrameCandidates([]);
    setSelectedStartFrameCandidateId('');
    setStartFramePolicy(null);
  };

  const resetUploadedReference = () => {
    setUploadedStartFrame(null);
    setStartFramePolicy(null);
  };

  const toggleFromList = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const updateStoryboardBeat = (beatId: string, field: 'action' | 'visualHint' | 'dialogueHint' | 'onScreenTextHint', value: string) => {
    setStoryboardLight((prev) => ({
      ...prev,
      beats: prev.beats.map((beat) => (beat.beatId === beatId ? { ...beat, [field]: value } : beat))
    }));
  };

  const saveBrandOnboarding = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    if (!brandProfile.companyName?.trim()) {
      setStatus('Firmenname ist Pflicht für das Brand Onboarding.');
      return;
    }

    setBrandBusy(true);
    try {
      const saved = await upsertBrandProfile(token, organizationId, brandProfile);
      if (saved.profile) {
        setBrandProfile((prev) => ({ ...prev, ...saved.profile }));
      }
      setStatus(`Brand-Profil gespeichert (${saved.profile?.companyName ?? brandProfile.companyName}).`);
    } catch (error) {
      setStatus(`Brand-Profil speichern fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setBrandBusy(false);
    }
  };

  const runStartFramePolicyPreflight = async (input: {
    candidateId?: string;
    style?: 'storefront_hero' | 'product_macro' | 'owner_portrait' | 'hands_at_work' | 'before_after_split';
    uploadObjectPath?: string;
    referenceHint?: string;
    customPrompt?: string;
    sourceLabel?: string;
  }) => {
    const token = readStoredToken();
    if (!token) return;

    try {
      const preflight = await preflightStartFrame(token, {
        topic,
        conceptId,
        startFrameCandidateId: input.candidateId,
        startFrameStyle: input.style,
        startFrameUploadObjectPath: input.uploadObjectPath,
        startFrameReferenceHint: input.referenceHint,
        startFrameCustomPrompt: input.customPrompt
      });

      setStartFramePolicy(preflight);

      if (preflight.decision === 'block') {
        setStatus(`Startframe-Policy blockiert: ${preflight.userMessage} (${preflight.reasonCode}). ${preflight.remediation}`);
      } else if (preflight.decision === 'fallback') {
        setStatus(
          `Startframe-Policy Fallback aktiv (${preflight.reasonCode}). Effektiv: ${preflight.effectiveStartFrameLabel ?? preflight.effectiveStartFrameStyle}.`
        );
      } else {
        setStatus(
          input.sourceLabel
            ? `Startframe aktiv (${input.sourceLabel}). Policy-Preflight bestanden.`
            : 'Startframe-Policy-Preflight bestanden.'
        );
      }
    } catch (error) {
      setStartFramePolicy(null);
      setStatus(`Startframe-Preflight fehlgeschlagen: ${asApiMessage(error)}`);
    }
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
      const draft = await createScriptDraft(token, {
        topic,
        variantType,
        organizationId,
        moodPreset,
        creativeIntent,
        brandProfile: brandProfile.companyName?.trim() ? brandProfile : undefined
      });
      setScriptDraft(draft.script);
      setStoryboardLight(buildStoryboardFromScript(draft.script));
      setScriptAccepted(false);
      setScriptMeta({
        targetSeconds: draft.targetSeconds,
        estimatedSeconds: draft.estimatedSeconds,
        suggestedWords: draft.suggestedWords
      });
      resetStartFrameCandidates();
      resetUploadedReference();
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
    setStatus('Script akzeptiert. Als Nächstes: visuelle Startframe-Kandidaten erzeugen oder eigenes Bild hochladen.');
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
        creativeIntent,
        limit: 3
      });

      setStartFrameCandidates(response.candidates);
      setSelectedStartFrameCandidateId('');
      setUploadedStartFrame(null);
      setStartFramePolicy(null);
      setStatus('Startframe-Kandidaten bereit. Bitte visuell auswählen oder eigenes Bild nutzen.');
    } catch (error) {
      setStatus(`Startframe-Kandidaten fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setStartFrameBusy(false);
    }
  };

  const onUploadReference = async (file: File | null) => {
    if (!file) return;

    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setStatus('Bitte ein Bild auswählen (png/jpg/webp).');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setStatus('Bild zu groß. Maximal 8MB.');
      return;
    }

    setStartFrameBusy(true);
    setStatus(`Lade Referenzbild hoch (${file.name}) ...`);

    try {
      const dataUrl = await fileToDataUrl(file);
      const normalizedMimeType =
        file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/jpeg'
          ? (file.type as 'image/png' | 'image/jpeg' | 'image/webp')
          : 'image/jpeg';

      const uploaded = await uploadStartFrameReference(token, {
        organizationId,
        fileName: file.name,
        mimeType: normalizedMimeType,
        imageBase64: toBase64Payload(dataUrl)
      });

      setUploadedStartFrame({
        fileName: file.name,
        previewUrl: dataUrl,
        objectPath: uploaded.objectPath,
        signedUrl: uploaded.signedUrl,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType
      });
      setSelectedStartFrameCandidateId('');

      await runStartFramePolicyPreflight({
        style: 'owner_portrait',
        uploadObjectPath: uploaded.objectPath,
        referenceHint: file.name,
        customPrompt: `Nutzer-Referenzbild (${file.name}) hochgeladen.`,
        sourceLabel: 'Upload aktiv'
      });
    } catch (error) {
      setStatus(`Upload fehlgeschlagen: ${asApiMessage(error)}`);
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

    if (generationBlocker) {
      setStatus(`Noch offen: ${generationBlocker}`);
      return;
    }

    setBusy(true);
    setStatus('Prüfe Startframe-Policy ...');
    try {
      const customPrompt = uploadedStartFrame
        ? `Nutzer-Referenzbild (${uploadedStartFrame.fileName}) ist hochgeladen: ${uploadedStartFrame.objectPath}. Nutze dieses Motiv als Startframe und als visuelle Leitplanke.`
        : undefined;

      const fallbackStyle = defaultStyleByConcept[conceptId];

      const preflight = await preflightStartFrame(token, {
        topic,
        conceptId,
        startFrameCandidateId: selectedStartFrameCandidate?.candidateId,
        startFrameStyle: selectedStartFrameCandidate?.style ?? fallbackStyle,
        startFrameCustomPrompt: customPrompt,
        startFrameReferenceHint: uploadedStartFrame?.fileName,
        startFrameUploadObjectPath: uploadedStartFrame?.objectPath
      });
      setStartFramePolicy(preflight);

      if (preflight.decision === 'block') {
        setStatus(`Startframe blockiert: ${preflight.userMessage} ${preflight.remediation}`);
        return;
      }

      setStatus('Erstelle Projekt ...');
      const project = await createProject(token, {
        organizationId,
        topic,
        variantType
      });

      setStatus(
        uploadedStartFrame
          ? `Starte Render mit eigenem Referenzbild (${uploadedStartFrame.fileName}) ...`
          : `Wähle final Storyboard (${selectedConcept.label}) + Startframe (${selectedStartFrameCandidate?.label}) und starte Render ...`
      );

      const selection = await selectConcept(token, project.projectId, {
        variantType,
        conceptId,
        moodPreset,
        creativeIntent,
        storyboardLight,
        brandProfile: brandProfile.companyName?.trim() ? brandProfile : undefined,
        approvedScript: scriptDraft.trim(),
        startFrameCandidateId: selectedStartFrameCandidate?.candidateId,
        startFrameStyle: selectedStartFrameCandidate?.style ?? fallbackStyle,
        startFrameCustomLabel: uploadedStartFrame ? `Eigenes Bild (${uploadedStartFrame.fileName})` : undefined,
        startFrameCustomPrompt: customPrompt,
        startFrameReferenceHint: uploadedStartFrame?.fileName,
        startFrameUploadObjectPath: uploadedStartFrame?.objectPath,
        audioMode
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
        Echter End-to-End Pfad: Topic → Mood → Script Review (Pflicht) → Concept (Primary-first) → Startframe-Preview (Pflicht) → Generate → Job-Status → Download.
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
              resetUploadedReference();
            }}
          />
        </label>
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Brand Onboarding (P3)
      </h3>
      <p className="section-copy" style={{ marginTop: 0 }}>
        Dieses Profil wird für Script + Prompt Compiler wiederverwendet, damit der Markenoutput konsistent bleibt.
      </p>
      <div className="section-card" style={{ marginTop: 0 }}>
        <div className="auth-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="auth-field">
            <span>Firmenname *</span>
            <input
              value={brandProfile.companyName ?? ''}
              onChange={(event) => setBrandProfile((prev) => ({ ...prev, companyName: event.target.value }))}
              placeholder="z. B. Bäckerei Morgenrot"
            />
          </label>
          <label className="auth-field">
            <span>Website</span>
            <input
              value={brandProfile.websiteUrl ?? ''}
              onChange={(event) => setBrandProfile((prev) => ({ ...prev, websiteUrl: event.target.value }))}
              placeholder="https://..."
            />
          </label>
          <label className="auth-field">
            <span>Brand Tone</span>
            <input
              value={brandProfile.brandTone ?? ''}
              onChange={(event) => setBrandProfile((prev) => ({ ...prev, brandTone: event.target.value }))}
              placeholder="friendly / premium / bold"
            />
          </label>
          <label className="auth-field">
            <span>Value Proposition</span>
            <input
              value={brandProfile.valueProposition ?? ''}
              onChange={(event) => setBrandProfile((prev) => ({ ...prev, valueProposition: event.target.value }))}
              placeholder="Wofür steht eure Marke?"
            />
          </label>
        </div>
        <div className="action-row" style={{ marginTop: 8 }}>
          <button className="button-ghost" type="button" onClick={saveBrandOnboarding} disabled={brandBusy}>
            {brandBusy ? 'Speichere Brand-Profil ...' : 'Brand-Profil speichern'}
          </button>
          <span className={`chip ${brandProfile.companyName?.trim() ? 'chip-success' : 'chip-warning'}`}>
            {brandProfile.companyName?.trim() ? `Brand aktiv: ${brandProfile.companyName}` : 'Brand-Profil unvollständig'}
          </span>
        </div>
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
            resetUploadedReference();
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
              resetUploadedReference();
            }}
          >
            PREMIUM_60 (60s)
          </button>
        ) : null}
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Audio-Strategie
      </h3>
      <div className="chip-wrap" role="list" aria-label="Audio Mode Auswahl">
        {([
          { id: 'voiceover', label: 'Voiceover (stabil)' },
          { id: 'scene', label: 'Scene Audio (experimentell)' },
          { id: 'hybrid', label: 'Hybrid VO+Scene (experimentell)' }
        ] as const).map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`state-toggle ${audioMode === mode.id ? 'active' : ''}`}
            onClick={() => setAudioMode(mode.id)}
            aria-pressed={audioMode === mode.id}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        Scene/Hybrid können bei fehlender Szenen-Audiospur automatisch auf Voiceover zurückfallen.
      </p>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Creative Intent Matrix
      </h3>
      <fieldset className="section-card" style={{ marginTop: 8 }}>
        <legend className="section-copy" style={{ marginBottom: 8 }}>Effect Goal (multi-select)</legend>
        <div className="chip-wrap" role="list" aria-label="Effect Goal Auswahl">
          {effectGoalOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`state-toggle ${effectGoals.includes(option.id) ? 'active' : ''}`}
              onClick={() => {
                setEffectGoals((prev) => toggleFromList(prev, option.id));
                setScriptAccepted(false);
                resetStartFrameCandidates();
                resetUploadedReference();
              }}
              aria-pressed={effectGoals.includes(option.id)}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="section-card" style={{ marginTop: 0 }}>
        <legend className="section-copy" style={{ marginBottom: 8 }}>Narrative Format (multi-select)</legend>
        <div className="chip-wrap" role="list" aria-label="Narrative Format Auswahl">
          {narrativeFormatOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`state-toggle ${narrativeFormats.includes(option.id) ? 'active' : ''}`}
              onClick={() => {
                setNarrativeFormats((prev) => toggleFromList(prev, option.id));
                setScriptAccepted(false);
                resetStartFrameCandidates();
                resetUploadedReference();
              }}
              aria-pressed={narrativeFormats.includes(option.id)}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="action-row" style={{ marginTop: 0 }}>
        <span className="chip chip-neutral">Energy</span>
        {(['auto', 'high', 'calm'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`state-toggle ${energyMode === mode ? 'active' : ''}`}
            onClick={() => setEnergyMode(mode)}
            aria-pressed={energyMode === mode}
          >
            {mode}
          </button>
        ))}
      </div>

      <p className="section-copy" style={{ marginTop: 0 }}>
        Legacy-Mood (abgeleitet): {selectedMoodLabel}. Primary steering erfolgt über Intent + Storyboard.
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
        Storyboard Light (editierbar)
      </h3>
      <p className="section-copy" style={{ marginTop: 0 }}>
        Bearbeite hier kurz, was im Video passiert. Diese Beats fließen direkt in den Prompt-Compiler.
      </p>
      <div className="section-card" style={{ marginTop: 0 }}>
        {storyboardLight.beats.map((beat) => (
          <div key={beat.beatId} className="auth-form-grid" style={{ gridTemplateColumns: '1fr', marginBottom: 8 }}>
            <label className="auth-field">
              <span>Beat {beat.order} – Action</span>
              <input
                value={beat.action}
                onChange={(event) => updateStoryboardBeat(beat.beatId, 'action', event.target.value)}
                placeholder="Was passiert in diesem Beat?"
              />
            </label>
            <label className="auth-field">
              <span>Visual Hint (optional)</span>
              <input
                value={beat.visualHint ?? ''}
                onChange={(event) => updateStoryboardBeat(beat.beatId, 'visualHint', event.target.value)}
                placeholder="z. B. schneller Push-in auf Produkt"
              />
            </label>
            <label className="auth-field">
              <span>Dialog Hint (optional)</span>
              <input
                value={beat.dialogueHint ?? ''}
                onChange={(event) => updateStoryboardBeat(beat.beatId, 'dialogueHint', event.target.value)}
                placeholder="Optionaler Dialog-Satz"
              />
            </label>
          </div>
        ))}
      </div>

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
        <span className={`chip ${activeStartframe.source === 'none' ? 'chip-warning' : 'chip-success'}`}>
          Aktiv: {activeStartframe.label}
        </span>
        <span className="chip chip-neutral">Rule: Upload gewinnt über Kandidat</span>
        <span className="chip chip-neutral">Source: {activeStartframe.source}</span>
        {startFramePolicy ? (
          <span className={`chip ${startFramePolicy.decision === 'block' ? 'chip-danger' : startFramePolicy.decision === 'fallback' ? 'chip-warning' : 'chip-success'}`}>
            Policy: {startFramePolicy.decision} ({startFramePolicy.reasonCode})
          </span>
        ) : null}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>{activeStartframe.detail}</p>
      {startFramePolicy ? (
        <p className="section-copy" style={{ marginTop: 0 }}>
          {startFramePolicy.userMessage} {startFramePolicy.remediation}
        </p>
      ) : null}
      <div className="action-row" style={{ marginTop: 8 }}>
        <button className="button-ghost" type="button" disabled={busy || startFrameBusy || !scriptAccepted} onClick={prepareStartFrames}>
          {startFrameBusy ? 'Erzeuge Kandidaten ...' : '3 Startframe-Kandidaten erzeugen'}
        </button>
      </div>

      {startFrameCandidates.length ? (
        <div className="startframe-grid" role="list" aria-label="Startframe Candidate Auswahl">
          {startFrameCandidates.map((candidate) => {
            const selected = selectedStartFrameCandidateId === candidate.candidateId;
            return (
              <button
                key={candidate.candidateId}
                type="button"
                className={`startframe-card ${selected ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedStartFrameCandidateId(candidate.candidateId);
                  setUploadedStartFrame(null);
                  void runStartFramePolicyPreflight({
                    candidateId: candidate.candidateId,
                    style: candidate.style,
                    sourceLabel: `Kandidat aktiv (${candidate.label})`
                  });
                }}
                aria-pressed={selected}
                title={candidate.description}
              >
                <Image
                  src={candidate.thumbnailUrl}
                  alt={`Preview ${candidate.label}`}
                  className="startframe-thumb"
                  width={360}
                  height={640}
                  unoptimized
                />
                <span className="startframe-title">{candidate.label}</span>
                <span className="startframe-copy">{candidate.description}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="section-copy" style={{ marginTop: 0 }}>
          Noch keine Kandidaten erzeugt.
        </p>
      )}

      <label className="auth-field" style={{ marginTop: 8 }}>
        <span>Eigenes Bild hochladen (als Referenz)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void onUploadReference(event.target.files?.[0] ?? null);
          }}
        />
      </label>

      {uploadedStartFrame ? (
        <div className="startframe-card selected" style={{ marginTop: 8 }}>
          <Image
            src={uploadedStartFrame.previewUrl}
            alt="Eigenes Referenzbild"
            className="startframe-thumb"
            width={360}
            height={640}
            unoptimized
          />
          <span className="startframe-title">Eigenes Referenzbild</span>
          <span className="startframe-copy">{uploadedStartFrame.fileName}</span>
        </div>
      ) : null}

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Shot Style Library (kuratiert)
      </h3>
      <div className="chip-wrap" role="list" aria-label="Shot-Style Auswahl">
        {shotStyleOptions.map((style) => (
          <button
            key={style.id}
            type="button"
            className={`state-toggle ${shotStyles.includes(style.id) ? 'active' : ''}`}
            onClick={() => setShotStyles((prev) => toggleFromList(prev, style.id))}
            aria-pressed={shotStyles.includes(style.id)}
          >
            {style.label}
          </button>
        ))}
      </div>
      <p className="section-copy" style={{ marginTop: 0 }}>
        Technische User-Controls wurden entfernt. Creative-Steuerung läuft über Intent, Storyboard und Shot-Styles.
      </p>

      <div className="action-row">
        <button
          className="button"
          type="button"
          disabled={busy || Boolean(generationBlocker)}
          onClick={runFlow}
          title={generationBlocker ?? 'Generierung starten'}
        >
          {busy ? 'Flow läuft ...' : 'Echten Video-Flow starten'}
        </button>
      </div>

      {generationBlocker ? <p className="section-copy" style={{ marginTop: 0 }}>Blocker: {generationBlocker}</p> : null}
      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}

      <div className="action-row" style={{ marginTop: 0 }}>
        <span className="chip chip-neutral">Legacy-Mood: {selectedMoodLabel}</span>
        <span className="chip chip-neutral">Concept: {selectedConcept.label}</span>
        <span className="chip chip-neutral">Audio: {audioMode}</span>
        <span className="chip chip-neutral">Brand: {brandProfile.companyName?.trim() || 'not set'}</span>
        <span className="chip chip-neutral">Intent: {effectGoals.length} Goals / {narrativeFormats.length} Formats</span>
        <span className="chip chip-neutral">Shot-Styles: {shotStyles.length}</span>
        <span className={`chip ${activeStartframe.source === 'none' ? 'chip-warning' : 'chip-success'}`}>
          {activeStartframe.source === 'none' ? 'Startframe fehlt' : `Startframe aktiv (${activeStartframe.source})`}
        </span>
        {startFramePolicy ? (
          <span className={`chip ${startFramePolicy.decision === 'block' ? 'chip-danger' : startFramePolicy.decision === 'fallback' ? 'chip-warning' : 'chip-success'}`}>
            Policy {startFramePolicy.decision}
          </span>
        ) : null}
      </div>
    </article>
  );
}
