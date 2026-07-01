/**
 * Reference Validator — Brand/ Reference validation utilities
 * Filters junk entries from dropdowns: colors, conditions, prices,
 * references masquerading as brands, etc.
 */

// ─── Patterns ────────────────────────────────────────────────────────
const PURE_NUMBER    = /^\d+$/;
const YEAR_PATTERN   = /^(19|20)\d{2}$/;
const PRICE_SUFFIX   = /^\d+[KkMm]$/;
const PRICE_TEXT     = /^(\d{1,3}(,\d{3})*|\d+)(\s*(USD|HKD|EUR|GBP|CHF))?$/i;
const TOO_SHORT      = /^[A-Z]{1,3}$/i;           // 1-3 letter abbreviations rarely real brands
const REFERENCE_LIKE = /^[A-Z0-9]+$/i;
const WATCH_MODEL    = /\d{4,6}/;        // Contains 4-6 consecutive digits
const CONDITION      = /^(new|used|mint|excellent|good|fair|poor|bnib|unworn|pre.?owned|nos)$/i;
const COLOR          = /^(black|blue|white|green|silver|grey|gray|red|brown|orange|yellow|pink|purple|champagne|salmon|ivory|mother of pearl)$/i;
const NON_BRAND      = /^(unknown|n\/a|na|none|other|various|assorted|mixed)$/i;
const MATERIAL       = /^(gold|steel|rose gold|white gold|yellow gold|platinum|titanium|ceramic|carbon)$/i;

// Known non-watch brands to exclude from dropdowns
const EXCLUDED_BRANDS = new Set([
  'Ferrari','Apple','Mercedes-Benz','Ducati','Coca-Cola','ASICS','Garmin',
  'Fear of God','Birkin','Christian Dior','Dior','Chanel','Gucci','Fendi',
  'Burberry','Bottega Veneta','Chrome Hearts','David Yurman','Fred',
  'FRED','Glenn Spiro','Grassotti','Angela Cummings','Constance',
  'Australian Kangaroo','Czech Leopard','Granat','Bluecroft','Baltic',
  'Beaubleu','Boneta Inc.','BonetaWholesale.com','BT Watches','Buchira',
  'Brickell Watches','ChronoGrid','Depeche','Factory','FIN','BIG','PJ',
  'RX','UN','GOA','E','Used','Unbranded','Branded','037','16613',
  'McLaren','Nike','Kia','Jaguar','Jordan','null','Naked','New Mini',
  'Green tag','Godfather','Diva Dream','ntpt','NTPT','Ntq','NTQ'
]);

/**
 * Check if a string looks like a valid watch brand name.
 * Returns false for: pure numbers, years, prices, conditions, colors,
 * references, materials, and other non-brand values.
 */
export function isValidBrand(brand: string): boolean {
  if (!brand || typeof brand !== 'string') return false;
  const t = brand.trim();
  if (t.length < 2) return false;
  if (PURE_NUMBER.test(t)) return false;
  if (YEAR_PATTERN.test(t)) return false;
  if (PRICE_SUFFIX.test(t)) return false;
  if (PRICE_TEXT.test(t)) return false;
  if (TOO_SHORT.test(t)) return false;

  // Reference-like detection: e.g. "126301", "5712/1A", "RM11-03"
  if (REFERENCE_LIKE.test(t) && !/[&]/.test(t) && t.length < 20) {
    if (t.includes('/') || t.includes('.')) return false;
    const digitCount = (t.match(/\d/g) || []).length;
    const letterCount = (t.match(/[a-zA-Z]/g) || []).length;
    if (digitCount >= 3 && letterCount <= 4 && t.length <= 12) return false;
  }

  // Model-name-as-brand: contains year + word, or starts with M + reference pattern
  if (/^(19|20)\d{2}\s/.test(t)) return false;  // "2019 batgirl"
  if (/^M\d{5,6}/.test(t)) return false;        // "M79360N-0024" Tudor refs
  if (/^\d{2}-\d{2}[a-z]{0,2}$/i.test(t)) return false; // "72-01ti"

  if (WATCH_MODEL.test(t) && t.length <= 10) {
    // Could be a model number like "126301" — reject if mostly digits
    const digitCount = (t.match(/\d/g) || []).length;
    if (digitCount >= 4) return false;
  }

  if (CONDITION.test(t)) return false;
  if (COLOR.test(t)) return false;
  if (NON_BRAND.test(t)) return false;
  if (MATERIAL.test(t)) return false;
  if (EXCLUDED_BRANDS.has(t)) return false;
  if (t.length > 50) return false;

  return true;
}

/**
 * Filter an array of brand strings, keeping only valid brand names.
 * Uses strict equality for guaranteed uniqueness.
 */
export function filterValidBrands(brands: string[]): string[] {
  const seen = new Map<string, boolean>();
  const result: string[] = [];

  for (const brand of brands) {
    if (!brand || typeof brand !== 'string') continue;
    const normalized = brand.trim();
    if (!normalized) continue;
    if (!isValidBrand(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.set(normalized, true);
    result.push(normalized);
  }

  return result.sort((a, b) => a.localeCompare(b));
}

/**
 * Check if a string looks like a valid watch reference number.
 * Filters out years, prices, conditions, colors, and other non-reference values.
 */
export function isValidReference(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  const t = ref.trim();
  if (t.length < 4) return false;
  if (t.length > 25) return false;

  // NOT a year
  if (YEAR_PATTERN.test(t)) return false;

  // NOT zero-padded numbers (0002, 0011, 0585)
  if (/^0\d+$/.test(t)) return false;

  // NOT currency/price fragments
  if (/\b(HKD|AED|USD|EUR|GBP|CHF|JPY|CNY|GREY|MSRP|WANT|ONLY|BEST|BOX|PAPERS|FULL|SET|BNIB|B&P)\b/i.test(t)) return false;

  // NOT 1-3 digit pure numbers
  if (/^\d{1,3}$/.test(t)) return false;

  // NOT a pure price
  if (PURE_NUMBER.test(t) && t.length >= 5) return false;

  // NOT a price with currency
  if (PRICE_TEXT.test(t)) return false;

  // NOT a condition
  if (CONDITION.test(t)) return false;

  // NOT a color
  if (COLOR.test(t)) return false;

  // NOT a material
  if (MATERIAL.test(t)) return false;

  // NOT generic
  if (NON_BRAND.test(t)) return false;

  // Must contain at least one digit (all refs have numbers)
  if (!/\d/.test(t)) return false;

  return true;
}

/**
 * Filter an array of reference strings, keeping only valid references.
 * Uses strict equality for guaranteed uniqueness.
 */
export function filterValidReferences(refs: string[]): string[] {
  const seen = new Map<string, boolean>();
  const result: string[] = [];

  for (const ref of refs) {
    if (!ref || typeof ref !== 'string') continue;
    const normalized = ref.trim();
    if (!normalized) continue;
    if (!isValidReference(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.set(normalized, true);
    result.push(normalized);
  }

  return result.sort((a, b) => a.localeCompare(b));
}

/**
 * Quick check if a string looks like a reference number.
 */
export function isReferenceLike(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const t = value.trim().toUpperCase();
  if (t.length < 4 || t.length > 14) return false;

  // Starts with RM → Richard Mille reference
  if (t.startsWith('RM') && /^RM\d{2}[-\s]?\d{2}/i.test(t)) return true;

  // Patek style: 5712/1A-001
  if (/^\d{4,5}[A-Z]?\/\d[A-Z]{1,3}-\d{2,3}$/i.test(t)) return true;

  // Rolex style: 5-6 digits with optional letters
  if (/^\d{5,6}[A-Z]{0,3}$/i.test(t)) return true;

  // AP style: 5 digits + 2 letters
  if (/^\d{5}[A-Z]{2}\.?\d{0,2}$/i.test(t)) return true;

  // Generic: 4-6 alphanumeric
  if (/^[A-Z0-9]{4,10}$/i.test(t) && /\d/.test(t) && /[A-Z]/i.test(t)) return true;

  return false;
}
