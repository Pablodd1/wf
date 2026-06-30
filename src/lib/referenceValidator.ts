/**
 * Reference & Brand Validation Utility
 * Filters out bad data (years, prices, references-as-brands, colors, conditions) from dropdowns
 */

// ─── Patterns for references ──────────────────────────────────────
const YEAR_PATTERN = /^(19|20)\d{2}$/;  // 2018, 2023, 2025
const PRICE_SUFFIX = /(USD|EUR|GBP|CHF|HKD)$/i;  // 95000HKD, 340000USD
const EURO_PRICE = /^\d{1,3}\.\d{3}$/;  // 718.000 (European price format)
const SHORT_NUM = /^\d{1,3}$/;  // Single/double/triple digit numbers
const JUST_YEAR_LETTER = /^\d{4}[ymf]$/i;  // 2023y, 2025m

// ─── Patterns for brands ──────────────────────────────────────────
const REFERENCE_LIKE = /^(?:\d{1,2}[/-])?\d{2,6}[a-zA-Z]{0,4}(?:[/-]\d{2,6})?(?:\.[A-Z]{2,6})?$/;
// Matches: 15510OR, 16613, 26470SO, 7118/1A, 6000V/110R, 505.CM.5970.RX, A3239011.BC34
const PURE_NUMBER = /^\d+$/;
const PRICE_TEXT = /^\d+\s*(?:million|mln|k|M|bn)$/i;  // "5 million"
const WATCH_MODEL = /^(?:submariner|yachtmaster|gmt.master|daytona|datejust|day.date|aquanaut|nautilus|royal.oak|big.bang|serpenti|cellini|birkin|kelly|constance|diva.dream|speedmaster|moonwatch|president)$/i;
const CONDITION = /^(?:bnib|ntq|ntpt|nos|new|used|unbranded|unknown|null|n\/a|brand.new|branded|naked|n1|n8|n9)$/i;
const COLOR = /^(?:black|blue|green|red|white|silver|gold|grey|gray|pink|brown|purple|orange|yellow|ivory|champagne|rose|sundust|rootbeer)$/i;
const NON_BRAND = /^(?:part|fin|man|mill|or|big|new|old|hulk|pepsi|snoopy|speedy|ln|st|sk|rx|ghost|factory)$/i;
const TOO_SHORT = /^[a-zA-Z]$/;  // Single letter like "E", "H", "W"
const MATERIAL = /^(?:ntpt|yg|rg|wg|pg|ss|tt|steel|ceramic|titanium|platinum)$/i;

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
 * Check if a string looks like a valid watch brand name
 * Filters out references, colors, conditions, prices stored as brands
 */
export function isValidBrand(brand: string): boolean {
  if (!brand || typeof brand !== 'string') return false;
  const t = brand.trim();

  // Must be at least 2 chars (but single letters like H, W are rejected below)
  if (t.length < 2) return false;

  // Reject pure numbers
  if (PURE_NUMBER.test(t)) return false;

  // Reject years
  if (YEAR_PATTERN.test(t)) return false;

  // Reject price suffixes
  if (PRICE_SUFFIX.test(t)) return false;

  // Reject price text like "5 million"
  if (PRICE_TEXT.test(t)) return false;

  // Reject single letters (E, H, W)
  if (TOO_SHORT.test(t)) return false;

  // Reject reference-like strings (15510OR, 16613, 26470SO, 7118/1A, etc.)
  // But NOT legitimate brand names that happen to contain numbers
  if (REFERENCE_LIKE.test(t) && !/[&]/.test(t) && t.length < 20) {
    // Extra check: if it has a slash and is short, it's likely a reference
    if (t.includes('/') || t.includes('.')) return false;
    // If it's mostly digits with a few letters at end (like 15510OR)
    const digitCount = (t.match(/\d/g) || []).length;
    const letterCount = (t.match(/[a-zA-Z]/g) || []).length;
    if (digitCount >= 3 && letterCount <= 4 && t.length <= 12) return false;
  }

  // Reject known watch models/nicknames used as brands
  if (WATCH_MODEL.test(t)) return false;

  // Reject conditions
  if (CONDITION.test(t)) return false;

  // Reject standalone colors
  if (COLOR.test(t)) return false;

  // Reject known non-brand words
  if (NON_BRAND.test(t)) return false;

  // Reject materials used as brands
  if (MATERIAL.test(t)) return false;

  // Reject very long strings that look like descriptions, not brands
  if (t.length > 50) return false;

  return true;
}

/**
 * Filter an array of brand names, removing junk entries
 * Returns deduplicated, sorted list of valid brand names
 */
export function filterValidBrands(brands: string[]): string[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const b of brands) {
    if (isValidBrand(b) && !seen.has(b)) {
      seen.add(b);
      valid.push(b);
    }
  }
  return valid.sort((a, b) => a.localeCompare(b));
}
