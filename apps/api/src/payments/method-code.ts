/**
 * Server-side `payment_methods.code` derivation, ported unchanged from
 * `slugifyMethodCode` in `lib/payments/catalog-admin.ts` (the web derived it
 * client-side before T9). The result satisfies the CHECK
 * `code ~ '^[a-z0-9_]{2,32}$'`: lowercase, accents stripped, any char outside
 * `[a-z0-9_]` collapsed to one `_`, edge `_` trimmed, clamped to 32, padded to
 * 2 with the `m_` pattern, suffixed `_2`, `_3`, ... on collision with the base
 * shortened so the suffix fits.
 */
const MAX_CODE_LEN = 32;
const MIN_CODE_LEN = 2;
const MIN_PADDING = 'm_';

const DIACRITICS_RE = /\p{Diacritic}/gu;
const NON_SLUG_RE = /[^a-z0-9_]+/g;
const UNDERSCORE_RUN_RE = /_+/g;
const EDGE_UNDERSCORES_RE = /^_+|_+$/g;

function baseSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(NON_SLUG_RE, '_')
    .replace(UNDERSCORE_RUN_RE, '_')
    .replace(EDGE_UNDERSCORES_RE, '');
}

const clamp = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max));

function padToMin(value: string): string {
  let padded = value;
  while (padded.length < MIN_CODE_LEN) {
    padded += MIN_PADDING[padded.length % MIN_PADDING.length];
  }
  return padded;
}

export function slugifyMethodCode(name: string, existingCodes: readonly string[] = []): string {
  const base = padToMin(clamp(baseSlug(name), MAX_CODE_LEN));
  const codes = new Set(existingCodes);
  if (!codes.has(base)) {
    return base;
  }
  for (let n = 2; n < 10_000; n++) {
    const suffix = `_${n}`;
    const candidate = clamp(base, MAX_CODE_LEN - suffix.length) + suffix;
    if (!codes.has(candidate)) {
      return candidate;
    }
  }
  // Unreachable in practice (a catalog holds a few dozen rows); keeps the signature total.
  return base;
}
