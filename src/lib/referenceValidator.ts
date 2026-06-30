/**
 * Reference Validation Utility
 * Filters out bad references (years, prices, etc.) from dropdowns
 */

const YEAR_PATTERN = /^(19|20)\d{2}$/;
const PRICE_SUFFIX = /(USD|EUR|GBP|CHF|HKD)$/i;
const EURO_PRICE = /^\d{1,3}\.\d{3}$/;
const SHORT_NUM = /^\d{1,3}$/;
const JUST_YEAR_LETTER = /^\d{4}[ymf]$/i;

export function isValidReference(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (trimmed.length < 4) return false;
  if (trimmed.length > 25) return false;
  if (YEAR_PATTERN.test(trimmed)) return false;
  if (PRICE_SUFFIX.test(trimmed)) return false;
  if (EURO_PRICE.test(trimmed)) return false;
  if (SHORT_NUM.test(trimmed)) return false;
  if (JUST_YEAR_LETTER.test(trimmed)) return false;
  if (/^\d{4,7}[KM]$/i.test(trimmed)) return false;
  const hasLetters = /[a-zA-Z]/.test(trimmed);
  const isNumericRef = /^\d{5,6}$/.test(trimmed);
  if (!hasLetters && !isNumericRef) return false;
  return true;
}

export function filterValidReferences(refs: string[]): string[] {
  return [...new Set(refs.filter(isValidReference))].sort();
}

export function filterValidBrands(brands: string[]): string[] {
  return [...new Set(brands.filter(b => {
    if (!b || typeof b !== 'string') return false;
    const t = b.trim();
    if (t.length < 2) return false;
    if (YEAR_PATTERN.test(t)) return false;
    if (PRICE_SUFFIX.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  }))].sort();
}
