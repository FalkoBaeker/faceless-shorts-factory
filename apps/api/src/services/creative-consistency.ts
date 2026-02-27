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

export type CreativeConsistencyInput = {
  script: string;
  conceptId: string;
  moodPreset: MoodPreset;
  startFrameStyle: StartFrameStyle;
  userControls: UserControlProfile;
};

export type CreativeConsistencyResult = {
  ok: boolean;
  score: number;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

const hardSellPattern = /(nur heute|letzte chance|angebot endet|jetzt kaufen|sofort kaufen|heute noch sichern|deadline)/i;
const ctaPattern = /(jetzt|hier|sichern|testen|anfragen|buchen|mehr erfahren|besuch|komme vorbei)/i;
const problemPattern = /(problem|zu teuer|zu langsam|schwierig|frust|nervt|herausforderung|stress|wiederkehrend)/i;
const solutionPattern = /(lösung|wir helfen|einfach|in [0-9]+ schritten|schritt|so geht|damit)/i;
const beforeAfterPattern = /(vorher|nachher|davor|danach|früher|jetzt|früher vs|before|after)/i;
const testimonialPattern = /(ich|wir|kunde|kundin|erfahrung|bewertung|stimme|testimonial|vertrauen|empfehle)/i;
const offerPattern = /(angebot|rabatt|vorteil|preis|deal|aktion|bundle|spar|mehrwert)/i;

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
  const checks: CreativeConsistencyResult['checks'] = [];

  checks.push({
    id: 'SCRIPT_NON_EMPTY',
    ok: script.length >= 40,
    detail: `script_length=${script.length}`
  });

  checks.push({
    id: 'SCRIPT_ENDS_WITH_SENTENCE',
    ok: /[.!?…]$/.test(script),
    detail: 'script must end with punctuation'
  });

  checks.push({
    id: 'STARTFRAME_STYLE_CONCEPT_MATCH',
    ok: compatibleStyles[conceptId].includes(input.startFrameStyle),
    detail: `concept=${conceptId} style=${input.startFrameStyle}`
  });

  if (conceptId === 'concept_offer_focus') {
    checks.push({
      id: 'CONCEPT_OFFER_HAS_OFFER_SIGNAL',
      ok: offerPattern.test(script),
      detail: 'offer-focus requires offer/value cues'
    });
  }

  if (conceptId === 'concept_problem_solution') {
    checks.push({
      id: 'CONCEPT_PROBLEM_HAS_PROBLEM_SIGNAL',
      ok: problemPattern.test(script),
      detail: 'problem-solution requires problem cue'
    });
    checks.push({
      id: 'CONCEPT_PROBLEM_HAS_SOLUTION_SIGNAL',
      ok: solutionPattern.test(script),
      detail: 'problem-solution requires explicit solution cue'
    });
  }

  if (conceptId === 'concept_before_after') {
    checks.push({
      id: 'CONCEPT_BEFORE_AFTER_HAS_SIGNAL',
      ok: beforeAfterPattern.test(script),
      detail: 'before-after concept requires before/after language'
    });
  }

  if (conceptId === 'concept_testimonial') {
    checks.push({
      id: 'CONCEPT_TESTIMONIAL_HAS_SOCIAL_PROOF',
      ok: testimonialPattern.test(script),
      detail: 'testimonial concept requires social-proof language'
    });
  }

  if (input.moodPreset === 'humor_light') {
    checks.push({
      id: 'MOOD_HUMOR_NO_HARD_SELL',
      ok: !hardSellPattern.test(script),
      detail: 'humor_light forbids hard-sell deadline language'
    });
  }

  if (input.userControls.ctaStrength === 'soft') {
    checks.push({
      id: 'USER_CONTROL_SOFT_CTA_NOT_AGGRESSIVE',
      ok: !hardSellPattern.test(script),
      detail: 'soft CTA should avoid pressure phrasing'
    });
  }

  if (input.userControls.ctaStrength === 'strong') {
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
