import { createHash } from 'node:crypto';

type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

type StartFrameStyle =
  | 'storefront_hero'
  | 'product_macro'
  | 'owner_portrait'
  | 'hands_at_work'
  | 'before_after_split';

export type StartFrameCandidate = {
  candidateId: string;
  style: StartFrameStyle;
  label: string;
  description: string;
  prompt: string;
};

const styleCatalog: Record<
  StartFrameStyle,
  {
    label: string;
    description: string;
    prompt: string;
  }
> = {
  storefront_hero: {
    label: 'Storefront Hero',
    description: 'Klare Hero-Einstellung der Marke/Ladenfront als vertrauensvoller Einstieg.',
    prompt: 'Startframe: Hero-Aufnahme der Ladenfront/Marke, gut ausgeleuchtet, ruhiger Hintergrund.'
  },
  product_macro: {
    label: 'Produkt-Makro',
    description: 'Nahaufnahme des Kernprodukts für sofortigen visuellen Fokus.',
    prompt: 'Startframe: Produkt-Makroaufnahme mit hoher Detailtiefe und klarer Trennung vom Hintergrund.'
  },
  owner_portrait: {
    label: 'Owner Portrait',
    description: 'Menschlicher Einstieg mit glaubwürdigem Gesichts-/Vertrauenssignal.',
    prompt: 'Startframe: freundliches Owner-Portrait, Blick zur Kamera, professionell aber authentisch.'
  },
  hands_at_work: {
    label: 'Hands at Work',
    description: 'Aktiver Start über den Arbeitsprozess bzw. das Handwerk.',
    prompt: 'Startframe: Hände bei der Arbeit/Herstellung, dynamisch und handwerklich nah.'
  },
  before_after_split: {
    label: 'Before/After Split',
    description: 'Vorher/Nachher-Visual direkt in Frame 1 für starke Wirkung.',
    prompt: 'Startframe: Vorher/Nachher-Split mit klaren visuellen Unterschieden.'
  }
};

const moodToStylePriority: Record<MoodPreset, StartFrameStyle[]> = {
  commercial_cta: ['storefront_hero', 'product_macro', 'hands_at_work', 'owner_portrait', 'before_after_split'],
  problem_solution: ['before_after_split', 'hands_at_work', 'product_macro', 'storefront_hero', 'owner_portrait'],
  testimonial: ['owner_portrait', 'storefront_hero', 'hands_at_work', 'product_macro', 'before_after_split'],
  humor_light: ['hands_at_work', 'owner_portrait', 'storefront_hero', 'before_after_split', 'product_macro']
};

const conceptBoost: Array<{ key: string; style: StartFrameStyle }> = [
  { key: 'offer', style: 'product_macro' },
  { key: 'problem', style: 'before_after_split' },
  { key: 'before_after', style: 'before_after_split' },
  { key: 'testimonial', style: 'owner_portrait' }
];

const normalizeMood = (value?: string): MoodPreset => {
  if (value && ['commercial_cta', 'problem_solution', 'testimonial', 'humor_light'].includes(value)) {
    return value as MoodPreset;
  }
  return 'commercial_cta';
};

const normalizeLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(3, Math.min(5, Math.floor(parsed)));
};

const makeCandidateId = (input: { topic: string; conceptId?: string; moodPreset: MoodPreset; style: StartFrameStyle }) => {
  const base = `${input.topic}|${input.conceptId ?? 'default'}|${input.moodPreset}|${input.style}`;
  const hash = createHash('sha1').update(base).digest('hex').slice(0, 10);
  return `sfc_${input.style}_${hash}`;
};

const rankStyles = (input: { topic: string; conceptId?: string; moodPreset: MoodPreset }) => {
  const base = [...moodToStylePriority[input.moodPreset]];
  const conceptKey = String(input.conceptId ?? '').toLowerCase();

  for (const boost of conceptBoost) {
    if (!conceptKey.includes(boost.key)) continue;
    const idx = base.indexOf(boost.style);
    if (idx > 0) {
      base.splice(idx, 1);
      base.unshift(boost.style);
    }
  }

  return base;
};

export const buildStartFrameCandidates = (input: {
  topic: string;
  conceptId?: string;
  moodPreset?: string;
  limit?: number;
}): StartFrameCandidate[] => {
  const topic = String(input.topic ?? '').trim();
  if (!topic) throw new Error('TOPIC_REQUIRED');

  const moodPreset = normalizeMood(input.moodPreset);
  const limit = normalizeLimit(input.limit);
  const styles = rankStyles({ topic, conceptId: input.conceptId, moodPreset }).slice(0, limit);

  return styles.map((style) => {
    const entry = styleCatalog[style];
    return {
      candidateId: makeCandidateId({ topic, conceptId: input.conceptId, moodPreset, style }),
      style,
      label: entry.label,
      description: entry.description,
      prompt: entry.prompt
    };
  });
};

export const resolveSelectedStartFrame = (input: {
  topic: string;
  conceptId?: string;
  moodPreset?: string;
  startFrameCandidateId?: string;
  startFrameStyle?: string;
}) => {
  const candidates = buildStartFrameCandidates({
    topic: input.topic,
    conceptId: input.conceptId,
    moodPreset: input.moodPreset,
    limit: 5
  });

  const byId = candidates.find((candidate) => candidate.candidateId === input.startFrameCandidateId);
  if (byId) return byId;

  if (input.startFrameStyle) {
    const byStyle = candidates.find((candidate) => candidate.style === input.startFrameStyle);
    if (byStyle) return byStyle;
  }

  return null;
};
