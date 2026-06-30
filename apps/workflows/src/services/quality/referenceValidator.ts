/**
 * referenceValidator.ts — Enhanced Reference Validation (v1.1)
 *
 * Filters invalid references from dropdown data (years, prices, duplicates,
 * non-watch products). Used by NORM_004 quality gate.
 */

const YEAR_PATTERN = /^\d{4}$/;
const PRICE_SUFFIX = /^\d{3,6}(HKD|USD)$/i;
const NON_WATCH_KEYWORDS = [
  'bag', 'shoulder bag', 'leather', 'crossbody', 'tote', 'clutch', 'wallet',
  'purse', 'backpack',
];

/**
 * Check whether a single reference string is valid.
 * Rejects years, bare numbers, price-as-reference patterns,
 * and non-watch product keywords.
 */
export function isValidReference(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const t = ref.trim();
  if (t.length < 2) return false;
  if (YEAR_PATTERN.test(t)) return false;
  if (PRICE_SUFFIX.test(t)) return false;
  if (/^\d+$/.test(t)) return false;

  const lower = t.toLowerCase();
  if (NON_WATCH_KEYWORDS.some(kw => lower.includes(kw))) return false;

  return true;
}

/**
 * Deduplicate, strip falsy values, filter valid references, and sort.
 */
export function filterValidReferences(refs: string[]): string[] {
  const unique = [...new Set(refs.filter(Boolean))];
  return unique.filter(isValidReference).sort();
}

/**
 * Deduplicate, strip falsy values, filter valid brands, and sort.
 */
export function filterValidBrands(brands: string[]): string[] {
  const unique = [...new Set(brands.filter(Boolean))];
  return unique
    .filter(b => {
      if (!b || typeof b !== 'string') return false;
      const t = b.trim();
      if (t.length < 2) return false;
      if (YEAR_PATTERN.test(t)) return false;
      if (PRICE_SUFFIX.test(t)) return false;
      if (/^\d+$/.test(t)) return false;
      return true;
    })
    .sort();
}

/**
 * Detect whether the given text describes a non-watch product
 * (e.g., bag, leather goods, wallet).
 */
export function isNonWatchProduct(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NON_WATCH_KEYWORDS.some(kw => lower.includes(kw));
}
