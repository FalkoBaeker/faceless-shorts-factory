export type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

export type StartFrameStyle =
  | 'storefront_hero'
  | 'product_macro'
  | 'owner_portrait'
  | 'hands_at_work'
  | 'before_after_split';

export type StoryboardConceptId =
  | 'concept_web_vertical_slice'
  | 'concept_offer_focus'
  | 'concept_problem_solution'
  | 'concept_before_after'
  | 'concept_testimonial';

export type UserControlProfile = {
  ctaStrength: 'soft' | 'balanced' | 'strong';
  motionIntensity: 'low' | 'medium' | 'high';
  shotPace: 'relaxed' | 'balanced' | 'fast';
  visualStyle: 'clean' | 'cinematic' | 'ugc';
};

export type CreativeEffectGoal =
  | 'sell_conversion'
  | 'funny'
  | 'cringe_hook'
  | 'testimonial_trust'
  | 'urgency_offer';

export type CreativeNarrativeFormat =
  | 'before_after'
  | 'dialog'
  | 'offer_focus'
  | 'commercial'
  | 'problem_solution';

export type ShotStyleTag =
  | 'cinematic_closeup'
  | 'over_shoulder'
  | 'handheld_push'
  | 'product_macro'
  | 'wide_establishing'
  | 'fast_cut_montage';

export type CreativeIntentSelection<T extends string = string> = {
  id: T;
  weight?: number;
  priority?: 1 | 2 | 3;
};

export type CreativeIntentMatrix = {
  effectGoals: Array<CreativeIntentSelection<CreativeEffectGoal>>;
  narrativeFormats: Array<CreativeIntentSelection<CreativeNarrativeFormat>>;
  energyMode?: 'auto' | 'high' | 'calm';
  shotStyles?: Array<CreativeIntentSelection<ShotStyleTag>>;
};

export type StoryboardBeat = {
  beatId: string;
  order: number;
  action: string;
  visualHint?: string;
  dialogueHint?: string;
  onScreenTextHint?: string;
};

export type StoryboardLight = {
  beats: StoryboardBeat[];
  hookHint?: string;
  ctaHint?: string;
  pacingHint?: string;
};

export type CreativeConsistencyInput = {
  script: string;
  conceptId: string;
  moodPreset: MoodPreset;
  startFrameStyle: StartFrameStyle;
  userControls?: Partial<UserControlProfile>;
  creativeIntent?: CreativeIntentMatrix;
  storyboardLight?: StoryboardLight;
};

export type CreativeConsistencyResult = {
  ok: boolean;
  score: number;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

const hardSellPattern = /(nur heute|letzte chance|angebot endet|jetzt kaufen|sofort kaufen|heute noch sichern|deadline)/i;
const ctaPattern = /(jetzt|hier|sichern|testen|anfragen|buchen|mehr erfahren|besuch|komme vorbei|termin)/i;
const problemPattern = /(problem|zu teuer|zu langsam|schwierig|frust|nervt|herausforderung|stress|wiederkehrend)/i;
const solutionPattern = /(lösung|wir helfen|einfach|in [0-9]+ schritten|schritt|so geht|damit)/i;
const beforeAfterPattern = /(vorher|nachher|davor|danach|früher|jetzt|früher vs|before|after)/i;
const testimonialPattern = /(ich|wir|kunde|kundin|erfahrung|bewertung|stimme|testimonial|vertrauen|empfehle)/i;
const offerPattern = /(angebot|rabatt|vorteil|preis|deal|aktion|bundle|spar|mehrwert)/i;
const hookPattern = /(achtung|stop|stell dir vor|du kennst das|endlich|warum|in nur|sofort|so gewinnst|hier ist)/i;

export type HookTemplateId =
  | 'hook_offer_urgency'
  | 'hook_problem_pain'
  | 'hook_social_proof'
  | 'hook_curiosity'
  | 'hook_fun_pattern_break'
  | 'hook_default';

const hookTemplatePattern: Record<HookTemplateId, RegExp> = {
  hook_offer_urgency: /(nur heute|jetzt sichern|limitierte|letzte chance|nur noch|angebot endet|sofort)/i,
  hook_problem_pain: /(kennst du das|problem|nervt|frust|zu teuer|zu langsam|endlich loswerden|schluss mit)/i,
  hook_social_proof: /(kund|bewertung|stimme|testimonial|vertrauen|empfehlen|erfahrung)/i,
  hook_curiosity: /(stell dir vor|was wäre wenn|warum|so geht|hier ist|in nur|der trick)/i,
  hook_fun_pattern_break: /(warte|plot twist|cringe|unexpected|du glaubst nicht|stop|achtung)/i,
  hook_default: hookPattern
};

export const resolveHookTemplateId = (intent: CreativeIntentMatrix): HookTemplateId => {
  const effectIds = intent.effectGoals.map((entry) => entry.id);
  const narrativeIds = intent.narrativeFormats.map((entry) => entry.id);

  if (effectIds.includes('urgency_offer') || narrativeIds.includes('offer_focus')) return 'hook_offer_urgency';
  if (narrativeIds.includes('problem_solution') || narrativeIds.includes('before_after')) return 'hook_problem_pain';
  if (effectIds.includes('testimonial_trust') || narrativeIds.includes('dialog')) return 'hook_social_proof';
  if (effectIds.includes('funny') || effectIds.includes('cringe_hook')) return 'hook_fun_pattern_break';
  if (effectIds.includes('sell_conversion') || narrativeIds.includes('commercial')) return 'hook_curiosity';
  return 'hook_default';
};

const compatibleStyles: Record<StoryboardConceptId, StartFrameStyle[]> = {
  concept_web_vertical_slice: ['storefront_hero', 'product_macro', 'owner_portrait', 'hands_at_work', 'before_after_split'],
  concept_offer_focus: ['product_macro', 'storefront_hero', 'hands_at_work'],
  concept_problem_solution: ['before_after_split', 'hands_at_work', 'product_macro'],
  concept_before_after: ['before_after_split', 'hands_at_work'],
  concept_testimonial: ['owner_portrait', 'storefront_hero', 'hands_at_work']
};

const asConcept = (conceptId: string): StoryboardConceptId => {
  if (
    [
      'concept_web_vertical_slice',
      'concept_offer_focus',
      'concept_problem_solution',
      'concept_before_after',
      'concept_testimonial'
    ].includes(conceptId)
  ) {
    return conceptId as StoryboardConceptId;
  }
  return 'concept_web_vertical_slice';
};

const clampWeight = (weight: number | undefined) => {
  if (!Number.isFinite(weight)) return 1;
  return Math.max(0.1, Math.min(1, Number(weight)));
};

const normalizeSelectionList = <T extends string>(
  input: Array<CreativeIntentSelection<T>> | undefined,
  allowed: readonly T[]
): Array<CreativeIntentSelection<T>> => {
  if (!Array.isArray(input)) return [];

  const map = new Map<T, CreativeIntentSelection<T>>();
  for (const raw of input) {
    const id = String(raw?.id ?? '') as T;
    if (!allowed.includes(id)) continue;

    const normalized: CreativeIntentSelection<T> = {
      id,
      weight: clampWeight(raw?.weight),
      priority: raw?.priority && [1, 2, 3].includes(raw.priority) ? raw.priority : undefined
    };

    const existing = map.get(id);
    if (!existing || Number(normalized.weight ?? 0) > Number(existing.weight ?? 0)) {
      map.set(id, normalized);
    }
  }

  return [...map.values()];
};

const fallbackIntentFromMood = (mood: MoodPreset, conceptId: string): CreativeIntentMatrix => {
  const concept = asConcept(conceptId);

  if (mood === 'problem_solution') {
    return {
      effectGoals: [{ id: 'sell_conversion', weight: 1 }],
      narrativeFormats: [
        { id: 'problem_solution', weight: 1 },
        { id: 'before_after', weight: concept === 'concept_before_after' ? 1 : 0.6 }
      ],
      energyMode: 'high',
      shotStyles: [{ id: 'fast_cut_montage', weight: 0.7 }, { id: 'handheld_push', weight: 0.8 }]
    };
  }

  if (mood === 'testimonial') {
    return {
      effectGoals: [{ id: 'testimonial_trust', weight: 1 }],
      narrativeFormats: [{ id: 'dialog', weight: 0.8 }, { id: 'commercial', weight: 0.5 }],
      energyMode: 'auto',
      shotStyles: [{ id: 'over_shoulder', weight: 0.8 }, { id: 'wide_establishing', weight: 0.6 }]
    };
  }

  if (mood === 'humor_light') {
    return {
      effectGoals: [{ id: 'funny', weight: 0.8 }, { id: 'cringe_hook', weight: 0.5 }],
      narrativeFormats: [{ id: 'commercial', weight: 0.7 }, { id: 'dialog', weight: 0.6 }],
      energyMode: 'auto',
      shotStyles: [{ id: 'handheld_push', weight: 0.8 }, { id: 'fast_cut_montage', weight: 0.5 }]
    };
  }

  return {
    effectGoals: [{ id: 'sell_conversion', weight: 1 }, { id: 'urgency_offer', weight: 0.8 }],
    narrativeFormats: [{ id: 'commercial', weight: 1 }, { id: 'offer_focus', weight: 0.9 }],
    energyMode: 'high',
    shotStyles: [{ id: 'cinematic_closeup', weight: 0.8 }, { id: 'product_macro', weight: 0.9 }]
  };
};

export const normalizeCreativeIntent = (
  input: CreativeIntentMatrix | undefined,
  fallbackMood: MoodPreset,
  conceptId: string
): CreativeIntentMatrix => {
  const effectGoals = normalizeSelectionList(input?.effectGoals, [
    'sell_conversion',
    'funny',
    'cringe_hook',
    'testimonial_trust',
    'urgency_offer'
  ] as const);

  const narrativeFormats = normalizeSelectionList(input?.narrativeFormats, [
    'before_after',
    'dialog',
    'offer_focus',
    'commercial',
    'problem_solution'
  ] as const);

  const shotStyles = normalizeSelectionList(input?.shotStyles, [
    'cinematic_closeup',
    'over_shoulder',
    'handheld_push',
    'product_macro',
    'wide_establishing',
    'fast_cut_montage'
  ] as const);

  const energyMode = input?.energyMode && ['auto', 'high', 'calm'].includes(input.energyMode) ? input.energyMode : 'auto';

  if (effectGoals.length || narrativeFormats.length || shotStyles.length) {
    return {
      effectGoals: effectGoals.length ? effectGoals : fallbackIntentFromMood(fallbackMood, conceptId).effectGoals,
      narrativeFormats: narrativeFormats.length ? narrativeFormats : fallbackIntentFromMood(fallbackMood, conceptId).narrativeFormats,
      shotStyles: shotStyles.length ? shotStyles : fallbackIntentFromMood(fallbackMood, conceptId).shotStyles,
      energyMode
    };
  }

  return fallbackIntentFromMood(fallbackMood, conceptId);
};

export const deriveLegacyMoodPresetFromIntent = (
  intent: CreativeIntentMatrix | undefined,
  fallbackMood: MoodPreset,
  conceptId: string
): MoodPreset => {
  const normalized = normalizeCreativeIntent(intent, fallbackMood, conceptId);
  const effectIds = normalized.effectGoals.map((entry) => entry.id);
  const narrativeIds = normalized.narrativeFormats.map((entry) => entry.id);

  if (effectIds.includes('funny')) return 'humor_light';
  if (effectIds.includes('testimonial_trust') || narrativeIds.includes('dialog')) return 'testimonial';
  if (narrativeIds.includes('problem_solution') || narrativeIds.includes('before_after')) return 'problem_solution';
  return 'commercial_cta';
};

const normalizeText = (value: unknown, maxLen: number) => String(value ?? '').trim().slice(0, maxLen);

export const normalizeStoryboardLight = (input?: StoryboardLight): StoryboardLight | undefined => {
  if (!input || !Array.isArray(input.beats)) return undefined;

  const beats = input.beats
    .slice(0, 8)
    .map((beat, index) => {
      const action = normalizeText(beat?.action, 240);
      if (!action) return null;

      return {
        beatId: normalizeText(beat?.beatId, 40) || `beat_${index + 1}`,
        order: Number.isFinite(beat?.order) ? Math.max(1, Math.floor(beat.order)) : index + 1,
        action,
        visualHint: normalizeText(beat?.visualHint, 180) || undefined,
        dialogueHint: normalizeText(beat?.dialogueHint, 180) || undefined,
        onScreenTextHint: normalizeText(beat?.onScreenTextHint, 120) || undefined
      };
    })
    .filter((beat): beat is StoryboardBeat => Boolean(beat))
    .sort((a, b) => a.order - b.order);

  if (!beats.length) return undefined;

  return {
    beats,
    hookHint: normalizeText(input.hookHint, 180) || undefined,
    ctaHint: normalizeText(input.ctaHint, 180) || undefined,
    pacingHint: normalizeText(input.pacingHint, 120) || undefined
  };
};

export const normalizeUserControlProfile = (input?: Partial<UserControlProfile>): UserControlProfile => {
  const ctaStrength = input?.ctaStrength;
  const motionIntensity = input?.motionIntensity;
  const shotPace = input?.shotPace;
  const visualStyle = input?.visualStyle;

  return {
    ctaStrength: ctaStrength && ['soft', 'balanced', 'strong'].includes(ctaStrength) ? ctaStrength : 'balanced',
    motionIntensity:
      motionIntensity && ['low', 'medium', 'high'].includes(motionIntensity) ? motionIntensity : 'medium',
    shotPace: shotPace && ['relaxed', 'balanced', 'fast'].includes(shotPace) ? shotPace : 'balanced',
    visualStyle: visualStyle && ['clean', 'cinematic', 'ugc'].includes(visualStyle) ? visualStyle : 'clean'
  };
};

export const validateCreativeConsistency = (input: CreativeConsistencyInput): CreativeConsistencyResult => {
  const script = String(input.script ?? '').trim();
  const conceptId = asConcept(input.conceptId);
  const storyboard = normalizeStoryboardLight(input.storyboardLight);
  const intent = normalizeCreativeIntent(input.creativeIntent, input.moodPreset, input.conceptId);
  const controls = normalizeUserControlProfile(input.userControls);

  const scriptLines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const structuredScript = scriptLines.some((line) =>
    /^(?:\d+[.)]\s*)?(?:kamera|bild\/aktion|dialog(?:\s*voice)?|dialog\/voiceover|voiceover|sprecher)\s*:/i.test(line)
  );
  const firstDialogLikeLine = scriptLines.find((line) =>
    /^(?:\d+[.)]\s*)?(?:dialog(?:\s*voice)?|dialog\/voiceover|voiceover|sprecher)\s*:/i.test(line)
  );
  const firstDialogText = firstDialogLikeLine
    ? firstDialogLikeLine.replace(/^(?:\d+[.)]\s*)?(?:dialog(?:\s*voice)?|dialog\/voiceover|voiceover|sprecher)\s*[:\-]\s*/i, '').trim()
    : '';

  const checks: CreativeConsistencyResult['checks'] = [];

  checks.push({
    id: 'SCRIPT_NON_EMPTY',
    ok: script.length >= 40,
    detail: `script_length=${script.length}`
  });

  checks.push({
    id: 'SCRIPT_ENDS_WITH_SENTENCE',
    ok: /[.!?…]["')\]]*\s*$/.test(script),
    detail: 'script must end with punctuation'
  });

  checks.push({
    id: 'STARTFRAME_STYLE_CONCEPT_MATCH',
    ok: compatibleStyles[conceptId].includes(input.startFrameStyle),
    detail: `concept=${conceptId} style=${input.startFrameStyle}`
  });

  const firstSentenceRaw = script.split(/[.!?…]/)[0]?.trim() ?? '';
  const firstSentence = structuredScript && firstDialogText ? firstDialogText : firstSentenceRaw;
  const firstSentenceWords = firstSentence.split(/\s+/).filter(Boolean).length;
  const explicitIntentProvided =
    Boolean(input.creativeIntent?.effectGoals?.length) ||
    Boolean(input.creativeIntent?.narrativeFormats?.length) ||
    Boolean(input.creativeIntent?.shotStyles?.length) ||
    ['high', 'calm'].includes(String(input.creativeIntent?.energyMode ?? ''));

  const highEnergyIntent =
    intent.energyMode === 'high' ||
    intent.effectGoals.some((entry) => ['sell_conversion', 'urgency_offer', 'cringe_hook'].includes(entry.id));
  const calmMode = intent.energyMode === 'calm';

  const hookTemplateId = resolveHookTemplateId(intent);
  const hookTemplateHit = hookTemplatePattern[hookTemplateId].test(firstSentence);
  const hookFallbackHit = hookPattern.test(firstSentence);
  const firstSentenceImpactEnough = firstSentence.length >= (highEnergyIntent ? 18 : 12) && firstSentenceWords <= 18;

  checks.push({
    id: 'HOOK_FIRST_SECOND_QUALITY',
    ok: !explicitIntentProvided || calmMode || ((hookTemplateHit || hookFallbackHit) && firstSentenceImpactEnough),
    detail: `strict=${explicitIntentProvided} calmMode=${calmMode} template=${hookTemplateId} templateHit=${hookTemplateHit} fallbackHit=${hookFallbackHit} firstSentenceLength=${firstSentence.length} firstSentenceWords=${firstSentenceWords}`
  });

  const intentAlignmentSignals = [
    intent.narrativeFormats.some((entry) => entry.id === 'problem_solution')
      ? problemPattern.test(script) && solutionPattern.test(script)
      : true,
    intent.narrativeFormats.some((entry) => entry.id === 'before_after') ? beforeAfterPattern.test(script) : true,
    intent.narrativeFormats.some((entry) => entry.id === 'offer_focus') ? offerPattern.test(script) : true,
    intent.effectGoals.some((entry) => entry.id === 'testimonial_trust') ? testimonialPattern.test(script) : true,
    highEnergyIntent && !calmMode ? ctaPattern.test(script) : true
  ];

  const alignmentScore = Math.round(
    (intentAlignmentSignals.filter(Boolean).length / Math.max(1, intentAlignmentSignals.length)) * 100
  );

  checks.push({
    id: 'INTENT_SCRIPT_ALIGNMENT_SCORE_MIN',
    ok: !explicitIntentProvided || alignmentScore >= (calmMode ? 50 : 70),
    detail: `strict=${explicitIntentProvided} alignmentScore=${alignmentScore}`
  });

  checks.push({
    id: 'CALM_EXCEPTION_EXPLICIT',
    ok: calmMode ? !hardSellPattern.test(script) : true,
    detail: `energyMode=${intent.energyMode ?? 'auto'}`
  });

  if (storyboard) {
    const actionableBeats = storyboard.beats.filter((beat) => beat.action.length >= 8).length;
    checks.push({
      id: 'STORYBOARD_BEAT_COVERAGE_MIN',
      ok: actionableBeats >= Math.min(2, storyboard.beats.length),
      detail: `actionableBeats=${actionableBeats}/${storyboard.beats.length}`
    });
  }

  if (input.moodPreset === 'humor_light') {
    checks.push({
      id: 'MOOD_HUMOR_NO_HARD_SELL',
      ok: !hardSellPattern.test(script),
      detail: 'humor_light forbids hard-sell deadline language'
    });
  }

  if (controls.ctaStrength === 'soft') {
    checks.push({
      id: 'USER_CONTROL_SOFT_CTA_NOT_AGGRESSIVE',
      ok: !hardSellPattern.test(script),
      detail: 'soft CTA should avoid pressure phrasing'
    });
  }

  if (controls.ctaStrength === 'strong') {
    checks.push({
      id: 'USER_CONTROL_STRONG_CTA_PRESENT',
      ok: ctaPattern.test(script),
      detail: 'strong CTA requires explicit action phrase'
    });
  }

  if (input.moodPreset === 'testimonial' && conceptId === 'concept_before_after') {
    checks.push({
      id: 'MOOD_CONCEPT_CONFLICT_TESTIMONIAL_BEFORE_AFTER',
      ok: false,
      detail: 'testimonial mood conflicts with hard before/after framing'
    });
  }

  const failed = checks.filter((check) => !check.ok);
  const ok = failed.length === 0;
  const passedChecks = checks.length - failed.length;
  const score = Math.max(0, Math.min(100, Math.round((passedChecks / Math.max(1, checks.length)) * 100)));

  return {
    ok,
    score,
    reasons: failed.map((check) => check.id),
    checks
  };
};
