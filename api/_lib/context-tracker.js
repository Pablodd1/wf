/**
 * ContextTracker — Stateful context tracking across multi-line WhatsApp messages
 * ================================================================================
 * THE missing piece: tracks active_brand, active_currency, active_condition,
 * and model_cache across all lines in a single WhatsApp message.
 *
 * This is what neither the current parser nor the BitBucket admin panel does.
 * Without context tracking:
 *   - HKD prices stored as USD (284K corrupted listings)
 *   - Brand inheritance lost (35% parse failures on lines without explicit brand)
 *   - Condition not propagated ("Full Set" in header ignored by child lines)
 *
 * Usage:
 *   const tracker = new ContextTracker();
 *   for (const line of messageLines) {
 *     tracker.updateFromLine(line);
 *     const ctx = tracker.getContext(line);
 *     // ctx = { brand: 'Rolex', currency: 'HKD', condition: 'Full Set', modelCache: {...} }
 *     const parsed = parseFullWithContext(line, ctx);
 *   }
 *
 * Part of the State Machine enhancement to parser.js v3.1 → v4.0
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// BRAND HEADER DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Emoji + text patterns that indicate the active brand for subsequent lines.
 * Keyed by canonical brand name.
 */
const BRAND_HEADERS = [
  // Patek Philippe — 🍉 (melon), 🫒 (olive), PP
  { brand: 'Patek Philippe', patterns: [
    /🍉/u, /🫒/u,
    /\bPP\s+(?:used|new|ready|available|fresh)/i,
    /^PP\s*$/i,                               // standalone "PP" header
    /^PP$/i,                                   // exact match "PP" on own line
    /\bpatek\b/i, /\bnautilus\b/i, /\baquanut\b/i,
    /🍍.*pp/i, /PP\s*🍍/i,
  ]},
  // Rolex — 🏆 (trophy), ⭐ (star), 🇭🇰 flag + rolex
  { brand: 'Rolex', patterns: [
    /🏆/u, /⭐/u, /🌟/u, /🇭🇰/u,
    /\brolex\s+(?:used|new|ready|available|fresh)/i,
    /🇭🇰.*rolex/i, /rolex.*🇭🇰/i,
  ]},
  // Audemars Piguet — AP
  { brand: 'Audemars Piguet', patterns: [
    /⭐.*AP/i, /AP\s*⭐/i,
    /\bAP\s+(?:used|new|ready|available|fresh)/i,
    /^AP\s*$/i,                                // standalone "AP" header
    /\baudemars\b/i, /\broyal\s*oak\b/i,
  ]},
  // Richard Mille — 💎 (diamond), RM
  { brand: 'Richard Mille', patterns: [
    /💎/u,
    /\bRM\s+(?:used|new|ready|available|fresh)/i,
    /\brichard\s*mille\b/i,
  ]},
  // Omega — ⌡ (clock)
  { brand: 'Omega', patterns: [
    /\bomega\s+(?:used|new|ready|available|fresh)/i,
    /\bspeedmaster\b/i, /\bseamaster\b/i,
  ]},
  // Hublot
  { brand: 'Hublot', patterns: [
    /\bhublot\s+(?:used|new|ready|available)/i,
    /\bbig\s*bang\s*(?:king|unico|mp)/i,
  ]},
  // Vacheron Constantin
  { brand: 'Vacheron Constantin', patterns: [
    /\bVC\s+(?:used|new|ready|available)/i,
    /\bvacheron\b/i, /\boverseas\b/i,
    /🔑.*VC/i,
  ]},
  // Cartier
  { brand: 'Cartier', patterns: [
    /\bcartier\s+(?:used|new|ready|available)/i,
    /\bsantos\b/i, /\btank\s+(?:watch|solo|louis|francaise)/i,
  ]},
];

// ═══════════════════════════════════════════════════════════════
// CURRENCY DETECTION (CONTEXT-LEVEL)
// ═══════════════════════════════════════════════════════════════

/**
 * Signals that set the active currency context for subsequent lines.
 * This is the HKD bug fix — if the header says HK, all prices are HKD.
 */
const CURRENCY_SIGNALS = [
  // Explicit currency mentions
  { currency: 'HKD', patterns: [
    /\bhkd\b/i, /港币/, /港/, /hong\s*kong/i,
    /🇭🇰/u,  // Hong Kong flag
  ]},
  { currency: 'EUR', patterns: [
    /\beur\b/i, /€/, /euros?/i,
  ]},
  { currency: 'GBP', patterns: [
    /\bgbp\b/i, /£/, /pounds?/i,
  ]},
  { currency: 'CHF', patterns: [
    /\bchf\b/i, /swiss/i, /🇨🇭/u,
  ]},
  { currency: 'SGD', patterns: [
    /\bsgd\b/i, /singapore/i, /🇸🇬/u,
  ]},
  { currency: 'CNY', patterns: [
    /\bcny\b/i, /\brmb\b/i, /¥/, /人民币/,
  ]},
  // Hong Kong dealer phone number patterns (common in WhatsApp)
  // +852 = Hong Kong country code
  { currency: 'HKD', patterns: [
    /\+852\s*\d/, /whatsapp.*\+852/i, /\+852/,
  ]},
];

// ═══════════════════════════════════════════════════════════════
// CONDITION DETECTION (CONTEXT-LEVEL)
// ═══════════════════════════════════════════════════════════════

const CONDITION_HEADERS = [
  { condition: 'Full Set', patterns: [/full\s*set/i, /complete\s*set/i, /全套/, /fullset/i] },
  { condition: 'Watch Only', patterns: [/watch\s*only/i, /bare\s*watch/i, /表壳/, /\bwo\b/i] },
  { condition: 'Unworn', patterns: [/unworn/i, /全新/, /brand\s*new/i, /\bbnib\b/i, /\bnos\b/i] },
];

// ═══════════════════════════════════════════════════════════════
// MODEL CACHE — learn ref→model pairs within a message
// ═══════════════════════════════════════════════════════════════

/**
 * Known ref→model mappings for learning.
 * When we see "5712G Nautilus", we cache 5712→Nautilus.
 * Later lines with just "5712G" inherit the model name.
 */
const REF_MODEL_PATTERNS = [
  // Patek Philippe
  { brand: 'Patek Philippe', refs: {
    '5711': 'Nautilus', '5712': 'Nautilus', '5980': 'Nautilus',
    '5167': 'Aquanaut', '5168': 'Aquanaut', '5960': 'Aquanaut',
    '5236': 'Twenty-4', '5905': 'Aquanaut', '5811': 'Nautilus',
    '6300': 'Grandmaster Chime', '5205': 'Annual Calendar',
    '5234': 'Twenty-4', '5146': 'Annual Calendar', '7118': 'Nautilus',
    '5172': 'Chronograph', '5172G': 'Chronograph',
  }},
  // Rolex
  { brand: 'Rolex', refs: {
    '126610': 'Submariner', '116610': 'Submariner', '126618': 'Submariner',
    '126710': 'GMT-Master II', '126720': 'GMT-Master II', '126711': 'GMT-Master II',
    '228238': 'Day-Date', '228398': 'Day-Date', '128348': 'Day-Date',
    '126234': 'Datejust', '126200': 'Datejust', '126300': 'Datejust',
    '124060': 'Submariner', '126610LN': 'Submariner', '126610LV': 'Submariner',
    '126500': 'Cosmograph Daytona', '126509': 'Cosmograph Daytona',
    '226570': 'Explorer II', '124270': 'Explorer',
    '126609': 'Sea-Dweller', '126600': 'Sea-Dweller',
    '228206': 'Sky-Dweller', '228239': 'Sky-Dweller',
    '278275': 'Pearlmaster', '279160': 'Oyster Perpetual',
    'm126': 'Submariner', 'm116': 'Submariner',
  }},
  // Audemars Piguet
  { brand: 'Audemars Piguet', refs: {
    '15202': 'Royal Oak', '15500': 'Royal Oak', '15510': 'Royal Oak',
    '26240': 'Royal Oak', '26420': 'Royal Oak Offshore',
    '26400': 'Royal Oak Offshore', '26170': 'Royal Oak Offshore',
    '26238': 'Royal Oak', '16202': 'Royal Oak',
    '77350': 'Royal Oak', '15400': 'Royal Oak',
  }},
  // Richard Mille
  { brand: 'Richard Mille', refs: {
    'RM011': 'Felipe Massa', 'RM27': 'Rafael Nadal',
    'RM35': 'Rafael Nadal', 'RM56': 'Sapphire',
    'RM67': 'Extra Flat', 'RM11-03': 'Felipe Massa',
    'RM30-01': 'Le Mans', 'RM07-01': 'Ladies',
    'RM35-02': 'Rafael Nadal', 'RM65-01': 'Automatic Split Seconds',
  }},
  // Omega
  { brand: 'Omega', refs: {
    '310': 'Speedmaster Moonwatch', '311': 'Speedmaster Moonwatch',
    '304': 'Speedmaster', '210': 'Seamaster',
    '215': 'Seamaster', '231': 'Seamaster Planet Ocean',
    '232': 'Seamaster Ploprof', '220': 'Seamaster',
  }},
];

/**
 * Build a flat lookup table from the ref→model patterns.
 */
function buildModelLookup() {
  const lookup = {};
  for (const entry of REF_MODEL_PATTERNS) {
    for (const [ref, model] of Object.entries(entry.refs)) {
      lookup[ref.toUpperCase()] = { brand: entry.brand, model };
    }
  }
  return lookup;
}

const MODEL_LOOKUP = buildModelLookup();

// ═══════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════

class ContextTracker {
  /**
   * Create a new context tracker for a single WhatsApp message.
   * As each line is processed, the tracker learns and propagates context.
   */
  constructor() {
    this.activeBrand = null;
    this.activeCurrency = 'USD';      // default
    this.activeCondition = null;
    this.modelCache = {};              // { '5712': { brand: 'PP', model: 'Nautilus' }, ... }
    this.lineNumber = 0;
    this.history = [];                 // [{ line, context }] for debugging
    this.confidence = {
      brand: 0,                        // 0-100, how confident in brand context
      currency: 50,                    // start neutral
      condition: 0,
    };
  }

  /**
   * Process a line and update context state.
   * Called for EVERY line in the message, top to bottom.
   *
   * @param {string} line - Raw line from the WhatsApp message
   * @returns {object} The context object for this line
   */
  updateFromLine(line) {
    this.lineNumber++;
    if (!line || typeof line !== 'string') return this.getContext();

    const lineStr = String(line);

    // --- BRAND DETECTION ---
    // Check for brand header markers (emoji + brand name)
    let brandDetected = false;
    for (const header of BRAND_HEADERS) {
      for (const pattern of header.patterns) {
        if (pattern.test(lineStr)) {
          // Only update if this is a header line (short, no price, has brand name or emoji)
          // OR if we don't have a brand yet
          if (!this.activeBrand || this._isHeaderLine(lineStr)) {
            this.activeBrand = header.brand;
            this.confidence.brand = 95;
            brandDetected = true;
            break;
          }
          // Even if we have a brand, a different explicit brand should override
          if (this.activeBrand !== header.brand && pattern.source.includes('patek|rolex|audemars|richard|omega|hublot|vacheron|cartier')) {
            this.activeBrand = header.brand;
            this.confidence.brand = 90;
            brandDetected = true;
            break;
          }
        }
      }
      if (brandDetected) break;
    }

    // --- CURRENCY DETECTION ---
    let currencyChanged = false;
    for (const signal of CURRENCY_SIGNALS) {
      for (const pattern of signal.patterns) {
        if (pattern.test(lineStr)) {
          if (this.activeCurrency !== signal.currency) {
            this.activeCurrency = signal.currency;
            this.confidence.currency = 90;
            currencyChanged = true;
          }
          break;
        }
      }
      if (currencyChanged) break;
    }

    // --- CONDITION DETECTION ---
    if (!this.activeCondition || this._isHeaderLine(lineStr)) {
      for (const cond of CONDITION_HEADERS) {
        for (const pattern of cond.patterns) {
          if (pattern.test(lineStr)) {
            this.activeCondition = cond.condition;
            this.confidence.condition = 85;
            break;
          }
        }
        if (this.activeCondition) break;
      }
    }

    // --- MODEL CACHE LEARNING ---
    // Look for ref+model pairs in this line and cache them
    this._learnModelFromLine(lineStr);

    // --- RECORD HISTORY ---
    const ctx = this.getContext();
    this.history.push({ line: lineStr.substring(0, 100), context: { ...ctx } });

    return ctx;
  }

  /**
   * Get current context for a line being parsed.
   */
  getContext() {
    return {
      brand: this.activeBrand,
      currency: this.activeCurrency,
      condition: this.activeCondition,
      modelCache: { ...this.modelCache },
      confidence: { ...this.confidence },
      lineNumber: this.lineNumber,
    };
  }

  /**
   * Look up a model name from the cache by reference number.
   * @param {string} ref - Reference number (e.g., '5712', '5712G')
   * @returns {object|null} { brand, model } or null
   */
  lookupModel(ref) {
    if (!ref) return null;
    const clean = ref.toUpperCase().replace(/[^0-9A-Z]/g, '');

    // Try exact match
    if (this.modelCache[clean]) return this.modelCache[clean];

    // Try prefix match (5712G → look up 5712)
    const prefixes = [clean.substring(0, 6), clean.substring(0, 5), clean.substring(0, 4)];
    for (const prefix of prefixes) {
      if (this.modelCache[prefix]) return this.modelCache[prefix];
    }

    // Try static lookup table
    if (MODEL_LOOKUP[clean]) return MODEL_LOOKUP[clean];
    for (const prefix of prefixes) {
      if (MODEL_LOOKUP[prefix]) return MODEL_LOOKUP[prefix];
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Heuristic: is this line a section header (not a listing)?
   * Headers are short, contain brand names/emojis, but no prices or references.
   */
  _isHeaderLine(line) {
    const t = line.trim();
    if (t.length > 200) return false;      // Headers are short
    if (t.length < 3) return false;
    const hasPrice = /\d{4,}|\d+\s*(?:usd|hkd|eur|gbp)/i.test(t);
    const hasRef = /\b\d{4,6}[A-Z]/i.test(t);
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(t);
    const hasBrandWord = /patek|rolex|audemars|richard|omega|hublot|vacheron|cartier|AP\b|PP\b|RM\b/i.test(t);
    return (hasEmoji || hasBrandWord) && !hasPrice && !hasRef;
  }

  /**
   * Look for ref+model pairs in a line and cache them.
   * Examples: "5712G Nautilus", "126610LN Submariner", "RM11-03 Felipe Massa"
   */
  _learnModelFromLine(line) {
    // Pattern: 4-7 digit reference followed by a known model name
    const refModelRegex = /\b(\d{4,7}[A-Z]{0,3}|RM\d{2}-\d{2,3})\s+([A-Z][a-z]+)/g;
    let match;
    while ((match = refModelRegex.exec(line)) !== null) {
      const ref = match[1].toUpperCase().replace(/[^0-9A-Z]/g, '');
      const model = match[2].trim();
      // Reject: colors, currency, numbers, generic words
      const REJECT_WORDS = /usd|hkd|eur|gbp|chf|sgd|price|sell|blue|black|white|green|red|brown|grey|gray|silver|gold|pink|salmon|champagne|new|used|full|mint|nos|box|papers|set|unworn|excellent|good|fair|poor/i;
      if (model.length >= 4 && !/^\d/.test(model) && !REJECT_WORDS.test(model)) {
        // Use brand from context or from lookup
        const known = MODEL_LOOKUP[ref] || MODEL_LOOKUP[ref.substring(0, 4)];
        this.modelCache[ref] = {
          brand: known?.brand || this.activeBrand,
          model: model,
        };
        // Also cache shorter prefix (5712G → 5712)
        if (ref.length >= 5) {
          const prefix = ref.substring(0, 4);
          if (!this.modelCache[prefix]) {
            this.modelCache[prefix] = { brand: this.activeBrand, model };
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE SEGMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Split a raw WhatsApp message into individual listing lines.
 * This handles dealer dumps where 5-50 watches are posted in a single message.
 *
 * Split points:
 *   - Double newline (\\n\\n)
 *   - Emoji markers at line start (🏆, ⭐, 🌟, 🍉, 💎)
 *   - Separator lines (===, ---, ***)
 *
 * @param {string} rawMessage - Full WhatsApp message text
 * @returns {string[]} Array of individual listing text segments
 */
function segmentMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') return [];

  const text = rawMessage.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 0: Split dense multi-listing lines BEFORE the rest
  // Pattern: $price N-code -> boundary between listings
  // Example: "279175 G purple$258000N4 278383g silver jub$181000N11"
  // Should become: ["279175 G purple$258000", "278383g silver jub$181000"]
  const rawLines = text.split(/\n/);
  const expandedLines = [];
  
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) { expandedLines.push(''); continue; }

    const dollarCount = (trimmed.match(/\$/g) || []).length;
    const ncodeCount = (trimmed.match(/\bN\d{1,2}\b/gi) || []).length;

    if (dollarCount >= 2 && ncodeCount >= 2) {
      // Dense multi-listing: split on ref boundaries after $price N-code
      const segments = [];
      let current = '';
      const parts = trimmed.split(/\s+/);
      let refStarted = false;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const prevPart = parts[i - 1] || '';
        const nextPart = parts[i + 1] || '';

        const looksLikeRef = /^\d{5,6}[A-Za-z]{0,6}$/.test(part) &&
                            !/^(19|20)\d{2}$/.test(part) &&
                            part.length >= 5;

        const prevIsPriceOrCode = /^\$[\d,\.]+[KkMm]?$/.test(prevPart) ||
                                 /^N\d{1,2}$/i.test(prevPart) ||
                                 /^\$[\d,\.]+[KkMm]?$/.test(prevPart.replace('$','$'));

        // Check if previous or 2-back was an N-code (N4, N8, N11)
        const twoBack = parts[i - 2] || '';
        const nearPriceNCode = /^\$[\d,\.]+[KkMm]?$/.test(prevPart) ||
                               /^N\d{1,2}$/i.test(prevPart) ||
                               (/^N\d{1,2}$/i.test(twoBack) && /^\$[\d,\.]+[KkMm]?$/.test(prevPart));

        if (looksLikeRef && refStarted && nearPriceNCode) {
          if (current.trim()) segments.push(current.trim());
          current = part;
          refStarted = true;
        } else if (looksLikeRef && !refStarted) {
          current = part;
          refStarted = true;
        } else {
          if (current) current += ' ' + part;
          else current = part;
        }
      }
      if (current.trim()) segments.push(current.trim());

      if (segments.length >= 2) {
        // Push each segment as a separate line for the double-newline split
        expandedLines.push(...segments.map(s => s + '\n'));
        continue;
      }
    }
    expandedLines.push(trimmed);
  }

  const rejoined = expandedLines.join('\n');

  // Step 1: Split on double newlines
  let segments = rejoined.split(/\n\s*\n+/);

  // Step 2: Within each segment, split on brand-only header lines
  const BRAND_ONLY = /^(pp|ap|vc|rm)\s*$/i;

  const result = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    const lines = trimmed.split(/\n/);
    let currentBlock = [];

    for (const ll of lines) {
      if (BRAND_ONLY.test(ll.trim())) {
        if (currentBlock.length > 0) {
          result.push(currentBlock.join('\n').trim());
          currentBlock = [];
        }
        result.push(ll.trim());
      } else {
        currentBlock.push(ll);
      }
    }
    if (currentBlock.length > 0) {
      result.push(currentBlock.join('\n').trim());
    }
  }

  return result.filter(s => s.length > 0);
}
function parseMessageWithContext(rawMessage, parseFn) {
  if (!rawMessage) return [];

  // Step 1: Segment
  const segments = segmentMessage(rawMessage);
  if (segments.length === 0) return [];

  // Step 2: Create context tracker
  const tracker = new ContextTracker();

  // Step 3: Process each segment
  const results = [];
  for (const segment of segments) {
    // Update context from this segment
    const ctx = tracker.updateFromLine(segment);

    // Parse the segment using the existing parser
    const parsed = parseFn(segment);

    // Apply context overrides where the parser found nothing
    const enhanced = { ...parsed };

    // BRAND: if parser found no brand but context has one
    if (!enhanced.brand && ctx.brand) {
      enhanced.brand = ctx.brand;
      enhanced.brandSource = 'context';  // mark as inherited
    }

    // CURRENCY: if parser found USD but context says HKD
    // This is the HKD BUG FIX
    if (ctx.currency && ctx.currency !== 'USD' && ctx.confidence.currency >= 80) {
      if (enhanced.currency === 'USD' || !enhanced.currency) {
        // Re-evaluate the price with the correct currency
        if (enhanced.price && enhanced.price > 0) {
          // If the original parse treated a HKD price as USD, convert it
          const correctedPrice = convertCurrency(enhanced.price, ctx.currency, 'USD');
          if (correctedPrice && correctedPrice !== enhanced.price) {
            enhanced.originalPrice = enhanced.price;
            enhanced.originalCurrency = ctx.currency;
            enhanced.price = correctedPrice;
            enhanced.currency = 'USD';
            enhanced.priceCorrected = true;
          }
        }
        enhanced.currency = 'USD';
        enhanced.detectedCurrency = ctx.currency;
      }
    }

    // CONDITION: if parser found no condition but context has one
    if (!enhanced.condition && ctx.condition) {
      enhanced.condition = ctx.condition;
      enhanced.conditionSource = 'context';
    }

    // MODEL: if parser found no model but context cache has one
    if (!enhanced.model && enhanced.ref) {
      const cached = tracker.lookupModel(enhanced.ref);
      if (cached && cached.model) {
        enhanced.model = cached.model;
        enhanced.modelSource = 'context_cache';
      }
    }

    // Add context metadata
    enhanced.contextLine = ctx.lineNumber;
    enhanced.contextCurrency = ctx.currency;

    results.push(enhanced);
  }

  return results;
}

/**
 * Convert a price from one currency to another using static rates.
 * Falls back to parser.js RATES table.
 */
const RATES = {
  USD: 1.0, USDT: 1.0,
  HKD: 0.128, EUR: 1.08, GBP: 1.27,
  CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function convertCurrency(amount, from, to) {
  const fromRate = RATES[from] || 1;
  const toRate = RATES[to] || 1;
  if (to === 'USD') return Math.round(amount * fromRate);
  return Math.round(amount * fromRate / toRate);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════.parse═════════════

module.exports = {
  ContextTracker,
  segmentMessage,
  parseMessageWithContext,
  convertCurrency,
  RATES,
  MODEL_LOOKUP,
  // For testing
  BRAND_HEADERS,
  CURRENCY_SIGNALS,
  CONDITION_HEADERS,
  REF_MODEL_PATTERNS,
};
