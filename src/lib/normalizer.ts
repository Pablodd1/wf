/**
 * Patek Philippe Watch Normalization Engine
 * 4-Stage Pipeline:
 *   1. Structured Extraction — regex-based field extraction from raw text
 *   2. Normalization & Translation — standardize dial names, conditions, currency→USD
 *   3. Catalog Cross-Reference — exact/fuzzy/prefix match against 50-entry master catalog
 *   4. Confidence Scoring — aggregate score determines verdict
 *
 * Plus: IQR outlier detection for price validation
 */

import { levenshteinDistance } from './levenshtein';

// ─── Types ───────────────────────────────────────────────────────

export interface PipelineStage {
  name: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  notes: string[];
}

export interface CatalogEntry {
  reference: string;
  collection: string;
  movement: string;
  material: string;
  diameter: string;
  complications: string[];
  dialColors: string[];
  typicalPriceLow: number;
  typicalPriceHigh: number;
}

export interface NormalizedWatch {
  id: string;
  rawInput: string;
  stages: PipelineStage[];

  // Stage 1 outputs
  extractedBrand: string | null;
  extractedRef: string | null;
  extractedRawPrice: number | null;
  extractedCurrency: string | null;
  extractedDial: string | null;
  extractedCondition: string | null;

  // Stage 2 outputs
  normalizedBrand: string | null;
  normalizedRef: string | null;
  normalizedPriceUSD: number | null;
  normalizedDial: string | null;
  normalizedCondition: string | null;

  // Stage 3 outputs
  catalogMatch: CatalogEntry | null;
  matchType: 'exact' | 'fuzzy' | 'prefix' | 'none';
  matchDistance: number;

  // Stage 4 outputs
  confidenceScore: number;
  verdict: 'APPROVED' | 'AI_REVIEW' | 'HUMAN_REVIEW';
  failureFlags: string[];

  // User action
  userAction: 'none' | 'approved' | 'discarded';
}

// ─── Currency conversion ─────────────────────────────────────────

const CURRENCY_RATES: Record<string, number> = {
  USD: 1.0,
  HKD: 0.128,
  EUR: 1.09,
  GBP: 1.27,
  CHF: 1.13,
  JPY: 0.0067,
  CNY: 0.139,
  SGD: 0.745,
  AUD: 0.66,
  CAD: 0.74,
};

// ─── Dial name normalization ─────────────────────────────────────

const DIAL_ALIASES: Record<string, string> = {
  'blue': 'Blue',
  'blau': 'Blue',
  'bleu': 'Blue',
  'green': 'Green',
  'grün': 'Green',
  'vert': 'Green',
  'black': 'Black',
  'noir': 'Black',
  'schwarz': 'Black',
  'white': 'White',
  'blanc': 'White',
  'weiss': 'White',
  'silver': 'Silver',
  'silber': 'Silver',
  'argent': 'Silver',
  'champagne': 'Champagne',
  'brown': 'Brown',
  'marron': 'Brown',
  'salmon': 'Salmon',
  'saumon': 'Salmon',
  'grey': 'Grey',
  'gray': 'Grey',
  'gris': 'Grey',
  'taupe': 'Taupe',
  'cream': 'Cream',
  'crème': 'Cream',
  'yellow': 'Yellow',
  'jaune': 'Yellow',
  'purple': 'Purple',
  'violet': 'Purple',
  'red': 'Red',
  'rouge': 'Red',
  'orange': 'Orange',
  'pink': 'Pink',
  'rose': 'Pink',
  ' Tiffany': 'Tiffany Blue',
  'tiffany': 'Tiffany Blue',
  'lavanille': 'La Vanille',
  'vanilla': 'La Vanille',
  'avocado': 'Avocado Green',
  'olive': 'Olive Green',
  'ruby': 'Ruby',
  'emerald': 'Emerald',
  'sapphire': 'Sapphire',
};

// ─── Condition normalization ─────────────────────────────────────

const CONDITION_ALIASES: Record<string, string> = {
  'new': 'New/Unworn',
  'unworn': 'New/Unworn',
  'brand new': 'New/Unworn',
  'bnib': 'New/Unworn',
  'bnwot': 'New/Unworn',
  'mint': 'Mint',
  'excellent': 'Excellent',
  'exc': 'Excellent',
  'exc+': 'Excellent',
  'very good': 'Very Good',
  'vg': 'Very Good',
  'good': 'Good',
  'fair': 'Fair',
  'poor': 'Poor',
  'pre-owned': 'Pre-Owned',
  'used': 'Pre-Owned',
  'second hand': 'Pre-Owned',
  'vintage': 'Vintage',
};

// ─── Master Catalog: 50 Patek Philippe References ────────────────

export const CATALOG: CatalogEntry[] = [
  // Nautilus
  { reference: '5711/1A-010', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '40mm', complications: ['Date'], dialColors: ['Blue'], typicalPriceLow: 100000, typicalPriceHigh: 250000 },
  { reference: '5711/1A-014', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '40mm', complications: ['Date'], dialColors: ['Green'], typicalPriceLow: 400000, typicalPriceHigh: 800000 },
  { reference: '5711/1R-001', collection: 'Nautilus', movement: 'Automatic', material: 'Rose Gold', diameter: '40mm', complications: ['Date'], dialColors: ['Brown'], typicalPriceLow: 500000, typicalPriceHigh: 900000 },
  { reference: '5712/1A-001', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '40mm', complications: ['Date', 'Moonphase', 'Power Reserve'], dialColors: ['Blue', 'Black'], typicalPriceLow: 80000, typicalPriceHigh: 180000 },
  { reference: '5726/1A-014', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '40.5mm', complications: ['Annual Calendar', 'Moonphase'], dialColors: ['Blue', 'Black', 'Silver'], typicalPriceLow: 120000, typicalPriceHigh: 250000 },
  { reference: '5990/1A-011', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '40.5mm', complications: ['Chronograph', 'Travel Time'], dialColors: ['Blue'], typicalPriceLow: 200000, typicalPriceHigh: 400000 },
  { reference: '5990/1R-001', collection: 'Nautilus', movement: 'Automatic', material: 'Rose Gold', diameter: '40.5mm', complications: ['Chronograph', 'Travel Time'], dialColors: ['Brown'], typicalPriceLow: 600000, typicalPriceHigh: 1100000 },
  { reference: '5740/1G-001', collection: 'Nautilus', movement: 'Automatic', material: 'White Gold', diameter: '40mm', complications: ['Perpetual Calendar'], dialColors: ['Blue'], typicalPriceLow: 350000, typicalPriceHigh: 600000 },
  { reference: '5811/1G-001', collection: 'Nautilus', movement: 'Automatic', material: 'White Gold', diameter: '41mm', complications: ['Date'], dialColors: ['Blue'], typicalPriceLow: 150000, typicalPriceHigh: 300000 },
  { reference: '7118/1A-010', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '35.2mm', complications: ['Date'], dialColors: ['Blue'], typicalPriceLow: 50000, typicalPriceHigh: 120000 },
  { reference: '7118/1A-001', collection: 'Nautilus', movement: 'Automatic', material: 'Steel', diameter: '35.2mm', complications: ['Date'], dialColors: ['Champagne'], typicalPriceLow: 45000, typicalPriceHigh: 100000 },
  { reference: '7118/1200R-001', collection: 'Nautilus', movement: 'Automatic', material: 'Rose Gold', diameter: '35.2mm', complications: ['Date'], dialColors: ['Brown'], typicalPriceLow: 60000, typicalPriceHigh: 150000 },
  // Aquanaut
  { reference: '5167A-001', collection: 'Aquanaut', movement: 'Automatic', material: 'Steel', diameter: '40.8mm', complications: ['Date'], dialColors: ['Black', 'Brown'], typicalPriceLow: 40000, typicalPriceHigh: 90000 },
  { reference: '5167R-001', collection: 'Aquanaut', movement: 'Automatic', material: 'Rose Gold', diameter: '40.8mm', complications: ['Date'], dialColors: ['Brown'], typicalPriceLow: 60000, typicalPriceHigh: 140000 },
  { reference: '5168G-010', collection: 'Aquanaut', movement: 'Automatic', material: 'White Gold', diameter: '42.2mm', complications: ['Date'], dialColors: ['Green'], typicalPriceLow: 100000, typicalPriceHigh: 200000 },
  { reference: '5168G-001', collection: 'Aquanaut', movement: 'Automatic', material: 'White Gold', diameter: '42.2mm', complications: ['Date'], dialColors: ['Blue'], typicalPriceLow: 90000, typicalPriceHigh: 180000 },
  { reference: '5968A-001', collection: 'Aquanaut', movement: 'Automatic', material: 'Steel', diameter: '42.2mm', complications: ['Chronograph', 'Date'], dialColors: ['Black'], typicalPriceLow: 80000, typicalPriceHigh: 160000 },
  { reference: '5968G-010', collection: 'Aquanaut', movement: 'Automatic', material: 'White Gold', diameter: '42.2mm', complications: ['Chronograph', 'Date'], dialColors: ['Green'], typicalPriceLow: 150000, typicalPriceHigh: 280000 },
  { reference: '5062/450R-001', collection: 'Aquanaut Luce', movement: 'Automatic', material: 'Rose Gold', diameter: '38.8mm', complications: ['Date'], dialColors: ['Rainbow'], typicalPriceLow: 300000, typicalPriceHigh: 600000 },
  { reference: '5261R-001', collection: 'Aquanaut Luce', movement: 'Automatic', material: 'Rose Gold', diameter: '38.8mm', complications: ['Annual Calendar', 'Moonphase'], dialColors: ['Blue'], typicalPriceLow: 80000, typicalPriceHigh: 160000 },
  { reference: '5067A-001', collection: 'Aquanaut Luce', movement: 'Quartz', material: 'Steel', diameter: '35.6mm', complications: ['Date'], dialColors: ['Black', 'White'], typicalPriceLow: 20000, typicalPriceHigh: 50000 },
  // Calatrava
  { reference: '5196J-001', collection: 'Calatrava', movement: 'Manual', material: 'Yellow Gold', diameter: '37mm', complications: ['Small Seconds'], dialColors: ['Silver', 'White'], typicalPriceLow: 15000, typicalPriceHigh: 35000 },
  { reference: '5227G-010', collection: 'Calatrava', movement: 'Automatic', material: 'White Gold', diameter: '39mm', complications: ['Date'], dialColors: ['Black', 'White'], typicalPriceLow: 25000, typicalPriceHigh: 50000 },
  { reference: '6007G-001', collection: 'Calatrava', movement: 'Automatic', material: 'White Gold', diameter: '40mm', complications: ['Date'], dialColors: ['Blue', 'Green', 'Yellow'], typicalPriceLow: 25000, typicalPriceHigh: 50000 },
  { reference: '6119R-001', collection: 'Calatrava', movement: 'Automatic', material: 'Rose Gold', diameter: '39mm', complications: ['Small Seconds'], dialColors: ['Silver'], typicalPriceLow: 20000, typicalPriceHigh: 40000 },
  { reference: '3998J-001', collection: 'Calatrava', movement: 'Automatic', material: 'Yellow Gold', diameter: '33.5mm', complications: ['Date'], dialColors: ['White'], typicalPriceLow: 10000, typicalPriceHigh: 25000 },
  // Grand Complications
  { reference: '5270J-001', collection: 'Grand Complications', movement: 'Manual', material: 'Yellow Gold', diameter: '41mm', complications: ['Perpetual Calendar', 'Chronograph'], dialColors: ['Silver'], typicalPriceLow: 120000, typicalPriceHigh: 250000 },
  { reference: '5270P-001', collection: 'Grand Complications', movement: 'Manual', material: 'Platinum', diameter: '41mm', complications: ['Perpetual Calendar', 'Chronograph'], dialColors: ['Blue'], typicalPriceLow: 250000, typicalPriceHigh: 500000 },
  { reference: '5204R-001', collection: 'Grand Complications', movement: 'Manual', material: 'Rose Gold', diameter: '40mm', complications: ['Split-Seconds Chronograph', 'Perpetual Calendar'], dialColors: ['White', 'Black'], typicalPriceLow: 300000, typicalPriceHigh: 600000 },
  { reference: '5374G-001', collection: 'Grand Complications', movement: 'Automatic', material: 'White Gold', diameter: '42mm', complications: ['Minute Repeater', 'Perpetual Calendar'], dialColors: ['Black'], typicalPriceLow: 600000, typicalPriceHigh: 1200000 },
  { reference: '6300G-010', collection: 'Grand Complications', movement: 'Manual', material: 'White Gold', diameter: '47.7mm', complications: ['Grande Sonnerie', 'Petite Sonnerie', 'Minute Repeater'], dialColors: ['Blue'], typicalPriceLow: 3000000, typicalPriceHigh: 8000000 },
  { reference: '6102R-001', collection: 'Grand Complications', movement: 'Automatic', material: 'Rose Gold', diameter: '44mm', complications: ['Celestial', 'Date'], dialColors: ['Black'], typicalPriceLow: 400000, typicalPriceHigh: 800000 },
  { reference: '6102P-001', collection: 'Grand Complications', movement: 'Automatic', material: 'Platinum', diameter: '44mm', complications: ['Celestial', 'Date'], dialColors: ['Blue'], typicalPriceLow: 450000, typicalPriceHigh: 900000 },
  { reference: '5236P-010', collection: 'Grand Complications', movement: 'Automatic', material: 'Platinum', diameter: '41.3mm', complications: ['Perpetual Calendar', 'In-line Display'], dialColors: ['Blue'], typicalPriceLow: 150000, typicalPriceHigh: 300000 },
  { reference: '5320G-011', collection: 'Grand Complications', movement: 'Automatic', material: 'White Gold', diameter: '40mm', complications: ['Perpetual Calendar'], dialColors: ['Salmon', 'Green'], typicalPriceLow: 100000, typicalPriceHigh: 200000 },
  { reference: '5370P-001', collection: 'Grand Complications', movement: 'Manual', material: 'Platinum', diameter: '41mm', complications: ['Split-Seconds Chronograph'], dialColors: ['Blue', 'Black'], typicalPriceLow: 250000, typicalPriceHigh: 500000 },
  { reference: '5208R-001', collection: 'Grand Complications', movement: 'Automatic', material: 'Rose Gold', diameter: '42mm', complications: ['Chronograph', 'Minute Repeater', 'Perpetual Calendar'], dialColors: ['Brown'], typicalPriceLow: 800000, typicalPriceHigh: 1600000 },
  { reference: '5078G-001', collection: 'Grand Complications', movement: 'Automatic', material: 'White Gold', diameter: '38mm', complications: ['Minute Repeater'], dialColors: ['Black'], typicalPriceLow: 400000, typicalPriceHigh: 800000 },
  // Complications (non-grand)
  { reference: '5146/1G-001', collection: 'Complications', movement: 'Automatic', material: 'White Gold', diameter: '39mm', complications: ['Annual Calendar', 'Moonphase', 'Power Reserve'], dialColors: ['White'], typicalPriceLow: 40000, typicalPriceHigh: 90000 },
  { reference: '5396R-014', collection: 'Complications', movement: 'Automatic', material: 'Rose Gold', diameter: '38.5mm', complications: ['Annual Calendar', 'Moonphase'], dialColors: ['Blue'], typicalPriceLow: 40000, typicalPriceHigh: 80000 },
  { reference: '5905/1A-001', collection: 'Complications', movement: 'Automatic', material: 'Steel', diameter: '42mm', complications: ['Chronograph', 'Annual Calendar', 'Flyback'], dialColors: ['Green'], typicalPriceLow: 50000, typicalPriceHigh: 120000 },
  { reference: '5905/1A-010', collection: 'Complications', movement: 'Automatic', material: 'Steel', diameter: '42mm', complications: ['Chronograph', 'Annual Calendar', 'Flyback'], dialColors: ['Blue'], typicalPriceLow: 50000, typicalPriceHigh: 120000 },
  { reference: '5930P-001', collection: 'Complications', movement: 'Automatic', material: 'Platinum', diameter: '39.5mm', complications: ['Chronograph', 'World Time'], dialColors: ['Blue'], typicalPriceLow: 100000, typicalPriceHigh: 200000 },
  { reference: '5231G-001', collection: 'Complications', movement: 'Automatic', material: 'White Gold', diameter: '38.5mm', complications: ['World Time'], dialColors: ['Cloisonné'], typicalPriceLow: 70000, typicalPriceHigh: 150000 },
  { reference: '5524G-001', collection: 'Calatrava Pilot Travel Time', movement: 'Automatic', material: 'White Gold', diameter: '42mm', complications: ['Travel Time', 'Date'], dialColors: ['Brown'], typicalPriceLow: 35000, typicalPriceHigh: 75000 },
  { reference: '5524R-001', collection: 'Calatrava Pilot Travel Time', movement: 'Automatic', material: 'Rose Gold', diameter: '42mm', complications: ['Travel Time', 'Date'], dialColors: ['Brown'], typicalPriceLow: 40000, typicalPriceHigh: 85000 },
  { reference: '7234R-001', collection: 'Calatrava Pilot Travel Time', movement: 'Automatic', material: 'Rose Gold', diameter: '37.5mm', complications: ['Travel Time', 'Date'], dialColors: ['Brown'], typicalPriceLow: 30000, typicalPriceHigh: 65000 },
  { reference: '5172G-010', collection: 'Complications', movement: 'Manual', material: 'White Gold', diameter: '41mm', complications: ['Chronograph'], dialColors: ['Blue'], typicalPriceLow: 50000, typicalPriceHigh: 110000 },
  { reference: '5230G-001', collection: 'Complications', movement: 'Automatic', material: 'White Gold', diameter: '38.5mm', complications: ['World Time'], dialColors: ['Grey'], typicalPriceLow: 35000, typicalPriceHigh: 80000 },
  { reference: '4947/1A-001', collection: 'Aquanaut Luce', movement: 'Automatic', material: 'Steel', diameter: '38.8mm', complications: ['Annual Calendar', 'Moonphase'], dialColors: ['Khaki Green'], typicalPriceLow: 45000, typicalPriceHigh: 95000 },
  { reference: '7130R-014', collection: 'Complications', movement: 'Automatic', material: 'Rose Gold', diameter: '36mm', complications: ['World Time'], dialColors: ['Green'], typicalPriceLow: 45000, typicalPriceHigh: 95000 },
];

// ─── Index Maps for fast lookup ─────────────────────────────────

const REF_INDEX = new Map<string, CatalogEntry>();
const PREFIX_INDEX = new Map<string, CatalogEntry[]>();

CATALOG.forEach((entry) => {
  // Exact index
  REF_INDEX.set(entry.reference, entry);

  // Prefix index (e.g., "5711" → all 5711 variants)
  const base = entry.reference.split('/')[0];
  if (!PREFIX_INDEX.has(base)) {
    PREFIX_INDEX.set(base, []);
  }
  PREFIX_INDEX.get(base)!.push(entry);
});

// ─── Stage 1: Structured Extraction ─────────────────────────────

const PRICE_REGEX = /(?:USD|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|JPY)?\s?[$\u00A5\u20AC\u00A3]\s?([\d,]+(?:\.\d+)?)\s?([KkMm]?)(?:\s?(USD|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|JPY))?/i;
const PRICE_ALT_REGEX = /([\d,]+(?:\.\d+)?)\s?([KkMm]?)\s?(USD|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|JPY)/i;
const REF_REGEX = /\b(\d{4}[A-Z]?\/?\d[A-Z]{0,2}-\d{3})\b/i;
const REF_LOOSE_REGEX = /\b(\d{4}[A-Z]?)\b/i;
const BRAND_REGEX = /\b(Patek|PP|Patek\s*Philippe|Rolex|Audemars\s*Piguet|AP|Vacheron\s*Constantin|VC|Richard\s*Mille|RM)\b/i;
const DIAL_REGEX = /\b(blue|green|black|white|silver|champagne|brown|salmon|grey|gray|taupe|cream|yellow|purple|red|orange|pink|rose gold|tiffany|avocado|olive|ruby|emerald|sapphire)\b/i;
const CONDITION_REGEX = /\b(new|unworn|mint|excellent|exc\+?|very good|vg|good|fair|poor|pre-owned|used|second hand|vintage|bnib|bnwot)\b/i;

function stageExtract(raw: string): PipelineStage {
  const notes: string[] = [];

  // Brand
  let extractedBrand: string | null = null;
  const brandMatch = raw.match(BRAND_REGEX);
  if (brandMatch) {
    const b = brandMatch[1].toUpperCase().replace(/\s+/g, '');
    extractedBrand = b === 'PP' ? 'Patek Philippe' : b;
    notes.push(`Brand detected: "${extractedBrand}"`);
  } else {
    notes.push('No brand keyword found — assuming Patek Philippe from context');
    extractedBrand = 'Patek Philippe';
  }

  // Reference
  let extractedRef: string | null = null;
  const refMatch = raw.match(REF_REGEX);
  if (refMatch) {
    extractedRef = refMatch[1];
    notes.push(`Reference extracted: "${extractedRef}"`);
  } else {
    const looseMatch = raw.match(REF_LOOSE_REGEX);
    if (looseMatch) {
      extractedRef = looseMatch[1];
      notes.push(`Partial reference found: "${extractedRef}"`);
    } else {
      notes.push('No reference number found');
    }
  }

  // Price
  let extractedRawPrice: number | null = null;
  let extractedCurrency: string | null = null;

  const priceMatch = raw.match(PRICE_REGEX) || raw.match(PRICE_ALT_REGEX);
  if (priceMatch) {
    let num = parseFloat(priceMatch[1].replace(/,/g, ''));
    const suffix = priceMatch[2]?.toLowerCase();
    let currency = priceMatch[3]?.toUpperCase();

    // Currency symbol detection fallback
    if (!currency) {
      if (raw.includes('HK$') || raw.includes('HKD')) currency = 'HKD';
      else if (raw.includes('€') || raw.includes('EUR')) currency = 'EUR';
      else if (raw.includes('£') || raw.includes('GBP')) currency = 'GBP';
      else if (raw.includes('¥') && raw.includes('JPY')) currency = 'JPY';
      else if (raw.includes('¥') && raw.includes('CNY')) currency = 'CNY';
      else if (raw.includes('CHF')) currency = 'CHF';
      else if (raw.includes('SGD')) currency = 'SGD';
      else if (raw.includes('AUD')) currency = 'AUD';
      else if (raw.includes('CAD')) currency = 'CAD';
      else currency = 'USD';
    }

    if (suffix === 'k' || suffix === 'K') num *= 1000;
    if (suffix === 'm' || suffix === 'M') num *= 1000000;

    // Sanity check: if price > $50M, probably parsing error
    if (num > 50000000) {
      notes.push(`Price "${num}" rejected as parsing artifact`);
      extractedRawPrice = null;
    } else {
      extractedRawPrice = num;
      extractedCurrency = currency;
      notes.push(`Price: ${currency} ${num.toLocaleString()}`);
    }
  } else {
    notes.push('No price found');
  }

  // Dial
  let extractedDial: string | null = null;
  const dialMatch = raw.match(DIAL_REGEX);
  if (dialMatch) {
    extractedDial = dialMatch[1];
    notes.push(`Dial color: "${extractedDial}"`);
  } else {
    notes.push('No dial color found');
  }

  // Condition
  let extractedCondition: string | null = null;
  const condMatch = raw.match(CONDITION_REGEX);
  if (condMatch) {
    extractedCondition = condMatch[1];
    notes.push(`Condition: "${extractedCondition}"`);
  } else {
    notes.push('No condition found');
  }

  return {
    name: 'Structured Extraction',
    status: extractedRef ? 'success' : 'warning',
    input: { raw },
    output: { extractedBrand, extractedRef, extractedRawPrice, extractedCurrency, extractedDial, extractedCondition },
    notes,
  };
}

// ─── Stage 2: Normalization & Translation ───────────────────────

function stageNormalize(
  extracted: {
    extractedBrand: string | null;
    extractedRef: string | null;
    extractedRawPrice: number | null;
    extractedCurrency: string | null;
    extractedDial: string | null;
    extractedCondition: string | null;
  }
): PipelineStage {
  const notes: string[] = [];

  // Normalize brand
  const normalizedBrand = extracted.extractedBrand;
  if (normalizedBrand) {
    notes.push(`Brand: "${normalizedBrand}"`);
  }

  // Normalize reference (keep as-is, cleaned)
  const normalizedRef = extracted.extractedRef;
  if (normalizedRef) {
    notes.push(`Reference: "${normalizedRef}"`);
  }

  // Convert price to USD
  let normalizedPriceUSD: number | null = null;
  if (extracted.extractedRawPrice && extracted.extractedCurrency) {
    const rate = CURRENCY_RATES[extracted.extractedCurrency] || 1.0;
    normalizedPriceUSD = Math.round(extracted.extractedRawPrice * rate);
    notes.push(`Converted ${extracted.extractedCurrency} ${extracted.extractedRawPrice.toLocaleString()} → USD ${normalizedPriceUSD.toLocaleString()}`);
  } else {
    notes.push('No price to convert');
  }

  // Normalize dial
  let normalizedDial: string | null = null;
  if (extracted.extractedDial) {
    const dialKey = extracted.extractedDial.toLowerCase();
    normalizedDial = DIAL_ALIASES[dialKey] || extracted.extractedDial;
    notes.push(`Dial normalized: "${normalizedDial}"`);
  } else {
    notes.push('Dial: UNKNOWN');
  }

  // Normalize condition
  let normalizedCondition: string | null = null;
  if (extracted.extractedCondition) {
    const condKey = extracted.extractedCondition.toLowerCase();
    normalizedCondition = CONDITION_ALIASES[condKey] || extracted.extractedCondition;
    notes.push(`Condition normalized: "${normalizedCondition}"`);
  } else {
    notes.push('Condition: UNKNOWN');
  }

  return {
    name: 'Normalization & Translation',
    status: 'success',
    input: extracted,
    output: { normalizedBrand, normalizedRef, normalizedPriceUSD, normalizedDial, normalizedCondition },
    notes,
  };
}

// ─── Stage 3: Catalog Cross-Reference ───────────────────────────

function stageCatalogMatch(normalizedRef: string | null): PipelineStage {
  const notes: string[] = [];
  let catalogMatch: CatalogEntry | null = null;
  let matchType: 'exact' | 'fuzzy' | 'prefix' | 'none' = 'none';
  let matchDistance = Infinity;

  if (!normalizedRef) {
    notes.push('No reference to match');
    return {
      name: 'Catalog Cross-Reference',
      status: 'warning',
      input: { normalizedRef },
      output: { catalogMatch: null, matchType: 'none', matchDistance: Infinity },
      notes,
    };
  }

  // 1. Exact match
  const exact = REF_INDEX.get(normalizedRef);
  if (exact) {
    catalogMatch = exact;
    matchType = 'exact';
    matchDistance = 0;
    notes.push(`EXACT match: ${exact.reference} (${exact.collection})`);
    return {
      name: 'Catalog Cross-Reference',
      status: 'success',
      input: { normalizedRef },
      output: { catalogMatch, matchType, matchDistance },
      notes,
    };
  }

  // 2. Prefix match (e.g., "5711" matches "5711/1A-010")
  const base = normalizedRef.split('/')[0];
  const prefixMatches = PREFIX_INDEX.get(base);
  if (prefixMatches && prefixMatches.length > 0) {
    catalogMatch = prefixMatches[0];
    matchType = 'prefix';
    matchDistance = levenshteinDistance(normalizedRef, catalogMatch.reference);
    notes.push(`PREFIX match: "${base}" → ${catalogMatch.reference} (${catalogMatch.collection}) — ${prefixMatches.length} variant(s)`);
    return {
      name: 'Catalog Cross-Reference',
      status: 'success',
      input: { normalizedRef },
      output: { catalogMatch, matchType, matchDistance },
      notes,
    };
  }

  // 3. Fuzzy match against all catalog entries
  let bestDist = Infinity;
  let bestEntry: CatalogEntry | null = null;
  for (const entry of CATALOG) {
    const d = levenshteinDistance(normalizedRef, entry.reference);
    if (d < bestDist) {
      bestDist = d;
      bestEntry = entry;
    }
  }

  const similarity = bestEntry ? 1 - bestDist / Math.max(normalizedRef.length, bestEntry.reference.length) : 0;

  if (bestEntry && similarity >= 0.6) {
    catalogMatch = bestEntry;
    matchType = 'fuzzy';
    matchDistance = bestDist;
    notes.push(`FUZZY match: "${normalizedRef}" ~ "${bestEntry.reference}" (${bestEntry.collection}) — similarity ${(similarity * 100).toFixed(1)}%`);
  } else {
    matchType = 'none';
    matchDistance = bestDist;
    notes.push(`No match found. Closest: "${bestEntry?.reference}" at ${(similarity * 100).toFixed(1)}% similarity (threshold: 60%)`);
  }

  return {
    name: 'Catalog Cross-Reference',
    status: catalogMatch ? 'success' : 'warning',
    input: { normalizedRef },
    output: { catalogMatch, matchType, matchDistance },
    notes,
  };
}

// ─── Stage 4: Confidence Scoring ────────────────────────────────

function stageConfidence(
  extracted: {
    extractedRef: string | null;
    extractedRawPrice: number | null;
    extractedDial: string | null;
    extractedCondition: string | null;
  },
  normalized: {
    normalizedPriceUSD: number | null;
    normalizedDial: string | null;
    normalizedCondition: string | null;
  },
  catalogMatch: CatalogEntry | null,
  matchType: 'exact' | 'fuzzy' | 'prefix' | 'none',
): PipelineStage {
  const notes: string[] = [];
  const failureFlags: string[] = [];
  let score = 0;

  // Reference extraction (25 pts)
  if (extracted.extractedRef) {
    score += 25;
    notes.push('+25 Reference extracted');
  } else {
    failureFlags.push('SHORT_REFERENCE');
    notes.push('+0 No reference — flag: SHORT_REFERENCE');
  }

  // Catalog match quality (30 pts)
  if (matchType === 'exact') {
    score += 30;
    notes.push('+30 Exact catalog match');
  } else if (matchType === 'fuzzy') {
    score += 20;
    notes.push('+20 Fuzzy catalog match');
  } else if (matchType === 'prefix') {
    score += 22;
    notes.push('+22 Prefix catalog match');
  } else {
    failureFlags.push('NO_CATALOG_MATCH');
    notes.push('+0 No catalog match — flag: NO_CATALOG_MATCH');
  }

  // Price extraction (20 pts)
  if (extracted.extractedRawPrice && normalized.normalizedPriceUSD) {
    // Check if price is within catalog range
    if (catalogMatch) {
      if (normalized.normalizedPriceUSD >= catalogMatch.typicalPriceLow * 0.3 &&
          normalized.normalizedPriceUSD <= catalogMatch.typicalPriceHigh * 3) {
        score += 20;
        notes.push('+20 Price within reasonable range');
      } else {
        score += 10;
        failureFlags.push('PRICE_OUTLIER');
        notes.push('+10 Price extracted but outside typical range — flag: PRICE_OUTLIER');
      }
    } else {
      score += 15;
      notes.push('+15 Price extracted (no catalog to validate against)');
    }
  } else {
    failureFlags.push('PRICE_MISSING');
    notes.push('+0 No price found — flag: PRICE_MISSING');
  }

  // Dial extraction (15 pts)
  if (normalized.normalizedDial && normalized.normalizedDial !== 'UNKNOWN') {
    if (catalogMatch && catalogMatch.dialColors.includes(normalized.normalizedDial)) {
      score += 15;
      notes.push('+15 Dial color validated against catalog');
    } else if (catalogMatch) {
      score += 10;
      failureFlags.push('DIAL_UNKNOWN');
      notes.push(`+10 Dial extracted but "${normalized.normalizedDial}" not in catalog — flag: DIAL_UNKNOWN`);
    } else {
      score += 12;
      notes.push('+12 Dial extracted');
    }
  } else {
    failureFlags.push('DIAL_UNKNOWN');
    notes.push('+0 No dial — flag: DIAL_UNKNOWN');
  }

  // Condition extraction (10 pts)
  if (normalized.normalizedCondition && normalized.normalizedCondition !== 'UNKNOWN') {
    score += 10;
    notes.push('+10 Condition extracted');
  } else {
    failureFlags.push('CONDITION_UNKNOWN');
    notes.push('+0 No condition — flag: CONDITION_UNKNOWN');
  }

  // Determine verdict
  let verdict: 'APPROVED' | 'AI_REVIEW' | 'HUMAN_REVIEW';
  if (score >= 85) {
    verdict = 'APPROVED';
  } else if (score >= 60) {
    verdict = 'AI_REVIEW';
  } else {
    verdict = 'HUMAN_REVIEW';
  }

  notes.push(`─── Final Score: ${score}/100 → ${verdict} ───`);
  if (failureFlags.length > 0) {
    notes.push(`Flags: ${failureFlags.join(', ')}`);
  }

  return {
    name: 'Confidence Scoring',
    status: score >= 85 ? 'success' : score >= 60 ? 'warning' : 'error',
    input: { extracted, normalized, matchType },
    output: { confidenceScore: score, verdict, failureFlags },
    notes,
  };
}

// ─── IQR Outlier Detection ─────────────────────────────────────

export function detectOutliers(prices: number[]): {
  q1: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
  outliers: number[];
  outlierIndices: number[];
} {
  if (prices.length < 4) {
    return { q1: 0, q3: 0, iqr: 0, lowerBound: 0, upperBound: Infinity, outliers: [], outlierIndices: [] };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  // Q1 (median of lower half)
  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const q1 = lowerHalf.length % 2 === 0
    ? (lowerHalf[lowerHalf.length / 2 - 1] + lowerHalf[lowerHalf.length / 2]) / 2
    : lowerHalf[Math.floor(lowerHalf.length / 2)];

  // Q3 (median of upper half)
  const upperHalf = sorted.slice(Math.ceil(n / 2));
  const q3 = upperHalf.length % 2 === 0
    ? (upperHalf[upperHalf.length / 2 - 1] + upperHalf[upperHalf.length / 2]) / 2
    : upperHalf[Math.floor(upperHalf.length / 2)];

  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const outliers: number[] = [];
  const outlierIndices: number[] = [];
  prices.forEach((p, i) => {
    if (p < lowerBound || p > upperBound) {
      outliers.push(p);
      outlierIndices.push(i);
    }
  });

  return { q1, q3, iqr, lowerBound, upperBound, outliers, outlierIndices };
}

// ─── Main Pipeline ──────────────────────────────────────────────

export function normalizeWatch(raw: string, index: number): NormalizedWatch {
  const id = `watch-${Date.now()}-${index}`;

  // Stage 1: Extract
  const stage1 = stageExtract(raw);
  const s1Out = stage1.output as {
    extractedBrand: string | null;
    extractedRef: string | null;
    extractedRawPrice: number | null;
    extractedCurrency: string | null;
    extractedDial: string | null;
    extractedCondition: string | null;
  };

  // Stage 2: Normalize
  const stage2 = stageNormalize(s1Out);
  const s2Out = stage2.output as {
    normalizedBrand: string | null;
    normalizedRef: string | null;
    normalizedPriceUSD: number | null;
    normalizedDial: string | null;
    normalizedCondition: string | null;
  };

  // Stage 3: Catalog Match
  const stage3 = stageCatalogMatch(s2Out.normalizedRef);
  const s3Out = stage3.output as {
    catalogMatch: CatalogEntry | null;
    matchType: 'exact' | 'fuzzy' | 'prefix' | 'none';
    matchDistance: number;
  };

  // Stage 4: Confidence
  const stage4 = stageConfidence(s1Out, s2Out, s3Out.catalogMatch, s3Out.matchType);
  const s4Out = stage4.output as {
    confidenceScore: number;
    verdict: 'APPROVED' | 'AI_REVIEW' | 'HUMAN_REVIEW';
    failureFlags: string[];
  };

  return {
    id,
    rawInput: raw,
    stages: [stage1, stage2, stage3, stage4],
    extractedBrand: s1Out.extractedBrand,
    extractedRef: s1Out.extractedRef,
    extractedRawPrice: s1Out.extractedRawPrice,
    extractedCurrency: s1Out.extractedCurrency,
    extractedDial: s1Out.extractedDial,
    extractedCondition: s1Out.extractedCondition,
    normalizedBrand: s2Out.normalizedBrand,
    normalizedRef: s2Out.normalizedRef,
    normalizedPriceUSD: s2Out.normalizedPriceUSD,
    normalizedDial: s2Out.normalizedDial,
    normalizedCondition: s2Out.normalizedCondition,
    catalogMatch: s3Out.catalogMatch,
    matchType: s3Out.matchType,
    matchDistance: s3Out.matchDistance,
    confidenceScore: s4Out.confidenceScore,
    verdict: s4Out.verdict,
    failureFlags: s4Out.failureFlags,
    userAction: 'none',
  };
}

export function normalizeMultiple(rawInputs: string[]): NormalizedWatch[] {
  return rawInputs
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw, i) => normalizeWatch(raw, i));
}
