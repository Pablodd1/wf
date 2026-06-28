/**
 * WatchFacts — Semantic Watch Parser
 * ====================================
 * Extracts structured watch data from free-text dealer messages
 * received via WhatsApp / Telegram. Handles luxury brands, multi-format
 * prices, conditions, references, and multi-watch listings.
 *
 * CommonJS — runs in Vercel serverless and local Node scripts.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Threshold above which a parse is auto-approved. */
const APPROVE_THRESHOLD = 85;

/** Threshold above which a parse passes; below lands in human review. */
const HUMAN_THRESHOLD = 70;

/** Currency conversion rates → USD. */
const RATES = {
  USD:  1.0,
  USDT: 1.0,
  HKD:  0.128,
  EUR:  1.08,
  GBP:  1.27,
  CHF:  1.13,
  SGD:  0.74,
  AUD:  0.65,
  CAD:  0.73,
  JPY:  0.0066,
  CNY:  0.138,
  RMB:  0.138,
};

/** Brands we know how to detect, with aliases and extraction rules. */
const BRAND_MAP = [
  { names: ['patek philippe', 'patek', 'pp'],        canon: 'Patek Philippe' },
  { names: ['rolex'],                                  canon: 'Rolex' },
  { names: ['audemars piguet', 'audemars', 'ap'],      canon: 'Audemars Piguet' },
  { names: ['richard mille', 'rm', 'richardmille'],    canon: 'Richard Mille' },
  { names: ['vacheron constantin', 'vacheron', 'vc'],  canon: 'Vacheron Constantin' },
  { names: ['breitling'],                              canon: 'Breitling' },
  { names: ['a. lange & sohne', 'a.lange', 'lange', 'alange'], canon: 'A. Lange & Sohne' },
  { names: ['mb&f', 'mbf', 'max busser'],              canon: 'MB&F' },
  { names: ['omega'],                                  canon: 'Omega' },
  { names: ['cartier'],                                canon: 'Cartier' },
  { names: ['iwc'],                                    canon: 'IWC' },
  { names: ['jaeger-lecoultre', 'jaeger', 'jlc', 'jl'], canon: 'Jaeger-LeCoultre' },
  { names: ['hublot'],                                 canon: 'Hublot' },
  { names: ['tag heuer', 'tagheuer'],                  canon: 'TAG Heuer' },
  { names: ['zenith'],                                 canon: 'Zenith' },
  { names: ['blancpain'],                              canon: 'Blancpain' },
  { names: ['breguet'],                                canon: 'Breguet' },
  { names: ['tudor'],                                  canon: 'Tudor' },
  { names: ['grand seiko', 'grandseiko', 'gs'],        canon: 'Grand Seiko' },
  { names: ['seiko'],                                  canon: 'Seiko' },
  { names: ['panerai'],                                canon: 'Panerai' },
  { names: ['ulysse nardin', 'ulysse'],                canon: 'Ulysse Nardin' },
  { names: ['girard-perregaux', 'girard perregaux'],   canon: 'Girard-Perregaux' },
  { names: ['fp journe', 'f.p.journe', 'journe'],      canon: 'F.P. Journe' },
  { names: ['de bethune', 'debethune'],                canon: 'De Bethune' },
  { names: ['greubel forsey', 'greubelforsey'],        canon: 'Greubel Forsey' },
  { names: ['ferrari'],                                canon: 'Ferrari' },
  { names: ['bulgari', 'bvlgari'],                     canon: 'Bulgari' },
];

/** Reference patterns per brand family. */
const REF_PATTERNS = [
  // Patek Philippe — e.g. 5712/1A-001, 5236P, 6300A
  { regex: /\b(5\d{3}[\/\-]?[0-9A-Z]{2,4}[\-–]?\d{0,3}|4\d{3}[\/\-]?\d{0,3}[A-Z]{0,2}|6\d{3}[A-Z]?|3\d{3}[\/\-]?\d{0,3}[A-Z]{0,2})\b/i, brandHint: 'Patek Philippe' },
  // Rolex — e.g. 126529, 116500LN, 228238, 124060
  { regex: /\b(\d{5,6}\s?[A-Z]{0,3})\b/i, brandHint: 'Rolex' },
  // AP Royal Oak / Offshore — e.g. 15210ST, 26420SO, 26240OR
  { regex: /\b(\d{5}[A-Z]{2,4}\.?\d{0,2})\b/i, brandHint: 'Audemars Piguet' },
  // Richard Mille — e.g. RM07-01, RM11-03, RM35-02
  { regex: /\b(RM\s?\d{2}[\-–]?\d{2})(?:\s|$|[A-Z]?\b)/i, brandHint: 'Richard Mille' },
  // Vacheron — e.g. 4300V/220R, 6000V, 85180
  { regex: /\b(\d{4,5}[Vv]?\/?\d{0,3}[A-Za-z]{0,3})\b/i, brandHint: 'Vacheron Constantin' },
  // Generic fallback — NNNNN or NNNN/XX format
  { regex: /\b([A-Z]*\d{4,6}[\/\-]?[A-Z0-9]{0,4})\b/i, brandHint: null },
];

/** Dial colour keywords mapped to canonical names. */
const DIAL_KEYWORDS = {
  black:    ['black', 'noir', 'nero'],
  blue:     ['blue', 'bleu', 'navy', 'ocean'],
  white:    ['white', 'blanc', 'bianco', 'silver'],
  green:    ['green', 'vert', 'verde'],
  brown:    ['brown', 'bronze', 'marron', 'chocolate', 'coffee'],
  grey:     ['grey', 'gray', 'gris', 'grigio', 'slate', 'anthracite'],
  champagne:['champagne', 'champ', 'gold dial'],
  salmon:   ['salmon', 'copper', 'rose gold dial'],
  purple:   ['purple', 'violet', 'lilac'],
  red:      ['red', 'rouge', 'rosso', 'burgundy'],
  orange:   ['orange'],
  yellow:   ['yellow', 'jaune', 'giallo'],
  silver:   ['silver', 'argent'],
  'mother of pearl': ['mother of pearl', 'mop', 'nacre', 'pearl'],
};

/** Dial colour hints from reference suffixes. */
const REF_DIAL_MAP = {
  BL: 'blue', B: 'blue', BU: 'blue',
  BK: 'black', K: 'black', BLK: 'black',
  W: 'white', WH: 'white', WT: 'white',
  G: 'green', GN: 'green', GRN: 'green',
  S: 'silver', SL: 'silver', SI: 'silver',
  CH: 'champagne', C: 'champagne',
  R: 'red', RD: 'red',
  O: 'orange', OR: 'orange',
  P: 'purple', PU: 'purple',
  SA: 'salmon', SAL: 'salmon',
  BR: 'brown', BN: 'brown',
  GY: 'grey', GRY: 'grey', GR: 'grey',
  MOP: 'mother of pearl',
};

/** Condition keywords and their canonical forms. */
const CONDITION_MAP = [
  { keywords: ['new', 'bnib', 'brand new'],                              canon: 'New',    score: 1.0 },
  { keywords: ['like new', 'mint', '99%', '99 new', '98%', '97%', '96%', '95%'], canon: 'Like New', score: 0.95 },
  { keywords: ['nos', 'new old stock'],                                   canon: 'NOS',    score: 0.98 },
  { keywords: ['unused', 'unworn'],                                      canon: 'Unused', score: 0.99 },
  { keywords: ['excellent', 'exc', 'great condition', 'very good', 'vgc'], canon: 'Excellent', score: 0.85 },
  { keywords: ['good', 'good condition', 'gwc'],                         canon: 'Good',   score: 0.7 },
  { keywords: ['fair', 'used', 'pre-owned', 'preowned', 'pre owned'],    canon: 'Used',   score: 0.5 },
  { keywords: ['poor', 'bad', 'damaged', 'scratches'],                   canon: 'Poor',   score: 0.2 },
];

/** Box & papers accessory keywords. */
const ACCESSORY_PATTERNS = {
  fullSet:     /\bfull\s*set\b|\bcomplete\s*set\b|\bfullset\b|\bfull\s*kit\b|\bwith\s*everything\b/i,
  box:         /\bwith\s*box\b|\bw[\/\s]?box\b|\bbox\s*(?:and|&)\s*papers\b|\bhas\s*box\b|\boriginal\s*box\b/i,
  papers:      /\bwith\s*papers\b|\bw[\/\s]?papers\b|\bpapers?\b|\bcard\b|\bcertificate\b|\bwarranty\s*card\b|\bkeep\s*card\b|\bkeepcard\b/i,
  noBox:       /\bno\s*box\b|\bwithout\s*box\b|\bbox\s*only\b(?!.*papers)/i,
  noPapers:    /\bno\s*papers\b|\bwithout\s*papers\b|\bpapers\s*only\b(?!.*box)/i,
  noBoxPapers: /\bno\s*box\s*(and|&)\s*no\s*papers\b|\bno\s*bp\b|\bnobp\b|\bnaked\b(?!.*strap)/i,
};

/** Multipliers used in price parsing. */
const PRICE_MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 };

// ═══════════════════════════════════════════════════════════════
// HELPER: createCryptoHash (Node >=19 compatible)
// ═══════════════════════════════════════════════════════════════

function _createHash(input) {
  try {
    // Node >= 19 — require is still available in CJS
    const crypto = require('crypto');
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
  } catch (_e) {
    // Fallback for edge environments without crypto
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return String(Math.abs(h));
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Split a message that may contain multiple watches separated by // or |.
 * @param {string} text
 * @returns {string[]}
 */
function splitMultiWatch(text) {
  if (!text) return [''];
  // Split on // or | or \\ — but be careful not to split URLs
  const parts = text
    .split(/(?:\s*\/\/\s*|\s*\|\s*|\s*\\\s*)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}

/**
 * Detect the watch brand from a dealer message.
 * @param {string} text
 * @returns {string | null}
 */
function parseBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of BRAND_MAP) {
    for (const alias of entry.names) {
      // Use word-boundary matching where possible
      const pattern = new RegExp('(?:^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
      if (pattern.test(lower)) {
        return entry.canon;
      }
      // Fallback: substring match ONLY for longer aliases (>= 4 chars)
      // Short aliases like "ap", "vc" cause false positives (e.g. "papers")
      if (alias.length >= 4 && lower.includes(alias)) {
        return entry.canon;
      }
    }
  }
  return null;
}

/**
 * Extract a watch reference number from the message.
 * @param {string} text
 * @param {string} [brandHint] — known brand to prioritise patterns
 * @returns {string | null}
 */
function parseReference(text, brandHint) {
  if (!text) return null;
  const clean = text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')   // zero-width chars
    .replace(/\n/g, ' ');

  // Re-order patterns so brand-hint matches come first
  const ordered = [...REF_PATTERNS].sort((a, b) => {
    if (a.brandHint && a.brandHint === brandHint) return -1;
    if (b.brandHint && b.brandHint === brandHint) return 1;
    return 0;
  });

  for (const pat of ordered) {
    const m = clean.match(pat.regex);
    if (m) {
      const ref = m[1].replace(/\s+/g, '').toUpperCase();
      // Filter out obviously wrong matches (years, phone numbers)
      if (/^\d{4}$/.test(ref) && (ref.startsWith('19') || ref.startsWith('20'))) continue;
      if (/^\d{5,6}$/.test(ref)) {
        // Could be a price — if followed by currency hints, skip
        const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
        if (after.includes('usd') || after.includes('hkd') || after.includes('eur') || after.includes('k') || after.includes('m')) {
          continue;
        }
      }
      return ref;
    }
  }
  return null;
}

/**
 * Extract the dial colour from the message text.
 * @param {string} text
 * @param {string} [ref] — reference number for suffix lookup
 * @returns {string | null}
 */
function parseDial(text, ref) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // 1. Keyword search
  for (const [colour, aliases] of Object.entries(DIAL_KEYWORDS)) {
    for (const alias of aliases) {
      const rx = new RegExp('(?:^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
      if (rx.test(lower)) {
        return colour;
      }
    }
  }

  // 2. Reference suffix extraction
  if (ref) {
    const dialCode = inferDialFromRef(ref);
    if (dialCode) return dialCode;
  }

  return null;
}

/**
 * Infer dial colour from the alphabetic suffix of a reference number.
 * @param {string} ref
 * @returns {string | null}
 */
function inferDialFromRef(ref) {
  if (!ref) return null;
  // Extract trailing letters: 5712/1A-001 → ['A']; 15210ST → ['ST']
  const suffixMatch = ref.match(/[A-Za-z]+(?=\d*$|[\-\/]?\d*$)/g);
  if (suffixMatch) {
    for (const sfx of suffixMatch) {
      const upper = sfx.toUpperCase();
      if (REF_DIAL_MAP[upper]) return REF_DIAL_MAP[upper];
      // Try single-letter prefix
      if (upper.length >= 1 && REF_DIAL_MAP[upper[0]]) return REF_DIAL_MAP[upper[0]];
    }
  }
  return null;
}

/**
 * Infer brand from a known reference number pattern.
 * @param {string} ref
 * @returns {string | null}
 */
function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  if (r.startsWith('RM')) return 'Richard Mille';
  if (r.startsWith('5') || r.startsWith('4') || r.startsWith('6') || r.startsWith('3')) {
    // Patek Philippe references typically start with 3, 4, 5, 6
    if (/^\d{4,5}[\/\-]?/.test(r)) return 'Patek Philippe';
  }
  if (/^\d{6}/.test(r)) {
    // 6-digit refs are usually Rolex
    const first2 = parseInt(r.slice(0, 2), 10);
    if (first2 >= 11 && first2 <= 27) return 'Rolex';
  }
  if (/^\d{5}[A-Z]{2}/.test(r)) return 'Audemars Piguet';
  if (r.startsWith('43') || r.startsWith('60') || r.startsWith('85') || r.startsWith('31')) {
    return 'Vacheron Constantin';
  }
  return null;
}

/**
 * Extract condition from the message.
 * @param {string} text
 * @returns {{ condition: string | null, score: number }}
 */
function parseCondition(text) {
  if (!text) return { condition: null, score: 0 };
  const lower = text.toLowerCase();
  for (const entry of CONDITION_MAP) {
    for (const kw of entry.keywords) {
      const rx = new RegExp('(?:^|[^a-z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z])', 'i');
      if (rx.test(lower)) {
        return { condition: entry.canon, score: entry.score };
      }
    }
  }
  // Default
  return { condition: null, score: 0 };
}

/**
 * Extract the manufacturing year from the message.
 * @param {string} text
 * @returns {number | null}
 */
function parseYear(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Explicit year mentions: "2021", "year 2022", "2024 full set"
  const explicit = lower.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  if (explicit) {
    const y = parseInt(explicit[1], 10);
    if (y >= 1950 && y <= 2030) return y;
  }

  // "N5/N6 2026" → condition grading, not year
  // "Dec 2021" → capture just the year
  const nearCondition = lower.match(/(?:new\s+\d{2}|n\d{1,2}[/\\]n?\d{0,2})\s*(20\d{2})/);
  if (nearCondition) return parseInt(nearCondition[1], 10);

  return null;
}

/**
 * Extract price from the message text.
 * Handles: 208.000Usdt, 2.2M HKD, 138K HKD, 268000HKD, 1.43M HKD, etc.
 * @param {string} text
 * @param {string} [ref] — reference to avoid extracting ref as price
 * @returns {number | null}
 */
function parsePrice(text, ref) {
  if (!text) return null;
  const clean = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, ' ');

  // Remove the reference number so we don't capture it as price
  let searchText = clean;
  if (ref) {
    searchText = searchText.replace(new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }

  // Patterns in order of specificity
  const patterns = [
    // 2.2M, 1.43M (with optional spaces)
    { regex: /\b(\d{1,3}(?:[.,]\d{1,3})?)\s*[Mm]\b(?![a-zA-Z])/g, multiplier: 1e6 },
    // 138K, 45k
    { regex: /\b(\d{1,3}(?:[.,]\d{1,3})?)\s*[Kk]\b(?![a-zA-Z])/g, multiplier: 1e3 },
    // 208.000 (European decimal — thousands separator)
    { regex: /\b(\d{1,3}[.,]\d{3})\s*(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|RMB)?\b/gi, multiplier: 1, european: true },
    // 268000 (bare number, likely a price if followed by currency or context)
    { regex: /\b(\d{4,7})\s*(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|CNY|RMB)\b/gi, multiplier: 1 },
    // Bare number near price context words
    { regex: /(?:price|asking|ask|sell|offer|offered|at)\s*[:]?\s*(\d{1,3}(?:[,]?\d{3})*(?:\.\d+)?)/gi, multiplier: 1 },
    // General fallback: any number with 4-7 digits
    { regex: /\b(\d{4,7})\b/g, multiplier: 1 },
  ];

  for (const pat of patterns) {
    const matches = [...searchText.matchAll(pat.regex)];
    for (const m of matches) {
      let raw = m[1].replace(/,/g, '');
      let value;
      if (pat.european && /\d\.\d{3}$/.test(raw)) {
        // European thousands separator: 208.000 → 208000
        value = parseInt(raw.replace(/\./g, ''), 10);
      } else {
        value = parseFloat(raw.replace(/,/g, ''));
      }
      if (!isNaN(value) && value > 0) {
        const final = Math.round(value * (pat.multiplier || 1));
        // Sanity check: luxury watch prices are typically 1K–5M
        if (final >= 500 && final <= 10_000_000) {
          return final;
        }
      }
    }
  }
  return null;
}

/**
 * Extract the currency code from the message.
 * @param {string} text
 * @returns {string | null}
 */
function parseCurrency(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const currencies = [
    ['usdt', 'USDT'], ['usd', 'USD'], ['hkd', 'HKD'], ['eur', 'EUR'],
    ['gbp', 'GBP'], ['chf', 'CHF'], ['sgd', 'SGD'], ['aud', 'AUD'],
    ['cad', 'CAD'], ['jpy', 'JPY'], ['cny', 'CNY'], ['rmb', 'RMB'],
  ];
  for (const [code, canonical] of currencies) {
    // Use a looser boundary: currency code must be preceded by non-letter
    // and followed by non-letter (or string end). This handles "208.000Usdt"
    // where 't' is preceded by a digit.
    const rx = new RegExp('(?:^|[^a-z])' + code + '(?:[^a-z]|$)', 'i');
    if (rx.test(lower)) return canonical;
  }
  // Default: if no currency found but price present, assume USD in watch trading
  return null;
}

/**
 * Convert an amount from any supported currency to USD.
 * @param {number} amount
 * @param {string} currency
 * @returns {number}
 */
function toUSD(amount, currency) {
  if (!amount || amount <= 0) return 0;
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

/**
 * Detect box & papers status from the message.
 * @param {string} text
 * @returns {{ hasBox: boolean, hasPapers: boolean, note: string | null }}
 */
function parseAccessories(text) {
  if (!text) return { hasBox: false, hasPapers: false, note: null };
  const lower = text.toLowerCase();

  // Full set → both box and papers
  if (ACCESSORY_PATTERNS.fullSet.test(lower)) {
    return { hasBox: true, hasPapers: true, note: 'Full Set' };
  }

  // No box & no papers
  if (ACCESSORY_PATTERNS.noBoxPapers.test(lower)) {
    return { hasBox: false, hasPapers: false, note: 'No Box/Papers' };
  }

  // Individual checks
  const hasBox = ACCESSORY_PATTERNS.box.test(lower);
  const hasPapers = ACCESSORY_PATTERNS.papers.test(lower);
  const noBox = ACCESSORY_PATTERNS.noBox.test(lower);
  const noPapers = ACCESSORY_PATTERNS.noPapers.test(lower);

  const finalBox = hasBox && !noBox;
  const finalPapers = hasPapers && !noPapers;

  let note = null;
  if (finalBox && finalPapers) note = 'Box & Papers';
  else if (finalBox && !finalPapers) note = 'Box Only';
  else if (!finalBox && finalPapers) note = 'Papers Only';
  else if (!finalBox && !finalPapers) note = null;

  return { hasBox: finalBox, hasPapers: finalPapers, note };
}

/**
 * Classify the listing type (WTS / WTB / WTT / GARBAGE).
 * @param {string} text
 * @returns {'WTS' | 'WTB' | 'WTT' | 'GARBAGE'}
 */
function classifyListingType(text) {
  if (!text || text.trim().length === 0) return 'GARBAGE';
  const lower = text.toLowerCase();

  // GARBAGE signals — non-watch content
  const garbageSignals = [
    /\b(scam|spam|fake|replica|rep\b|superclone|1:1 clone)/i,
    /\b(crypto airdrop|join my group|click here|free money)/i,
    /\b(viagra|cialis|casino|betting|lottery)\b/i,
  ];
  for (const rx of garbageSignals) {
    if (rx.test(lower)) return 'GARBAGE';
  }

  // WTB signals — want to buy
  const wtbSignals = [
    /\b(wtb|want to buy|looking for|seeking|buying|wanted|in search of|iso\b)\b/i,
    /\bwant\s+this\s+watch\b/i,
    /\bbuy\s+(?:any|the|a)\b.*\bwatch\b/i,
  ];
  for (const rx of wtbSignals) {
    if (rx.test(lower)) return 'WTB';
  }

  // WTT signals — want to trade
  const wttSignals = [
    /\b(wtt|want to trade|trade for|trading|swap for|swap with|exchange for|px\s+welcome|part\s*exchange)\b/i,
  ];
  for (const rx of wttSignals) {
    if (rx.test(lower)) return 'WTT';
  }

  // WTS signals — want to sell (default assumption for dealer messages)
  const wtsSignals = [
    /\b(wts|want to sell|selling|for sale|fs\b|available|asking|price is|offer|offered)\b/i,
    /\$\d/i, /\d+\s*(?:usd|usdt|hkd|eur|gbp)/i,
    /\d+[KkMm]\s*(?:usd|usdt|hkd|eur|gbp)/i,
  ];
  for (const rx of wtsSignals) {
    if (rx.test(lower)) return 'WTS';
  }

  // If it has brand + reference but no clear intent → assume WTS (dealer default)
  if (parseBrand(text) && parseReference(text)) {
    return 'WTS';
  }

  return 'GARBAGE';
}

/**
 * Compute a deterministic hash for a message (used for dedup).
 * @param {string} text
 * @returns {string}
 */
function hashMessage(text) {
  if (!text) return '';
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return _createHash(normalised);
}

/**
 * Calculate field-level and overall confidence scores.
 * @param {object} fields
 * @returns {{ confidence: number, fieldConfidence: Record<string, number> }}
 */
function calculateConfidence(fields) {
  const fc = {};

  // Brand confidence
  if (fields.brand) {
    fc.brand = 95; // brand detection is very reliable
  } else {
    fc.brand = 0;
  }

  // Reference confidence
  if (fields.reference) {
    fc.reference = 90;
  } else {
    fc.reference = 0;
  }

  // Price confidence
  if (fields.price && fields.price > 0) {
    fc.price = fields.currency ? 95 : 75;
  } else {
    fc.price = 0;
  }

  // Condition confidence
  if (fields.condition) {
    fc.condition = 85;
  } else {
    fc.condition = 30; // partial — we can still process
  }

  // Dial colour confidence
  if (fields.dial) {
    fc.dial = 80;
  } else {
    fc.dial = 20;
  }

  // Year confidence
  if (fields.year) {
    fc.year = 90;
  } else {
    fc.year = 10;
  }

  // Currency confidence
  if (fields.currency) {
    fc.currency = 95;
  } else {
    fc.currency = 50; // we default to USD
  }

  // Weighted average
  const weights = { brand: 0.20, reference: 0.20, price: 0.20, condition: 0.10, dial: 0.10, year: 0.10, currency: 0.10 };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [field, weight] of Object.entries(weights)) {
    weightedSum += (fc[field] || 0) * weight;
    totalWeight += weight;
  }

  const confidence = Math.round(weightedSum / totalWeight);
  return { confidence, fieldConfidence: fc };
}

/**
 * Apply a business verdict based on parse confidence and field presence.
 * @param {object} parsed — object with at least { confidence, brand, reference, price }
 * @returns {'APPROVED' | 'HUMAN' | 'RECYCLE' | 'REVIEW'}
 */
function verdict(parsed) {
  const c = parsed.confidence || 0;

  // Must have brand and reference at minimum
  if (!parsed.brand || !parsed.reference) {
    return 'RECYCLE';
  }

  // Must have a price for WTS listings
  if (parsed.listingType === 'WTS' && (!parsed.price || parsed.price <= 0)) {
    return 'HUMAN';
  }

  if (c >= APPROVE_THRESHOLD) return 'APPROVED';
  if (c >= HUMAN_THRESHOLD) return 'REVIEW';
  if (c >= 50) return 'HUMAN';
  return 'RECYCLE';
}

/**
 * Full parse: extract all watch fields from a raw dealer message.
 * @param {string} rawMsg
 * @returns {object} parsed watch fields
 */
function parseFull(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'string') {
    return {
      brand: null,
      ref: null,
      dial: null,
      condition: null,
      year: null,
      price: null,
      currency: null,
      confidence: 0,
      fieldConfidence: {},
      listingType: 'GARBAGE',
      accessories: { hasBox: false, hasPapers: false, note: null },
    };
  }

  const text = rawMsg.trim();

  // Detect brand first (helps reference extraction)
  const brand = parseBrand(text);

  // Extract reference
  const ref = parseReference(text, brand || undefined);

  // If no brand but we have a reference, try to infer brand
  const finalBrand = brand || inferBrandFromRef(ref);

  // Extract other fields
  const dial = parseDial(text, ref || undefined);
  const { condition } = parseCondition(text);
  const year = parseYear(text);
  const currency = parseCurrency(text) || 'USD';
  const price = parsePrice(text, ref || undefined);
  const listingType = classifyListingType(text);
  const accessories = parseAccessories(text);

  // Calculate confidence
  const { confidence, fieldConfidence } = calculateConfidence({
    brand: finalBrand,
    reference: ref,
    price,
    currency,
    condition,
    dial,
    year,
  });

  return {
    brand: finalBrand,
    ref,
    dial,
    condition,
    year,
    price,
    currency,
    confidence,
    fieldConfidence,
    listingType,
    accessories,
  };
}

// ═══════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Main entry
  parseFull,

  // Individual extractors
  parsePrice,
  parseCurrency,
  verdict,
  splitMultiWatch,
  inferBrandFromRef,
  inferDialFromRef,
  toUSD,
  classifyListingType,
  hashMessage,

  // Data tables
  RATES,
  APPROVE_THRESHOLD,
  HUMAN_THRESHOLD,

  // Also export internal helpers for testing / advanced use
  parseBrand,
  parseReference,
  parseDial,
  parseCondition,
  parseYear,
  parseAccessories,
  calculateConfidence,
  inferBrandFromRef,
  inferDialFromRef,
};
