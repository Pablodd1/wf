/**
 * Reference Validation Utility
 * Filters out bad references (years, prices, etc.) from dropdowns
 */

const YEAR_PATTERN = /^(19|20)\d{2}$/;  // 2018, 2023, 2025
const PRICE_SUFFIX = /(USD|EUR|GBP|CHF|HKD)$/i;  // 95000HKD, 340000USD
const EURO_PRICE = /^\d{1,3}\.\d{3}$/;  // 718.000 (European price format)
const SHORT_NUM = /^\d{1,3}$/;  // Single/double/triple digit numbers
const JUST_YEAR_LETTER = /^\d{4}[ymf]$/i;  // 2023y, 2025m

/**
 * Check if a string looks like a valid watch reference
 */
export function isValidReference(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (trimmed.length < 4) return false;  // Too short
  if (trimmed.length > 25) return false;  // Too long
  if (YEAR_PATTERN.test(trimmed)) return false;  // Is a year (2023)
  if (PRICE_SUFFIX.test(trimmed)) return false;  // Has price suffix (95000HKD)
  if (EURO_PRICE.test(trimmed)) return false;  // European price (718.000)
  if (SHORT_NUM.test(trimmed)) return false;  // Just a small number
  if (JUST_YEAR_LETTER.test(trimmed)) return false;  // Year+letter (2023y)
  // Must contain some letters OR be a known numeric reference pattern (5-6 digits)
  const hasLetters = /[a-zA-Z]/.test(trimmed);
  const isNumericRef = /^\d{5,6}$/.test(trimmed);  // Rolex-style 5-6 digit refs
  if (!hasLetters && !isNumericRef) return false;
  return true;
}

/**
 * Filter an array of references, removing bad ones
 */
export function filterValidReferences(refs: string[]): string[] {
  return refs.filter(isValidReference).sort();
}

/**
 * Filter an array of brand names, removing junk
 */
export function filterValidBrands(brands: string[]): string[] {
  return brands.filter(b => {
    if (!b || typeof b !== 'string') return false;
    const t = b.trim();
    if (t.length < 2) return false;
    if (YEAR_PATTERN.test(t)) return false;
    if (PRICE_SUFFIX.test(t)) return false;
    if (/^\d+$/.test(t)) return false;  // Pure number
    return true;
  }).sort();
}
