export type BrandProfileRecord = {
  organizationId: string;
  companyName: string;
  websiteUrl?: string;
  logoUrl?: string;
  brandTone?: string;
  primaryColorHex?: string;
  secondaryColorHex?: string;
  ctaStyle?: 'soft' | 'balanced' | 'strong';
  audienceHint?: string;
  valueProposition?: string;
  updatedAt: string;
};

const brandProfiles = new Map<string, BrandProfileRecord>();

const normalizeHex = (value: string | undefined) => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : undefined;
};

const clean = (value: string | undefined, max = 240) => {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, max);
};

export const getBrandProfile = (organizationId: string): BrandProfileRecord | null => {
  return brandProfiles.get(organizationId) ?? null;
};

export const upsertBrandProfile = (
  organizationId: string,
  payload: Omit<BrandProfileRecord, 'organizationId' | 'updatedAt'>
): BrandProfileRecord => {
  const existing = brandProfiles.get(organizationId);

  const next: BrandProfileRecord = {
    organizationId,
    companyName: clean(payload.companyName, 120) ?? existing?.companyName ?? '',
    websiteUrl: clean(payload.websiteUrl, 200),
    logoUrl: clean(payload.logoUrl, 400),
    brandTone: clean(payload.brandTone, 180),
    primaryColorHex: normalizeHex(payload.primaryColorHex),
    secondaryColorHex: normalizeHex(payload.secondaryColorHex),
    ctaStyle:
      payload.ctaStyle && ['soft', 'balanced', 'strong'].includes(payload.ctaStyle)
        ? payload.ctaStyle
        : undefined,
    audienceHint: clean(payload.audienceHint, 240),
    valueProposition: clean(payload.valueProposition, 280),
    updatedAt: new Date().toISOString()
  };

  brandProfiles.set(organizationId, next);
  return next;
};
