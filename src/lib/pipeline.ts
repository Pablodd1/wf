/**
 * MULTI-STAGE PARSING & EXTRACTION PIPELINE
 * Stage A: Structured Info Extraction (LLM JSON Mode)
 * Stage B: Normalization & Alias Mapping (Deterministic)
 * Stage C: Canonical Reference Matching (Fuzzy + Catalog)
 */

import Fuse from 'fuse.js';
import { lookupReference, autoPopulateFromReference } from './masterCatalog';
import { normalizeDialColor as catalogNormalizeDial } from './catalog';

// ── Stage A: Raw Extraction Result ──
export interface RawExtracted {
  extractedBrand: string | null;
  extractedReference: string | null;
  extractedRawPrice: number | null;
  extractedCurrency: string | null;
  extractedDial: string | null;
  extractedCondition: string | null;
  extractedYear: number | null;
  extractedHasBox: boolean | null;
  extractedHasPapers: boolean | null;
  confidence: number;
  source: 'regex' | 'ai' | 'hybrid';
}

// ── Stage C: Normalized Result ──
export interface NormalizedWatch {
  brand: string;
  reference: string;
  family: string;
  dialColor: string;
  condition: string;
  year: number | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  priceUSD: number | null;
  hasBox: boolean;
  hasPapers: boolean;
  materials: string[];
  confidence: number;
  flags: string[];
  source: 'regex' | 'ai' | 'hybrid' | 'catalog';
}

// ── Stage B: Translation Dictionaries ──

const DIAL_ALIASES: Record<string, string> = {
  // Whites
  'PANDA': 'WHITE', 'SILVER': 'WHITE', 'IVORY': 'WHITE', 'CREAM': 'WHITE',
  'CHAMPAGNE': 'WHITE', 'ARCTIC': 'WHITE', 'SNOW': 'WHITE', 'WHITE INDEX': 'WHITE',
  'MOP': 'WHITE', 'MOTHER OF PEARL': 'WHITE', 'MOTHER-OF-PEARL': 'WHITE',
  // Blacks
  'ONIX': 'BLACK', 'ONYX': 'BLACK', 'JET': 'BLACK', 'NIGHT': 'BLACK',
  'DARK': 'BLACK', 'NOIR': 'BLACK', 'GHOST': 'BLACK',
  // Blues
  'TIFFANY': 'BLUE', 'AZURE': 'BLUE', 'NAVY': 'BLUE', 'ROYAL': 'BLUE',
  'COBALT': 'BLUE', 'SKY': 'BLUE', 'AQUA': 'BLUE', 'AQUAMARINE': 'BLUE',
  'TURQUOISE': 'BLUE', 'ICE BLUE': 'BLUE',
  // Greens
  'HULK': 'GREEN', 'OLIVE': 'GREEN', 'EMERALD': 'GREEN', 'FOREST': 'GREEN',
  'LIME': 'GREEN', 'JADE': 'GREEN', 'MINT': 'GREEN',
  // Browns
  'BRONZE': 'BROWN', 'COPPER': 'BROWN', 'TOBACCO': 'BROWN', 'COFFEE': 'BROWN',
  'CHOCOLATE': 'BROWN', 'ROOT BEER': 'BROWN', 'COGNAC': 'BROWN',
  // Greys
  'GRAY': 'GREY', 'SLATE': 'GREY', 'GRAPHITE': 'GREY', 'TITANIUM': 'GREY',
  'RHODIUM': 'GREY',
  // Purples
  'LAVENDER': 'PURPLE', 'VIOLET': 'PURPLE', 'PLUM': 'PURPLE', 'EGGPLANT': 'PURPLE',
  // Reds
  'BURGUNDY': 'RED', 'CHERRY': 'RED', 'RUBY': 'RED', 'MAROON': 'RED', 'ROSE': 'RED',
  // Oranges
  'APRICOT': 'ORANGE', 'TANGERINE': 'ORANGE',
  // Yellows
  'GOLD': 'YELLOW', 'HONEY': 'YELLOW', 'SUN': 'YELLOW',
  // Pinks
  'ROSE GOLD': 'PINK', 'SALMON': 'PINK', 'BLUSH': 'PINK',
  // Special
  '🌈': 'MULTI-COLOR', 'RAINBOW': 'MULTI-COLOR', 'MULTICOLOR': 'MULTI-COLOR',
  'METEORITE': 'METEORITE', 'DIAMOND': 'DIAMOND', 'GEMSET': 'DIAMOND',
};

const CONDITION_ALIASES: Record<string, string> = {
  'NOS': 'NEW', 'NEW OLD STOCK': 'NEW', 'UNWORN': 'NEW', 'FULL STICKER': 'NEW',
  'BNIB': 'NEW', 'BRAND NEW IN BOX': 'NEW', 'SEALED': 'NEW', 'UNUSED': 'NEW',
  'MINT': 'LIKE NEW', 'EXCELLENT': 'LIKE NEW', 'NEAR MINT': 'LIKE NEW',
  'PRE-OWNED': 'USED', 'PREOWNED': 'USED', 'WORN': 'USED', 'VINTAGE': 'USED',
  'NAKED': 'USED', 'WATCH ONLY': 'USED', 'NO BOX': 'USED', 'NO PAPERS': 'USED',
  'NO CARD': 'USED',
};

const BOX_PAPERS_ALIASES: Record<string, { hasBox: boolean; hasPapers: boolean }> = {
  'FULL SET': { hasBox: true, hasPapers: true },
  'BOX AND PAPERS': { hasBox: true, hasPapers: true },
  'BOX & PAPERS': { hasBox: true, hasPapers: true },
  'BOX+PAPERS': { hasBox: true, hasPapers: true },
  'CARD': { hasBox: false, hasPapers: true },
  'PAPERS': { hasBox: false, hasPapers: true },
  'BOX': { hasBox: true, hasPapers: false },
  'NAKED': { hasBox: false, hasPapers: false },
  'WATCH ONLY': { hasBox: false, hasPapers: false },
  'NO BOX': { hasBox: false, hasPapers: false },
  'NO PAPERS': { hasBox: false, hasPapers: false },
};

const BRAND_ALIASES: Record<string, string> = {
  'PP': 'PATEK PHILIPPE', 'PATEK': 'PATEK PHILIPPE', 'PHILIPPE': 'PATEK PHILIPPE',
  'AP': 'AUDEMARS PIGUET', 'AUDEMARS': 'AUDEMARS PIGUET', 'PIGUET': 'AUDEMARS PIGUET',
  'RM': 'RICHARD MILLE', 'RICHARD': 'RICHARD MILLE', 'MILLE': 'RICHARD MILLE',
  'VC': 'VACHERON CONSTANTIN', 'VACHERON': 'VACHERON CONSTANTIN',
  'FPJ': 'F.P. JOURNE', 'JOURNE': 'F.P. JOURNE',
};

// ── Stage B: Normalization Functions ──

export function normalizeDialColor(raw: string | null): string {
  if (!raw) return 'UNKNOWN';
  const cleaned = String(raw).trim().toUpperCase();
  if (DIAL_ALIASES[cleaned]) return DIAL_ALIASES[cleaned];
  // Check catalog's broader aliases
  return catalogNormalizeDial(cleaned);
}

export function normalizeCondition(raw: string | null): string {
  if (!raw) return 'UNKNOWN';
  const cleaned = String(raw).trim().toUpperCase();
  if (CONDITION_ALIASES[cleaned]) return CONDITION_ALIASES[cleaned];
  if (['NEW', 'USED', 'LIKE NEW', 'UNKNOWN'].includes(cleaned)) return cleaned;
  return 'UNKNOWN';
}

export function normalizeBrand(raw: string | null): string {
  if (!raw) return 'Unknown';
  const cleaned = String(raw).trim().toUpperCase();
  if (BRAND_ALIASES[cleaned]) return BRAND_ALIASES[cleaned];
  // Title case
  return cleaned.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

export function detectBoxPapers(text: string): { hasBox: boolean; hasPapers: boolean } {
  const t = text.toUpperCase();
  for (const [phrase, result] of Object.entries(BOX_PAPERS_ALIASES)) {
    if (t.includes(phrase)) return result;
  }
  return { hasBox: false, hasPapers: false };
}

// ── Stage A: Regex Extraction (code-first) ──

export function regexExtract(rawMessage: string): RawExtracted {
  const text = rawMessage;
  const lower = text.toLowerCase();

  // Brand detection
  let brand: string | null = null;
  if (/\bpp\b|patek|philippe/.test(lower)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars|piguet/.test(lower)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s*mille/.test(lower)) brand = 'Richard Mille';
  else if (/rolex/.test(lower)) brand = 'Rolex';
  else if (/vacheron|constantin/.test(lower)) brand = 'Vacheron Constantin';
  else if (/breguet/.test(lower)) brand = 'Breguet';
  else if (/omega/.test(lower)) brand = 'Omega';

  // Reference extraction (brand-aware)
  let ref: string | null = null;
  const rmMatch = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppMatch = text.match(/\b\d{4}\/\d{1,4}[A-Z]{0,2}(?:-\d{3})?\b/i);
  const apMatch = text.match(/\b\d{5}[A-Z]{2,4}\b/i);
  const rolexMatch = text.match(/\b\d{6}[A-Z]{0,4}\b/i);
  const genericMatch = text.match(/\b\d{4,6}[\/\s-]?\d?[A-Z]{1,4}\b/i);

  if (rmMatch) ref = rmMatch[0].toUpperCase().replace(/\s/g, '');
  else if (ppMatch) ref = ppMatch[0].toUpperCase();
  else if (apMatch) ref = apMatch[0].toUpperCase();
  else if (rolexMatch) ref = rolexMatch[0].toUpperCase();
  else if (genericMatch) ref = genericMatch[0].toUpperCase();

  // Dial color
  let dial: string | null = null;
  const dialPatterns = [
    /\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|mop|mother\s*of\s*pearl|meteorite|diamond|gemset|rainbow|multi[\s-]?color)\b/i,
    /\b(panda|hulk|tiffany|onyx|root\s*beer|cognac|ice\s*blue)\b/i,
  ];
  for (const pat of dialPatterns) {
    const m = text.match(pat);
    if (m) { dial = m[1] || m[0]; break; }
  }
  // Infer from reference suffix if no explicit dial
  if (!dial && ref) {
    const su = ref.toUpperCase();
    if (su.endsWith('LN')) dial = 'Black';
    else if (su.endsWith('LB')) dial = 'Blue';
    else if (su.endsWith('LV')) dial = 'Green';
    else if (su.endsWith('CHNR')) dial = 'Brown';
    else if (su.endsWith('R') && !su.includes('RM')) dial = 'Brown';
    else if (su.endsWith('G') && !su.includes('RM')) dial = 'Blue';
    else if (su.endsWith('J')) dial = 'Champagne';
    else if (su.endsWith('P')) dial = 'Blue';
    else if (su.endsWith('ST')) dial = 'Blue';
    else if (su.endsWith('OR')) dial = 'Pink';
    else if (su.endsWith('TI')) dial = 'Grey';
    else if (su.endsWith('BC')) dial = 'Black';
  }

  // Condition
  let condition: string | null = null;
  if (/\bnew\b|unworn|bnib|sealed|full\s*set|full\s*sticker/i.test(text)) condition = 'New';
  else if (/\bused\b|pre[\s-]?owned|worn|vintage/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent|near\s*mint/i.test(text)) condition = 'Like New';

  // Year
  const yearMatch = text.match(/\b(20[12]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Price + currency
  let price: number | null = null;
  let currency: string | null = null;

  // Million prices: 1.83m, 1.83M HKD
  const mMatch = text.match(/\b(\d{1,4}(?:\.\d{1,3})?)\s*(?:m|million)\b/i);
  if (mMatch) price = Math.round(parseFloat(mMatch[1]) * 1_000_000);

  // K prices: 850k, 21.6k, 850 K
  if (!price) {
    const kMatch = text.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
    if (kMatch) price = Math.round(parseFloat(kMatch[1]) * 1000);
  }

  // Plain numbers >= 4 digits with explicit currency
  const priceMatch = text.match(/([\d,]{4,})\s*(HKD|USD|USDT|EUR|GBP|CHF|SGD|hkd|usd|eur|usdt|\$|€)/i);
  if (priceMatch) {
    const parsed = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    if (!price || parsed > price) price = parsed;
    const curSym = (priceMatch[2] || '').toUpperCase();
    if (curSym === '$' || curSym === 'USD') currency = 'USD';
    else if (curSym === 'HKD' || curSym === 'HK$') currency = 'HKD';
    else if (curSym === 'EUR' || curSym === '€') currency = 'EUR';
    else if (curSym === 'USDT') currency = 'USDT';
    else if (curSym === 'GBP' || curSym === '£') currency = 'GBP';
    else if (curSym === 'CHF') currency = 'CHF';
    else if (curSym === 'SGD') currency = 'SGD';
  }

  // Currency fallback detection
  if (!currency) {
    if (/\bhkd\b|hk\$/i.test(text)) currency = 'HKD';
    else if (/\busdt\b/i.test(text)) currency = 'USDT';
    else if (/\beur\b|€/i.test(text)) currency = 'EUR';
    else if (/\bgbp\b|£/i.test(text)) currency = 'GBP';
    else if (/\bchf\b/i.test(text)) currency = 'CHF';
    else if (/\$|\busd\b/i.test(text)) currency = 'USD';
  }

  // Box & papers
  const bp = detectBoxPapers(text);

  // Confidence scoring
  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 12;
  if (condition) confidence += 8;
  if (price) confidence += 8;
  if (year) confidence += 4;
  if (bp.hasBox || bp.hasPapers) confidence += 3;

  return {
    extractedBrand: brand,
    extractedReference: ref,
    extractedRawPrice: price,
    extractedCurrency: currency,
    extractedDial: dial,
    extractedCondition: condition,
    extractedYear: year,
    extractedHasBox: bp.hasBox,
    extractedHasPapers: bp.hasPapers,
    confidence: Math.min(confidence, 100),
    source: 'regex',
  };
}

// ── Stage C: Fuzzy Reference Matching ──

let _fuseIndex: Fuse<string> | null = null;
let _allRefs: string[] = [];

async function buildFuseIndex(): Promise<Fuse<string>> {
  if (_fuseIndex) return _fuseIndex;
  const { initMasterCatalog } = await import('./masterCatalog');
  const { refIndex: ri } = await initMasterCatalog();
  _allRefs = [...ri.keys()];
  _fuseIndex = new Fuse(_allRefs, { threshold: 0.4, distance: 100, includeScore: true });
  return _fuseIndex;
}

export async function fuzzyMatchReference(rawRef: string, brandHint?: string): Promise<{
  reference: string;
  score: number;
  reason: 'exact' | 'alias' | 'fuzzy' | 'pattern';
} | null> {
  const cleaned = rawRef.trim().toUpperCase();

  // 1. Exact match
  const exact = await lookupReference(cleaned);
  if (exact) return { reference: exact.reference, score: 1.0, reason: 'exact' };

  // 2. Alias match (normalize slashes/hyphens)
  const noSlash = cleaned.replace(/[^A-Z0-9]/g, '');
  const { aliasIndex } = await import('./masterCatalog').then(m => m.initMasterCatalog());
  const aliasMatch = (await aliasIndex).get(noSlash);
  if (aliasMatch) return { reference: aliasMatch, score: 0.95, reason: 'alias' };

  // 3. Pattern-based fixes
  // Patek: missing slash
  const patekSlash = cleaned.replace(/^(\d{4})([A-Z]\d?)$/, '$1/$2');
  if (patekSlash !== cleaned) {
    const ps = await lookupReference(patekSlash);
    if (ps) return { reference: ps.reference, score: 0.9, reason: 'pattern' };
  }
  // RM: missing hyphen
  const rmHyphen = cleaned.replace(/^RM(\d{2})(\d{2})$/, 'RM$1-$2');
  if (rmHyphen !== cleaned) {
    const rm = await lookupReference(rmHyphen);
    if (rm) return { reference: rm.reference, score: 0.9, reason: 'pattern' };
  }

  // 4. Fuzzy match
  const fuse = await buildFuseIndex();
  const results = fuse.search(cleaned, { limit: 3 });
  if (results.length > 0 && (results[0].score || 1) < 0.5) {
    return { reference: results[0].item, score: 1 - (results[0].score || 0), reason: 'fuzzy' };
  }

  // brandHint used for logging/debugging
  if (brandHint) { /* brand hint available for future scoring boost */ }

  return null;
}

// ── Full Pipeline: Raw → Normalized ──

export async function runPipeline(
  rawMessage: string,
  aiExtracted?: RawExtracted
): Promise<NormalizedWatch> {
  const flags: string[] = [];

  // Stage A: Extract (prefer AI if provided, else regex)
  const extracted = aiExtracted || regexExtract(rawMessage);

  // Stage B: Normalize
  let brand = normalizeBrand(extracted.extractedBrand);
  let dialColor = normalizeDialColor(extracted.extractedDial);
  let condition = normalizeCondition(extracted.extractedCondition);
  const year = extracted.extractedYear;
  const currency = extracted.extractedCurrency || '';
  const originalPrice = extracted.extractedRawPrice;
  const hasBox = extracted.extractedHasBox ?? false;
  const hasPapers = extracted.extractedHasPapers ?? false;

  // Stage C: Canonical reference matching
  let reference = extracted.extractedReference || '';
  let family = 'OTHER';
  let materials: string[] = [];
  let confidence = extracted.confidence;

  if (reference) {
    const match = await fuzzyMatchReference(reference, brand);
    if (match) {
      reference = match.reference;
      const auto = await autoPopulateFromReference(reference);
      if (auto) {
        brand = auto.brand;
        family = auto.family;
        materials = auto.materials;
        confidence = Math.max(confidence, auto.confidence);
        // Validate dial against catalog
        if (dialColor !== 'UNKNOWN' && !auto.standardDials.includes(dialColor)) {
          flags.push('DIAL_CATALOG_MISMATCH');
        }
      }
    } else {
      flags.push('UNKNOWN_REFERENCE');
      confidence = Math.min(confidence, 50);
    }
  } else {
    flags.push('MISSING_REFERENCE');
    confidence = Math.min(confidence, 30);
  }

  // Currency conversion to USD
  let priceUSD: number | null = null;
  if (originalPrice) {
    priceUSD = await convertToUSD(originalPrice, currency);
  }

  // Final confidence gate
  if (confidence < 35) flags.push('LOW_CONFIDENCE');
  if (!originalPrice) flags.push('MISSING_PRICE');

  return {
    brand,
    reference,
    family,
    dialColor,
    condition,
    year,
    price: priceUSD,
    originalPrice,
    currency,
    priceUSD,
    hasBox,
    hasPapers,
    materials,
    confidence: Math.min(confidence, 100),
    flags,
    source: aiExtracted ? 'hybrid' : 'regex',
  };
}

// ── Currency Conversion ──

const RATES: Record<string, number> = {
  'USD': 1.0,
  'HKD': 0.128,
  'EUR': 1.08,
  'GBP': 1.27,
  'CHF': 1.13,
  'JPY': 0.0066,
  'SGD': 0.74,
  'AUD': 0.65,
  'CAD': 0.73,
  'USDT': 1.0,
  'RMB': 0.138,
  'CNY': 0.138,
};

export async function convertToUSD(amount: number, currency: string): Promise<number> {
  const code = currency.toUpperCase();
  const rate = RATES[code] || 1.0;
  return Math.round(amount * rate);
}

export function formatCurrencyUSD(amount: number): string {
  if (!amount || amount === 0) return '—';
  return `$${amount.toLocaleString()}`;
}

// ── Live rates fetch (optional, falls back to static) ──
let _liveRates: Record<string, number> | null = null;
let _ratesExpiry = 0;

export async function getLiveRates(): Promise<Record<string, number>> {
  if (_liveRates && Date.now() < _ratesExpiry) return _liveRates;
  try {
    // Using exchangerate-api.com free tier (no key needed for base USD)
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    if (data.rates) {
      _liveRates = {
        'USD': 1.0,
        'HKD': data.rates.HKD ? 1 / data.rates.HKD : 0.128,
        'EUR': data.rates.EUR ? 1 / data.rates.EUR : 1.08,
        'GBP': data.rates.GBP ? 1 / data.rates.GBP : 1.27,
        'CHF': data.rates.CHF ? 1 / data.rates.CHF : 1.13,
        'JPY': data.rates.JPY ? 1 / data.rates.JPY : 0.0066,
        'SGD': data.rates.SGD ? 1 / data.rates.SGD : 0.74,
        'AUD': data.rates.AUD ? 1 / data.rates.AUD : 0.65,
        'CAD': data.rates.CAD ? 1 / data.rates.CAD : 0.73,
        'USDT': 1.0,
        'CNY': data.rates.CNY ? 1 / data.rates.CNY : 0.138,
      };
      _ratesExpiry = Date.now() + 3600000; // 1 hour cache
      return _liveRates;
    }
  } catch { /* fallback */ }
  return RATES;
}

// ── IQR Outlier Removal ──

export interface OutlierResult {
  keep: number[];
  remove: number[];
  q1: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
}

export function iqrOutlierRemoval(prices: number[]): OutlierResult {
  if (prices.length < 2) {
    return { keep: prices, remove: [], q1: 0, q3: 0, iqr: 0, lowerBound: 0, upperBound: 0 };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;
  const lowerBound = q1 - 3.0 * iqr;
  const upperBound = q3 + 3.0 * iqr;

  return {
    keep: prices.filter(p => p >= lowerBound && p <= upperBound),
    remove: prices.filter(p => p < lowerBound || p > upperBound),
    q1,
    q3,
    iqr,
    lowerBound,
    upperBound,
  };
}

/** Group records by reference+dial and apply IQR filtering. */
export function applyIQRFiltering<T extends { reference: string; dialColor: string; price: number }>(
  records: T[],
  minDataPoints = 2
): { clean: T[]; outliers: T[]; insufficient: T[]; stats: Record<string, OutlierResult> } {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    const key = `${r.reference}::${r.dialColor || 'UNKNOWN'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const clean: T[] = [];
  const outliers: T[] = [];
  const insufficient: T[] = [];
  const stats: Record<string, OutlierResult> = {};

  for (const [key, recs] of groups) {
    const prices = recs.map(r => r.price).filter(p => p > 0);
    if (prices.length < minDataPoints) {
      insufficient.push(...recs);
      continue;
    }
    const result = iqrOutlierRemoval(prices);
    stats[key] = result;
    const keepSet = new Set(result.keep);
    for (const r of recs) {
      if (r.price > 0 && keepSet.has(r.price)) clean.push(r);
      else outliers.push(r);
    }
  }

  return { clean, outliers, insufficient, stats };
}
