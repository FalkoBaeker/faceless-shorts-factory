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
  type BrandProfilePayload,
  type CreativeIntentPayload,
  type MoodPreset,
  type StartFrameCandidatePayload,
  type StartFramePreflightPayload,
  type StoryboardLightPayload,
  type ScriptV2Payload
} from '../lib/api-client';
import { readStoredToken } from '../lib/session-store';

const effectGoalOptions: Array<{
  id: CreativeIntentPayload['effectGoals'][number]['id'];
  label: string;
  description: string;
}> = [
  { id: 'sell_conversion', label: 'Verkaufen', description: 'Klarer Conversion-Fokus mit starker Handlungsorientierung.' },
  { id: 'funny', label: 'Humorvoll', description: 'Leichter, sympathischer Humor ohne billig zu wirken.' },
  { id: 'testimonial_trust', label: 'Vertrauen', description: 'Social Proof / Kundenstimme und Glaubwürdigkeit.' },
  { id: 'urgency_offer', label: 'Dringlichkeit', description: 'Zeitdruck/Angebotsdruck, aber markenkonform.' }
];

const deriveMoodFromIntent = (intent: CreativeIntentPayload): MoodPreset => {
  const effectIds = intent.effectGoals.map((entry) => entry.id);
  const narrativeIds = intent.narrativeFormats.map((entry) => entry.id);

  if (effectIds.includes('funny')) return 'humor_light';
  if (effectIds.includes('testimonial_trust')) return 'testimonial';
  if (narrativeIds.includes('problem_solution') || narrativeIds.includes('before_after')) return 'problem_solution';
  return 'commercial_cta';
};

const inferExplicitHeroSubject = (topic: string) => {
  const lower = topic.toLowerCase();

  if (/bäck|brot|bröt|croissant|konditor|backstube/.test(lower)) {
    return 'eine Bäckereitheke mit goldbraunen Brötchen und Croissants plus sichtbarem Sommerangebot-Schild';
  }

  if (/katz|kitten|wurf|cattery|russisch\s*blau|russischblau/.test(lower)) {
    return 'eine klar erkennbare Katze im Portrait mit natürlichem Fell-Detail und ruhigem Innenraum-Hintergrund';
  }

  if (/pizza|pasta|restaurant|imbiss|café|kaffee|coffee/.test(lower)) {
    return 'ein frisch angerichtetes Signature-Gericht auf dem Tresen mit aktiver Bedienung im Hintergrund';
  }

  return `eine konkret benannte Hauptfigur zum Thema "${topic}" mit klar sichtbarer Handlung im realen Nutzungskontext`;
};

const concreteFallbackAction = (input: { topic: string; sentence: string; index: number }) => {
  const detail = input.sentence.replace(/[.!?…]+$/g, '').trim() || input.topic;
  const heroSubject = inferExplicitHeroSubject(input.topic);
  const templates = [
    `Shot 1 Hook: Vertikale Kamerafahrt auf ${heroSubject}; eine klar sichtbare Startaktion führt ${detail} ein.`,
    `Shot 2 Kontext: Halbtotale im realen Umfeld; Hauptfigur interagiert direkt mit ${heroSubject}, ${detail} bleibt klar erkennbar.`,
    `Shot 3 Detail: Nahe Aufnahme mit Fokuswechsel auf Produkt/Handlung; sichtbarer Mikromoment rund um ${detail}.`,
    `Shot 4 Entwicklung: Perspektivwechsel mit zweiter Bewegung derselben Szene; der Ablauf geht sichtbar vorwärts ohne Reset.`,
    `Shot 5 Ergebnis: Reaktionsshot im selben Ort mit klarer Wirkung; ${detail} bleibt im Kontext von ${heroSubject}.`
  ];

  return templates[input.index % templates.length];
};

const fallbackFlowFromScript = (script: string, topic: string) => {
  const sentences = script
    .split(/(?<=[.!?…])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  const source = sentences.length ? sentences : ['Hook eröffnen', 'Kernnutzen klar machen', 'CTA Abschluss'];
  return source.map((sentence, index) => ({ order: index + 1, action: concreteFallbackAction({ topic, sentence, index }) }));
};

const stripScenePrefix = (value: string) =>
  value
    .replace(/^\s*(szene|scene|shot)\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/^\s*\d+\s*[.)-]\s*/, '')
    .trim();

const toUnifiedScriptDraftText = (scriptV2: ScriptV2Payload | undefined, fallbackScript: string, topic: string) => {
  const scenes: Array<{ order: number; action: string; lines?: ScriptV2Payload['scenes'][number]['lines'] }> = scriptV2?.scenes?.length
    ? scriptV2.scenes
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((scene) => ({
          order: scene.order,
          action: String(scene.action ?? '').trim(),
          lines: Array.isArray(scene.lines) ? scene.lines : []
        }))
        .filter((scene) => scene.action.length)
    : fallbackFlowFromScript(fallbackScript, topic).map((scene) => ({
        order: scene.order,
        action: scene.action,
        lines: undefined
      }));

  return scenes
    .map((scene) => {
      const normalizedAction = stripScenePrefix(String(scene.action ?? ''));
      const core = `${scene.order}. ${normalizedAction}`;
      const lines = scene.lines?.length ? scene.lines.map((entry) => `   Dialog ${entry.speaker}: "${entry.text}"`) : [];
      return [core, ...lines].join('\n');
    })
    .join('\n\n');
};

const buildScriptV2FromUnifiedDraft = (input: {
  unifiedDraft: string;
  narration: string;
  draft?: ScriptV2Payload;
  topic: string;
}): ScriptV2Payload => {
  const blocks = input.unifiedDraft
    .split(/\n\s*\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((block, index) => {
      const merged = block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
      const stripped = stripScenePrefix(merged);
      if (!stripped.length) return null;
      return { order: index + 1, action: stripped };
    })
    .filter((scene): scene is { order: number; action: string } => Boolean(scene));

  const scenes = blocks.length ? blocks : fallbackFlowFromScript(input.narration, input.topic);

  return {
    language: input.draft?.language ?? 'de',
    openingHook: input.draft?.openingHook ?? scenes[0]?.action ?? `Stop scrolling: ${input.topic}.`,
    narration: input.narration,
    scenes: scenes.map((scene) => ({
      order: scene.order,
      action: scene.action,
      onScreenText: undefined,
      lines: undefined
    }))
  };
};

const buildStoryboardFromScriptV2 = (
  scriptV2: ScriptV2Payload | undefined,
  fallbackScript: string,
  topic: string
): StoryboardLightPayload => {
  const scenes = scriptV2?.scenes?.length
    ? scriptV2.scenes
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((scene) => String(scene.action ?? '').trim())
        .filter(Boolean)
    : fallbackFlowFromScript(fallbackScript, topic).map((scene) => scene.action);

  const beats = scenes.slice(0, 5).map((action, index) => ({
    beatId: `beat_${index + 1}`,
    order: index + 1,
    action,
    visualHint: index === 0 ? 'Schneller visueller Einstieg mit klarer Hook' : 'Neue sichtbare Handlung, kein Repeat-Shot'
  }));

  return {
    beats,
    hookHint: scriptV2?.openingHook || beats[0]?.action,
    ctaHint: beats[beats.length - 1]?.action,
    pacingHint: 'fast_tiktok'
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
  const [variantType, setVariantType] = useState<'SHORT_15' | 'MASTER_30'>('MASTER_30');
  const conceptId = 'concept_web_vertical_slice';

  const [effectGoals, setEffectGoals] = useState<Array<CreativeIntentPayload['effectGoals'][number]['id']>>(['sell_conversion']);
  const [energyMode, setEnergyMode] = useState<'auto' | 'high' | 'calm'>('auto');

  const narrativeFormats = useMemo<Array<CreativeIntentPayload['narrativeFormats'][number]['id']>>(() => ['commercial'], []);
  const shotStyles = useMemo<Array<NonNullable<CreativeIntentPayload['shotStyles']>[number]['id']>>(
    () => ['cinematic_closeup', 'product_macro'],
    []
  );

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

  const [scriptDraft, setScriptDraft] = useState('');
  const [scriptV2Draft, setScriptV2Draft] = useState<ScriptV2Payload | undefined>(undefined);
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
        // non-blocking
      }
    };

    void loadBrandProfile();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

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

  const activeStartframeSummary = useMemo(() => {
    if (uploadedStartFrame) {
      return {
        style: 'owner_portrait' as const,
        candidateId: undefined,
        customPrompt: `Nutzer-Referenzbild (${uploadedStartFrame.fileName}) als Startbild verwenden; falls Kontext abweicht nur als 0-2s Opening-Anchor nutzen und dann auf Topic-Motiv schwenken.`,
        referenceHint: uploadedStartFrame.fileName,
        imageUrl: uploadedStartFrame.signedUrl,
        uploadObjectPath: uploadedStartFrame.objectPath,
        summary: `Upload: ${uploadedStartFrame.fileName}`
      };
    }

    if (selectedStartFrameCandidate) {
      return {
        style: selectedStartFrameCandidate.style,
        candidateId: selectedStartFrameCandidate.candidateId,
        customPrompt: undefined,
        referenceHint: selectedStartFrameCandidate.label,
        imageUrl: selectedStartFrameCandidate.thumbnailUrl,
        uploadObjectPath: selectedStartFrameCandidate.thumbnailObjectPath,
        summary: `Kandidat: ${selectedStartFrameCandidate.label} — ${selectedStartFrameCandidate.description}`
      };
    }

    return null;
  }, [uploadedStartFrame, selectedStartFrameCandidate]);

  const generationBlocker = useMemo(() => {
    if (!brandProfile.companyName?.trim()) return 'Bitte Brand Onboarding mit Firmenname speichern.';
    if (!effectGoals.length) return 'Bitte mindestens ein Creative-Intent-Ziel wählen.';
    if (!selectedStartFrameCandidate && !uploadedStartFrame) return 'Bitte zuerst Startframe wählen oder eigenes Bild hochladen.';
    if (startFramePolicy?.decision === 'block') {
      return `${startFramePolicy.userMessage} (${startFramePolicy.reasonCode})`;
    }
    if (!scriptAccepted || !scriptDraft.trim()) return 'Ablauf prüfen und akzeptieren.';
    return null;
  }, [brandProfile.companyName, effectGoals.length, selectedStartFrameCandidate, uploadedStartFrame, startFramePolicy, scriptAccepted, scriptDraft]);

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
        setStatus(`Startframe-Policy Fallback aktiv (${preflight.reasonCode}). Effektiv: ${preflight.effectiveStartFrameLabel ?? preflight.effectiveStartFrameStyle}. Ablauf danach neu generieren.`);
      } else {
        setStatus(
          input.sourceLabel
            ? `Startframe aktiv (${input.sourceLabel}). Policy-Preflight bestanden. Ablauf danach neu generieren.`
            : 'Startframe-Policy-Preflight bestanden. Ablauf danach neu generieren.'
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

    if (!activeStartframeSummary) {
      setStatus('Bitte zuerst ein Startbild wählen/hochladen. Der Ablauf wird darauf aufgebaut.');
      return;
    }

    if (startFramePolicy?.decision === 'block') {
      setStatus(`Startframe blockiert: ${startFramePolicy.userMessage} ${startFramePolicy.remediation}`);
      return;
    }

    setBusy(true);
    setStatus('Erzeuge Ablauf aus Branding + Motiv + Creative Intent + Startbild ...');
    try {
      const draft = await createScriptDraft(token, {
        topic,
        variantType,
        organizationId,
        moodPreset,
        creativeIntent,
        brandProfile: brandProfile.companyName?.trim() ? brandProfile : undefined,
        startFrameStyle: activeStartframeSummary.style,
        startFrameCandidateId: activeStartframeSummary.candidateId,
        startFrameCustomPrompt: activeStartframeSummary.customPrompt,
        startFrameReferenceHint: activeStartframeSummary.referenceHint,
        startFrameImageUrl: activeStartframeSummary.imageUrl,
        startFrameUploadObjectPath: activeStartframeSummary.uploadObjectPath,
        startFrameSummary: activeStartframeSummary.summary
      });

      const normalizedScriptV2 = draft.scriptV2 ?? buildScriptV2FromUnifiedDraft({
        unifiedDraft: toUnifiedScriptDraftText(undefined, draft.script, topic),
        narration: draft.script,
        topic
      });

      setScriptDraft(toUnifiedScriptDraftText(normalizedScriptV2, draft.script, topic));
      setScriptV2Draft(normalizedScriptV2);
      setScriptAccepted(false);
      setScriptMeta({
        targetSeconds: draft.targetSeconds,
        estimatedSeconds: draft.estimatedSeconds,
        suggestedWords: draft.suggestedWords
      });

      setStatus(
        draft.withinTarget
          ? `Ablauf bereit (${Math.round(draft.estimatedSeconds)}s von ${draft.targetSeconds}s) — basiert auf dem gewählten Startbild. Bitte akzeptieren oder bearbeiten.`
          : `Ablauf zu lang (${Math.round(draft.estimatedSeconds)}s). Bitte kürzen oder neu generieren.`
      );
    } catch (error) {
      setStatus(`Ablauf-Erzeugung fehlgeschlagen: ${asApiMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const acceptScript = () => {
    if (!scriptDraft.trim()) {
      setStatus('Ablauf ist leer. Bitte zuerst Ablauf generieren.');
      return;
    }

    setScriptAccepted(true);
    setStatus('Ablauf akzeptiert. Als Nächstes: Video erstellen. Bei Motiv-/Intent-Änderung Ablauf neu generieren.');
  };

  const prepareStartFrames = async () => {
    const token = readStoredToken();
    if (!token) {
      setStatus('Bitte zuerst auf der Startseite einloggen.');
      return;
    }

    setStartFrameBusy(true);
    setStatus('Erzeuge Startframe-Kandidaten ...');
    try {
      const response = await createStartFrameCandidates(token, {
        topic,
        organizationId,
        conceptId,
        moodPreset,
        creativeIntent,
        brandProfile: brandProfile.companyName?.trim() ? brandProfile : undefined,
        limit: 3
      });

      setStartFrameCandidates(response.candidates);
      setSelectedStartFrameCandidateId('');
      setUploadedStartFrame(null);
      setStartFramePolicy(null);
      setScriptAccepted(false);
      setStatus('Startframe-Kandidaten bereit. Bitte visuell auswählen oder eigenes Bild nutzen. Danach Ablauf generieren.');
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
      setScriptAccepted(false);

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
        ? `Nutzer-Referenzbild (${uploadedStartFrame.fileName}) ist hochgeladen: ${uploadedStartFrame.objectPath}. Nutze es als Opening-Anchor (0-2s); danach auf Topic-/Intent-konforme Szene überblenden, falls Kontext abweicht.`
        : undefined;
      const startFrameReferenceObjectPath = uploadedStartFrame?.objectPath ?? selectedStartFrameCandidate?.thumbnailObjectPath;
      const startFrameReferenceHint = uploadedStartFrame?.fileName ?? selectedStartFrameCandidate?.label;

      const fallbackStyle = 'storefront_hero' as const;
      const approvedScriptV2 = buildScriptV2FromUnifiedDraft({
        unifiedDraft: scriptDraft,
        narration: scriptDraft.trim(),
        draft: scriptV2Draft,
        topic
      });

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

      setStatus('Starte Video-Erstellung ...');
      const selection = await selectConcept(token, project.projectId, {
        variantType,
        conceptId,
        moodPreset,
        creativeIntent,
        generationPayload: {
          topic,
          brandProfile,
          creativeIntent: {
            effectGoals: creativeIntent.effectGoals
              .filter(
                (goal): goal is (typeof creativeIntent.effectGoals)[number] & { id: 'sell_conversion' | 'funny' | 'testimonial_trust' | 'urgency_offer' } =>
                  goal.id !== 'cringe_hook'
              )
              .map((goal) => ({ id: goal.id, weight: goal.weight, priority: goal.priority })),
            narrativeFormats: creativeIntent.narrativeFormats,
            shotStyles: creativeIntent.shotStyles,
            energyMode: creativeIntent.energyMode
          },
          startFrame: {
            style: selectedStartFrameCandidate?.style ?? fallbackStyle,
            candidateId: selectedStartFrameCandidate?.candidateId,
            customPrompt,
            uploadObjectPath: startFrameReferenceObjectPath,
            referenceHint: startFrameReferenceHint,
            summary: uploadedStartFrame
              ? `Upload: ${uploadedStartFrame.fileName}`
              : selectedStartFrameCandidate
                ? `Kandidat: ${selectedStartFrameCandidate.label}`
                : 'no-startframe'
          },
          userEditedFlowScript: scriptDraft.trim() || undefined
        },
        storyboardLight: buildStoryboardFromScriptV2(approvedScriptV2, scriptDraft, topic),
        brandProfile: brandProfile.companyName?.trim() ? brandProfile : undefined,
        approvedScript: scriptDraft.trim(),
        approvedScriptV2,
        startFrameCandidateId: selectedStartFrameCandidate?.candidateId,
        startFrameStyle: selectedStartFrameCandidate?.style ?? fallbackStyle,
        startFrameCustomLabel: uploadedStartFrame ? `Eigenes Bild (${uploadedStartFrame.fileName})` : undefined,
        startFrameCustomPrompt: customPrompt,
        startFrameReferenceHint: startFrameReferenceHint,
        startFrameUploadObjectPath: startFrameReferenceObjectPath,
        audioMode: 'voiceover'
      });

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
        Fast-MVP Flow (ECHTE API-Daten)
      </h2>
      <p className="section-copy">Topic → Branding → Motiv/Creative Intent → Startframe wählen/hochladen → Ablauf generieren → Ablauf akzeptieren/bearbeiten → Video erstellen.</p>

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

      <div className="action-row" style={{ marginTop: 8 }}>
        <span className="chip chip-neutral">Videolänge</span>
        <button
          type="button"
          className={`state-toggle ${variantType === 'SHORT_15' ? 'active' : ''}`}
          onClick={() => {
            setVariantType('SHORT_15');
            setScriptAccepted(false);
          }}
          aria-pressed={variantType === 'SHORT_15'}
        >
          15s
        </button>
        <button
          type="button"
          className={`state-toggle ${variantType === 'MASTER_30' ? 'active' : ''}`}
          onClick={() => {
            setVariantType('MASTER_30');
            setScriptAccepted(false);
          }}
          aria-pressed={variantType === 'MASTER_30'}
        >
          30s
        </button>
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Branding
      </h3>
      <p className="section-copy" style={{ marginTop: 0 }}>
        Dieses Profil wird für Ablauf, Prompt und Konsistenz wiederverwendet.
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
        Creative Intent Matrix
      </h3>
      <fieldset className="section-card" style={{ marginTop: 8 }}>
        <legend className="section-copy" style={{ marginBottom: 8 }}>Wirkziel (multi-select)</legend>
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

      <div className="action-row" style={{ marginTop: 0 }}>
        <span className="chip chip-neutral">Energy</span>
        {(['auto', 'high', 'calm'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`state-toggle ${energyMode === mode ? 'active' : ''}`}
            onClick={() => {
              setEnergyMode(mode);
              setScriptAccepted(false);
              resetStartFrameCandidates();
              resetUploadedReference();
            }}
            aria-pressed={energyMode === mode}
          >
            {mode}
          </button>
        ))}
      </div>

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Ablauf / Skript (erst nach Startframe)
      </h3>
      <div className="action-row" style={{ marginTop: 8 }}>
        <button
          className="button-ghost"
          type="button"
          disabled={busy || !activeStartframeSummary}
          onClick={prepareScript}
          title={activeStartframeSummary ? 'Ablauf aus gewähltem Startbild erzeugen' : 'Erst Startframe wählen/hochladen'}
        >
          Ablauf generieren
        </button>
        <button className="button" type="button" disabled={busy || !scriptDraft.trim()} onClick={acceptScript}>
          Ablauf akzeptieren / bearbeiten
        </button>
      </div>

      <label className="auth-field" style={{ marginTop: 8 }}>
        <span>Ablauf / Script (eine Box, editierbar)</span>
        <textarea
          value={scriptDraft}
          onChange={(event) => {
            const value = event.target.value;
            setScriptDraft(value);
            setScriptV2Draft((prev) => (prev ? { ...prev, narration: value } : prev));
            setScriptAccepted(false);
          }}
          rows={12}
          placeholder="1. Die Frau sagt ...\n2. Kamera schwenkt auf ...\n3. Wir zoomen ran auf ...\n4. Schnitt auf ..."
        />
      </label>

      {scriptMeta ? (
        <div className="action-row" style={{ marginTop: 0 }}>
          <span className="chip chip-neutral">Target: {scriptMeta.targetSeconds}s</span>
          <span className="chip chip-neutral">Estimate: {Math.round(scriptMeta.estimatedSeconds)}s</span>
          <span className="chip chip-neutral">Wörter Ziel: ~{scriptMeta.suggestedWords}</span>
          <span className={`chip ${scriptAccepted ? 'chip-success' : 'chip-warning'}`}>
            {scriptAccepted ? 'Ablauf akzeptiert' : 'Ablauf noch nicht akzeptiert'}
          </span>
        </div>
      ) : null}

      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 0 }}>
        Startframe-Auswahl (Pflicht)
      </h3>
      <div className="action-row" style={{ marginTop: 8 }}>
        <span className={`chip ${activeStartframe.source === 'none' ? 'chip-warning' : 'chip-success'}`}>Aktiv: {activeStartframe.label}</span>
        <span className="chip chip-neutral">Rule: Upload gewinnt über Kandidat</span>
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
        <button className="button-ghost" type="button" disabled={busy || startFrameBusy} onClick={prepareStartFrames}>
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
                  setScriptAccepted(false);
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
        <p className="section-copy" style={{ marginTop: 0 }}>Noch keine Kandidaten erzeugt.</p>
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

      <div className="action-row">
        <button
          className="button"
          type="button"
          disabled={busy || Boolean(generationBlocker)}
          onClick={runFlow}
          title={generationBlocker ?? 'Video erstellen'}
        >
          {busy ? 'Video wird erstellt ...' : 'Video erstellen'}
        </button>
      </div>

      {generationBlocker ? <p className="section-copy" style={{ marginTop: 0 }}>Blocker: {generationBlocker}</p> : null}
      {status ? <p className="section-copy" style={{ marginTop: 0 }}>{status}</p> : null}

      <div className="action-row" style={{ marginTop: 0 }}>
        <span className="chip chip-neutral">Brand: {brandProfile.companyName?.trim() || 'not set'}</span>
        <span className="chip chip-neutral">Intent: {effectGoals.length} Ziele</span>
        <span className="chip chip-neutral">Energy: {energyMode}</span>
        <span className={`chip ${activeStartframe.source === 'none' ? 'chip-warning' : 'chip-success'}`}>
          {activeStartframe.source === 'none' ? 'Startframe fehlt' : `Startframe aktiv (${activeStartframe.source})`}
        </span>
      </div>
    </article>
  );
}
