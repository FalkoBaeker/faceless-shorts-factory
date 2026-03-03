import { createHash } from 'node:crypto';

type MoodPreset = 'commercial_cta' | 'problem_solution' | 'testimonial' | 'humor_light';

type CreativeIntent = {
  effectGoals?: Array<{ id?: string; weight?: number }>;
  narrativeFormats?: Array<{ id?: string; weight?: number }>;
  energyMode?: 'auto' | 'high' | 'calm';
};

type BrandProfile = {
  companyName: string;
  websiteUrl?: string;
  brandTone?: string;
  audienceHint?: string;
  valueProposition?: string;
  ctaStyle?: 'soft' | 'balanced' | 'strong';
  primaryColorHex?: string;
  secondaryColorHex?: string;
};

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
  thumbnailUrl: string;
  thumbnailObjectPath?: string;
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

const styleVisual: Record<StartFrameStyle, { emoji: string; gradientA: string; gradientB: string }> = {
  storefront_hero: { emoji: '🏪', gradientA: '#6A85FF', gradientB: '#5FD1FF' },
  product_macro: { emoji: '📦', gradientA: '#8B5CF6', gradientB: '#C084FC' },
  owner_portrait: { emoji: '🙂', gradientA: '#3B82F6', gradientB: '#22D3EE' },
  hands_at_work: { emoji: '🛠️', gradientA: '#10B981', gradientB: '#34D399' },
  before_after_split: { emoji: '↔️', gradientA: '#F59E0B', gradientB: '#FB7185' }
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

const compact = (value: unknown, max = 220) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

const buildBrandFocusText = (brandProfile?: BrandProfile) => {
  if (!brandProfile?.companyName?.trim()) return '';
  const parts = [
    `Marke: ${compact(brandProfile.companyName, 80)}.`,
    brandProfile.brandTone ? `Ton: ${compact(brandProfile.brandTone, 90)}.` : '',
    brandProfile.valueProposition ? `Nutzenversprechen: ${compact(brandProfile.valueProposition, 140)}.` : '',
    brandProfile.audienceHint ? `Zielgruppe: ${compact(brandProfile.audienceHint, 120)}.` : ''
  ].filter(Boolean);
  return parts.join(' ');
};

const buildIntentFocusText = (creativeIntent?: CreativeIntent) => {
  if (!creativeIntent) return '';
  const effectGoals = (creativeIntent.effectGoals ?? [])
    .map((entry) => compact(entry.id, 40))
    .filter(Boolean)
    .slice(0, 6);
  const narrativeFormats = (creativeIntent.narrativeFormats ?? [])
    .map((entry) => compact(entry.id, 40))
    .filter(Boolean)
    .slice(0, 4);
  const energyMode = compact(creativeIntent.energyMode ?? '', 12);
  const parts = [
    effectGoals.length ? `Wirkziel: ${effectGoals.join(', ')}.` : '',
    narrativeFormats.length ? `Narrativ: ${narrativeFormats.join(', ')}.` : '',
    energyMode ? `Energy: ${energyMode}.` : ''
  ].filter(Boolean);
  return parts.join(' ');
};

const buildEntityLockRule = (topic: string) =>
  [
    `Topic-Lock (verbindlich): "${compact(topic, 240)}".`,
    'Wenn das Topic eine konkrete Unterkategorie nennt (z. B. Rasse, Produkttyp, Modell, Material), muss genau diese Unterkategorie gezeigt werden.',
    'Keine Ersetzung durch generische oder benachbarte Kategorien.'
  ].join(' ');

const rankStyles = (input: { topic: string; conceptId?: string; moodPreset: MoodPreset; creativeIntent?: CreativeIntent }) => {
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

  const narrativeIds = (input.creativeIntent?.narrativeFormats ?? []).map((entry) => String(entry.id ?? ''));
  if (narrativeIds.includes('before_after')) {
    const idx = base.indexOf('before_after_split');
    if (idx > 0) {
      base.splice(idx, 1);
      base.unshift('before_after_split');
    }
  }

  if (narrativeIds.includes('offer_focus')) {
    const idx = base.indexOf('product_macro');
    if (idx > 0) {
      base.splice(idx, 1);
      base.unshift('product_macro');
    }
  }

  return base;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const buildThumbnail = (input: { style: StartFrameStyle; label: string; topic: string }) => {
  const visual = styleVisual[input.style];
  const topic = escapeHtml(input.topic.trim().slice(0, 42) || 'Dein Topic');
  const label = escapeHtml(input.label);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${visual.gradientA}"/>
      <stop offset="100%" stop-color="${visual.gradientB}"/>
    </linearGradient>
  </defs>
  <rect width="720" height="1280" fill="url(#bg)"/>
  <rect x="44" y="60" width="632" height="1160" rx="36" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
  <text x="360" y="420" text-anchor="middle" font-size="108">${visual.emoji}</text>
  <text x="360" y="530" text-anchor="middle" fill="#ffffff" font-size="42" font-family="Arial" font-weight="700">${label}</text>
  <text x="360" y="585" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-size="28" font-family="Arial">${topic}</text>
  <text x="360" y="1120" text-anchor="middle" fill="rgba(255,255,255,0.80)" font-size="24" font-family="Arial">Preview Startframe • 9:16</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const buildStartFrameCandidates = (input: {
  topic: string;
  conceptId?: string;
  moodPreset?: string;
  creativeIntent?: CreativeIntent;
  brandProfile?: BrandProfile;
  limit?: number;
}): StartFrameCandidate[] => {
  const topic = String(input.topic ?? '').trim();
  if (!topic) throw new Error('TOPIC_REQUIRED');

  const moodPreset = normalizeMood(input.moodPreset);
  const limit = normalizeLimit(input.limit);
  const styles = rankStyles({
    topic,
    conceptId: input.conceptId,
    moodPreset,
    creativeIntent: input.creativeIntent
  }).slice(0, limit);

  return styles.map((style) => {
    const entry = styleCatalog[style];
    const brandFocus = buildBrandFocusText(input.brandProfile);
    const intentFocus = buildIntentFocusText(input.creativeIntent);
    const entityLockRule = buildEntityLockRule(topic);
    const description = [
      entry.description,
      `Fokus: ${compact(topic, 120)}.`,
      input.brandProfile?.companyName ? `Marke: ${compact(input.brandProfile.companyName, 80)}.` : ''
    ]
      .filter(Boolean)
      .join(' ');
    const prompt = [
      entry.prompt,
      `Topic-Fokus: ${compact(topic, 240)}.`,
      brandFocus,
      intentFocus,
      entityLockRule
    ]
      .filter(Boolean)
      .join(' ');

    return {
      candidateId: makeCandidateId({ topic, conceptId: input.conceptId, moodPreset, style }),
      style,
      label: entry.label,
      description: compact(description, 360),
      prompt: compact(prompt, 1200),
      thumbnailUrl: buildThumbnail({ style, label: entry.label, topic })
    };
  });
};

export const resolveSelectedStartFrame = (input: {
  topic: string;
  conceptId?: string;
  moodPreset?: string;
  creativeIntent?: CreativeIntent;
  brandProfile?: BrandProfile;
  startFrameCandidateId?: string;
  startFrameStyle?: string;
}) => {
  const candidates = buildStartFrameCandidates({
    topic: input.topic,
    conceptId: input.conceptId,
    moodPreset: input.moodPreset,
    creativeIntent: input.creativeIntent,
    brandProfile: input.brandProfile,
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
