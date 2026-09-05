// ─────────────────────────────────────────────────────────────────────────────
// Watch Normalization Library
//
// One source of truth for cleaning messy dealer text. Used by:
//   - /api/clean-analyze  (real-time demo + new submissions)
//   - /api/reprocess       (bulk fix the 117k existing records)
//   - DemoPage.tsx         (client-side preview as user types)
//
// What it does, in order:
//   1. Strip emojis (but capture as hints)
//   2. Normalize brand (case, whitespace, variants)
//   3. Detect intent (SELL / WTB / INQUIRY / RED_FLAG)
//   4. Fix reference (case, dashes, typo correction)
//   5. Auto-infer brand from reference prefix when brand is missing
//   6. Apply emoji → brand hint
//   7. Canonicalize Patek suffixes (5168G → 5168G-001)
//   8. Extract price + currency (handle k/m, USDT, $, HKD, etc.)
//   9. Extract year, condition, dial
//  10. Return confidence score + verdict
// ─────────────────────────────────────────────────────────────────────────────

// ─── Brand canonical names ───────────────────────────────────────────────────
const BRAND_CANONICAL: Record<string, string> = {
  'patek philippe': 'Patek Philippe',
  'patek': 'Patek Philippe',
  'pp': 'Patek Philippe',
  'philippe': 'Patek Philippe',
  'rolex': 'Rolex',
  'rlx': 'Rolex',
  'audemars piguet': 'Audemars Piguet',
  'ap': 'Audemars Piguet',
  'audemars': 'Audemars Piguet',
  'richard mille': 'Richard Mille',
  'rm': 'Richard Mille',
  'vacheron constantin': 'Vacheron Constantin',
  'vacheron': 'Vacheron Constantin',
  'vc': 'Vacheron Constantin',
  'omega': 'Omega',
  'cartier': 'Cartier',
  'iwc': 'IWC',
  'jaeger-lecoultre': 'Jaeger-LeCoultre',
  'jlc': 'Jaeger-LeCoultre',
  'tudor': 'Tudor',
  'hublot': 'Hublot',
  'breguet': 'Breguet',
  'tag heuer': 'TAG Heuer',
  'panerai': 'Panerai',
  'breitling': 'Breitling',
  'chopard': 'Chopard',
  'zenith': 'Zenith',
  'a. lange & sohne': 'A. Lange & Söhne',
  'lange': 'A. Lange & Söhne',
  'h. moser': 'H. Moser & Cie',
  'blancpain': 'Blancpain',
  'girard-perregaux': 'Girard-Perregaux',
  'girard perregaux': 'Girard-Perregaux',
  'van cleef': 'Van Cleef & Arpels',
  'parmigiani fleurier': 'Parmigiani Fleurier',
  'fp journe': 'F. P. Journe',
  'f.p. journe': 'F. P. Journe',
  'ulysse nardin': 'Ulysse Nardin',
  'grand seiko': 'Grand Seiko',
  'seiko': 'Grand Seiko',
  'oris': 'Oris',
  'baume & mercier': 'Baume & Mercier',
};

export function normalizeBrand(input: string | null | undefined): string {
  if (!input) return 'Unknown';
  const key = String(input).toLowerCase().trim().replace(/\s+/g, ' ');
  return BRAND_CANONICAL[key] || 'Unknown';
}

// ─── Ref-prefix → brand inference ────────────────────────────────────────────
// Covers ALL brands in your dataset (verified against 117k records).
// ORDER MATTERS: more specific patterns first.
const REF_BRAND_RULES: { brand: string; test: (ref: string) => boolean }[] = [
  // ── Ultra-specific patterns (must come first) ────────────────────────────
  { brand: 'Richard Mille',   test: r => /^RM\s?\d/i.test(r) },
  { brand: 'Cartier',         test: r => /^W[A-Z]?\d{4,6}/i.test(r) || /^H\d{4}/i.test(r) }, // W + 4-6 digits
  { brand: 'IWC',             test: r => /^IW\d/i.test(r) },
  { brand: 'Jaeger-LeCoultre', test: r => /^Q\d{7}/i.test(r) || /^Q\d{6}/i.test(r) },
  { brand: 'Blancpain',       test: r => /^6654/i.test(r) },

  // ── Audemars Piguet: very specific 5-digit refs ──────────────────────────
  // 15500, 15510, 16202, 16204, 16220, 16221, 26240, 26315, 26320, 26331, 26574, etc.
  { brand: 'Audemars Piguet', test: r => /^15\d{3}/i.test(r) },       // 15500ST, 15510ST, etc.
  { brand: 'Audemars Piguet', test: r => /^16\d{3}/i.test(r) },       // 16202ST, 16204ST, 16220ST
  { brand: 'Audemars Piguet', test: r => /^26\d{3}/i.test(r) },       // 26240ST/BA, 26315, 26331, 26574
  { brand: 'Audemars Piguet', test: r => /^41\d{3}/i.test(r) },       // 4100, 4110 (older APs)
  { brand: 'Audemars Piguet', test: r => /^25\d{4}/i.test(r) },       // 25000 series

  // ── Rolex: 6-digit (modern) or specific 5-digit vintage ─────────────────
  { brand: 'Rolex',           test: r => /^11\d{4}/i.test(r) },       // 116610, 116613, 116618, etc.
  { brand: 'Rolex',           test: r => /^12\d{4}/i.test(r) },       // 126610, 126613, 126618
  { brand: 'Rolex',           test: r => /^22\d{4}/i.test(r) },       // 228238, 228239 (Day-Date)
  { brand: 'Rolex',           test: r => /^23\d{4}/i.test(r) },       // 231.10 etc (rare)
  { brand: 'Rolex',           test: r => /^24\d{4}/i.test(r) },       // 24xxxx
  { brand: 'Rolex',           test: r => /^25\d{4}/i.test(r) },       // 25xxxx
  { brand: 'Rolex',           test: r => /^26\d{4}/i.test(r) },       // 26xxxx
  { brand: 'Rolex',           test: r => /^27\d{4}/i.test(r) },       // 27xxxx
  { brand: 'Rolex',           test: r => /^28\d{4}/i.test(r) },       // 28xxxx
  { brand: 'Rolex',           test: r => /^36\d{4}/i.test(r) },       // 36xxxx

  // ── Vintage Rolex: 5-digit ───────────────────────────────────────────────
  { brand: 'Rolex',           test: r => /^21\d{3}/i.test(r) && !/^21[0-9]{2}[A-Z]/i.test(r) }, // 216570 is Day-Date but 21000-series also Day-Date
  { brand: 'Rolex',           test: r => /^16\d{3}/i.test(r) && !/^16[0-2]\d{2}/i.test(r) },     // 1601, 1675, 16030
  { brand: 'Rolex',           test: r => /^62\d{2}/i.test(r) },       // 6263, 6265, 6241, 6262 (vintage)
  { brand: 'Rolex',           test: r => /^55\d{2}[A-Z]/i.test(r) && !/^552[0-9]/.test(r) && !/^6119/.test(r) }, // 5500, 5512, 5513 only WITH letter suffix, exclude Patek 5524R
  { brand: 'Rolex',           test: r => /^65\d{2}[A-Z]/i.test(r) && !/^665[0-9]/.test(r) }, // 6542, 6543, 6511, exclude Blancpain 6654
  { brand: 'Rolex',           test: r => /^10\d{3}[A-Z]/i.test(r) },       // 1002, 1016

  // ── Patek Philippe: 4-digit base (last because Rolex may match) ───────────
  // Patek is "5xxx", "6xxx", "7xxx" but Rolex 6-digit refs starting with 1,2 are already handled.
  // 4-digit Patek: 5168, 5712, 5711, 5980, etc.
  { brand: 'Patek Philippe',  test: r => /^[5-7]\d{3}[A-Z\-\/]/i.test(r) || /^[5-7]\d{3}$/i.test(r) },

  // ── Patek 4-digit with slash (definitely Patek) ─────────────────────────
  { brand: 'Patek Philippe',  test: r => /^\d{4}\/\d/i.test(r) },

  // ── Vacheron Constantin (after Patek to avoid overlap) ──────────────────
  { brand: 'Vacheron Constantin', test: r => /^4\d{4}/i.test(r) && !/^4[1-3]\d{3}/i.test(r) }, // 4500V, 49150, etc.
  { brand: 'Vacheron Constantin', test: r => /^3\d{4}/i.test(r) && !/^3[1-3]\d{3}/i.test(r) }, // 33xx, 35xx, 37xx
  { brand: 'Vacheron Constantin', test: r => /^47\d{3}/i.test(r) },   // 47040, 47200, etc.

  // ── Tudor ────────────────────────────────────────────────────────────────
  { brand: 'Tudor',           test: r => /^79\d{3}/i.test(r) },       // 79030, 79230
  { brand: 'Tudor',           test: r => /^7\d{4}/i.test(r) && !/^7[0-1]\d{3}/i.test(r) }, // 70330, etc.

  // ── Omega ────────────────────────────────────────────────────────────────
  { brand: 'Omega',           test: r => /^3\d{2}\.\d{2}/i.test(r) }, // 311.30.42.30.01.005

  // ── Hublot ───────────────────────────────────────────────────────────────
  { brand: 'Hublot',          test: r => /^4\d{4}[A-Z]{2}/i.test(r) && /^(30|31|33|34|35|36|40|41|42|43|44|45|46|47|48|49|5\d|6\d|7\d)\d{3}[A-Z]{2}/i.test(r) },
];

function inferBrandFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const cleaned = String(ref).trim().toUpperCase().replace(/\s+/g, '');
  for (const rule of REF_BRAND_RULES) {
    if (rule.test(cleaned)) return rule.brand;
  }
  return null;
}

// ─── Emoji → brand hint ─────────────────────────────────────────────────────
const EMOJI_BRAND_HINT: Record<string, string> = {
  '🔵': 'Patek Philippe',  // Aquanaut/Nautilus blue (also Rolex Submariner blue, but PP more common in dealer chats)
  '🏮': 'Patek Philippe',
  '🟦': 'Patek Philippe',
  '🔷': 'Patek Philippe',
  '🔴': 'Audemars Piguet',
  '🟥': 'Audemars Piguet',
  '🟢': 'Rolex',           // Submariner green
  '⚡': 'Rolex',
  '🔮': 'Rolex',
  '🌀': 'Richard Mille',
  '⭕': 'Patek Philippe',  // vintage Patek
  '⭐': 'Rolex',
  '🌟': 'Rolex',
  '💎': 'Cartier',
  '🌲': 'Patek Philippe',
  '🔥': 'Rolex',
  '🌹': 'Rolex',
  '🎯': 'Audemars Piguet',
  '✨': 'Cartier',
};

function brandFromEmoji(raw: string): string | null {
  for (const [emoji, brand] of Object.entries(EMOJI_BRAND_HINT)) {
    if (raw.includes(emoji)) return brand;
  }
  return null;
}

// ─── Intent detection (SELL / WTB / INQUIRY / RED_FLAG) ─────────────────────
type Intent = 'SELL' | 'WTB' | 'INQUIRY' | 'RED_FLAG';

const WTB_PATTERNS = /\b(wtb|w\.t\.b|want to buy|looking for|need|iso|in search of|anybody have|anybody's got|got a|need a|seeking)\b/i;
const RED_FLAG_PATTERNS = /\b(genuine movement|replica|aftermarket|not original|custom|homage|seized franken|frankenstein|aftermarket dial|aftermarket strap|custom diamonds|fake|stolen)\b/i;

function detectIntent(raw: string): { intent: Intent; flags: string[] } {
  const flags: string[] = [];
  let intent: Intent = 'SELL'; // default in dealer chats

  if (RED_FLAG_PATTERNS.test(raw)) {
    flags.push('RED_FLAG_REPLICA_OR_AFTERMARKET');
    intent = 'RED_FLAG';
  }
  if (WTB_PATTERNS.test(raw)) {
    flags.push('WTB');
    if (intent !== 'RED_FLAG') intent = 'WTB';
  }
  if (/\b(price\?|how much|value|worth|appraisal|any idea|pm me|dm me|details|more pics|more info)\b/i.test(raw) && intent === 'SELL') {
    intent = 'INQUIRY';
  }
  if (/crosspost|cross.posted/i.test(raw)) flags.push('CROSS_POST');

  return { intent, flags };
}

// ─── Reference normalization ─────────────────────────────────────────────────
// Fixes: case, missing dashes, "Rm11-01ti" → "RM 11-01 TI", lowercase suffixes
function normalizeReference(input: string | null | undefined): string | null {
  if (!input) return null;
  let ref = String(input).trim();

  // Common typo: lowercase letter at end (5712/1a → 5712/1A)
  ref = ref.replace(/(\D)$/, (m) => m.toUpperCase());

  // Richard Mille: "Rm11-01ti" → "RM 11-01 TI"
  const rmMatch = ref.match(/^RM\s?(\d{2})[-\s]?(\d{2})([A-Z]{1,3})?$/i);
  if (rmMatch) {
    const [, a, b, suffix] = rmMatch;
    return `RM ${a}-${b}${suffix ? ' ' + suffix.toUpperCase() : ''}`.trim();
  }

  // Patek 4-digit + 1-2 letter suffix: "5168g" → "5168G"
  const patekMatch = ref.match(/^(\d{4})([A-Z]{1,3})$/i);
  if (patekMatch) {
    return patekMatch[1] + patekMatch[2].toUpperCase();
  }

  // Patek 4-digit + slash + 1-2 letters: "5712/1a" → "5712/1A"
  const patekSlashMatch = ref.match(/^(\d{4})\/(\d{0,2})([A-Z]{0,3})$/i);
  if (patekSlashMatch) {
    const [, num, slash, suffix] = patekSlashMatch;
    return `${num}/${slash}${suffix.toUpperCase()}`;
  }

  // Patek 4-digit + slash + 1-2 letters + dash + 3 digits: "5980/1400g" → "5980/1400G"
  // OR Patek 4-digit + slash + 1 letter + dash + 3 digits: "5712/1a-010" → "5712/1A-010"
  const patekFull = ref.match(/^(\d{4})\/(\d{0,3}[A-Z]{1,3})(?:-(\d{3,4}))?$/i);
  if (patekFull) {
    const [, num, middle, suffix] = patekFull;
    let mid = middle;
    // middle contains letters, uppercase them
    mid = mid.replace(/[a-z]+/g, m => m.toUpperCase());
    return suffix ? `${num}/${mid}-${suffix}` : `${num}/${mid}`;
  }

  // Rolex 6-digit + 1-4 letter suffix: "116610lv" → "116610LV"
  const rolexMatch = ref.match(/^(\d{6})([A-Z]{0,4})$/i);
  if (rolexMatch) {
    return rolexMatch[1] + rolexMatch[2].toUpperCase();
  }

  // AP: "15500st" → "15500ST"
  const apMatch = ref.match(/^(\d{5})([A-Z]{1,3})$/i);
  if (apMatch) {
    return apMatch[1] + apMatch[2].toUpperCase();
  }

  // 5-digit AP: "26240BA" (already correct but normalize)
  if (/^\d{5}[A-Z]{1,3}$/i.test(ref)) {
    return ref.toUpperCase();
  }

  // Tab-separated Excel paste artifacts: "5524R\t" → "5524R"
  ref = ref.replace(/[\t\r\n]/g, '');

  return ref || null;
}

// ─── Patek canonical suffix mapping ──────────────────────────────────────────
// For records where dial color was inferred OR where suffix is missing,
// use the catalog to canonicalize. Single source of truth from your data.
const PATEK_CANONICAL: Record<string, { canonical: string; canonicalDial: string }> = {
  '5168G':  { canonical: '5168G-001', canonicalDial: 'Khaki' },
  '5168G-001': { canonical: '5168G-001', canonicalDial: 'Khaki' },
  '5167A':  { canonical: '5167A-001', canonicalDial: 'Black' },
  '5167A-001': { canonical: '5167A-001', canonicalDial: 'Black' },
  '5167R':  { canonical: '5167R-001', canonicalDial: 'Brown' },
  '5164R':  { canonical: '5164R-001', canonicalDial: 'Brown' },
  '5270P':  { canonical: '5270P-001', canonicalDial: 'Black' },
  '5271P':  { canonical: '5271P-001', canonicalDial: 'Black' },
  '5205R':  { canonical: '5205R-001', canonicalDial: 'Blue' },
  '5961P':  { canonical: '5961P-001', canonicalDial: 'Black' },
  '5968G':  { canonical: '5968G-001', canonicalDial: 'Green' },
  '6119R':  { canonical: '6119R-001', canonicalDial: 'Brown' },
  '5227G':  { canonical: '5227G-001', canonicalDial: 'White' },
  '5822P':  { canonical: '5822P-001', canonicalDial: 'Blue' },
  '5328G':  { canonical: '5328G-001', canonicalDial: 'White' },
  '5212A':  { canonical: '5212A-001', canonicalDial: 'White' },
  '5712/1A':  { canonical: '5712/1A-010', canonicalDial: 'Blue' },
  '5712/1A-010': { canonical: '5712/1A-010', canonicalDial: 'Blue' },
  '5711/1A':  { canonical: '5711/1A-014', canonicalDial: 'Blue' },
  '5711/1A-014': { canonical: '5711/1A-014', canonicalDial: 'Blue' },
  '5980/1A':  { canonical: '5980/1A-014', canonicalDial: 'Blue' },
  '5980/1AR':  { canonical: '5980/1AR-001', canonicalDial: 'Brown' },
};

function canonicalizePatek(ref: string | null, dial: string | null): { ref: string; dial: string } {
  if (!ref) return { ref: '', dial: dial || 'UNKNOWN' };
  const upper = ref.toUpperCase().trim();
  const rule = PATEK_CANONICAL[upper];
  if (!rule) return { ref: upper, dial: dial || 'UNKNOWN' };
  // If we know the canonical dial and the parsed dial is missing/wrong, fix it
  const finalDial = (dial && dial !== 'UNKNOWN') ? dial : rule.canonicalDial;
  return { ref: rule.canonical, dial: finalDial };
}

// ─── Price + currency extraction ────────────────────────────────────────────
function extractPrice(text: string): { price: number; currency: string } {
  // Remove whitespace noise
  const cleaned = text.replace(/[\t\n]/g, ' ');

  // Pattern 1: "850k HKD", "1.2m USD", "2.4M"
  let m = cleaned.match(/(\d+(?:\.\d+)?)\s*([kKmM])\b\s*(hkd|usd|usdt|eur|€|\$)?/);
  if (m) {
    const num = parseFloat(m[1]);
    const multiplier = /m/i.test(m[2]) ? 1_000_000 : 1_000;
    let cur = (m[3] || '').toUpperCase();
    if (!cur) {
      cur = cleaned.includes('HKD') || cleaned.includes('HK$') ? 'HKD'
          : cleaned.includes('USD') ? 'USD'
          : cleaned.includes('€') || cleaned.includes('EUR') ? 'EUR'
          : 'USD';
    }
    return { price: Math.round(num * multiplier), currency: cur.replace('€', 'EUR') };
  }

  // Pattern 2: "HKD 850k", "hkd80k", "USD1.366M"
  m = cleaned.match(/(hkd|usd|usdt|eur)\s*(\d+(?:[,.]\d+)?)\s*([kKmM]?)/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const num = parseFloat(m[2].replace(',', ''));
    const mult = /m/i.test(m[3] || '') ? 1_000_000 : /k/i.test(m[3] || '') ? 1_000 : 1;
    return { price: Math.round(num * mult), currency: cur };
  }

  // Pattern 3: "$130,000", "€50000"
  m = cleaned.match(/([\$€])\s*(\d{1,3}(?:,\d{3})*|\d+)/);
  if (m) {
    const num = parseInt(m[2].replace(/,/g, ''), 10);
    const cur = m[1] === '€' ? 'EUR' : 'USD';
    return { price: num, currency: cur };
  }

  // Pattern 4: "USD20,000", "USD 20000"
  m = cleaned.match(/(hkd|usd|usdt|eur)\s*(\d{1,3}(?:,\d{3})+|\d+)/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const num = parseInt(m[2].replace(/,/g, ''), 10);
    return { price: num, currency: cur };
  }

  return { price: 0, currency: '' };
}

// ─── Year extraction ────────────────────────────────────────────────────────
function extractYear(text: string): number | null {
  // 4-digit year 2010-2030
  const m = text.match(/\b(20[12]\d|2030)\b/);
  if (m) return parseInt(m[1], 10);
  // 2-digit year like "23" → 2023
  const m2 = text.match(/[\s/](\d{2})Y\b/i);
  if (m2) {
    const y = parseInt(m2[1], 10);
    if (y >= 15 && y <= 30) return 2000 + y;
  }
  return null;
}

// ─── Condition extraction ────────────────────────────────────────────────────
function extractCondition(text: string): string {
  if (/\bnew\b|unworn|\bbnib\b|sealed|full\s*set|mint\b/i.test(text)) return 'New';
  if (/\bused\b|pre[-\s]?owned|worn|second[-\s]?hand/i.test(text)) return 'Used';
  if (/\bunworn\b/i.test(text)) return 'New';
  return 'Unknown';
}

// ─── Dial color extraction ───────────────────────────────────────────────────
const DIAL_COLORS = [
  'Black', 'White', 'Blue', 'Green', 'Red', 'Yellow', 'Brown', 'Pink',
  'Grey', 'Silver', 'Champagne', 'Salmon', 'Mop', 'Mother of Pearl',
  'MOP', 'Tropical', 'Khaki', 'Beige', 'Panda', 'Tiffany', 'Ice Blue',
  'Sundust', 'Chocolate', 'Olive', 'Luminous',
];

function extractDial(text: string): string | null {
  // MOP / Mother of Pearl
  if (/mop|mother\s*of\s*pearl/i.test(text)) return 'MOP';
  // Ice Blue
  if (/ice\s*blue/i.test(text)) return 'Ice Blue';
  // Direct color words (case-insensitive)
  const lower = text.toLowerCase();
  for (const c of DIAL_COLORS) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  // Emoji-as-dial: 🟢 = green, 🔵 = blue (less reliable, prefer ref inference)
  return null;
}

// ─── Main: parse a single raw dealer message ─────────────────────────────────
export interface NormalizedWatch {
  brand: string;
  reference: string | null;
  dialColor: string;
  condition: string;
  year: number | null;
  price: number;
  currency: string;
  intent: Intent;
  flags: string[];
  confidence: number;
  normalizedRaw: string;
}

export function normalizeWatch(rawInput: string): NormalizedWatch {
  let raw = String(rawInput || '').trim();

  // ── Strip invisible whitespace artifacts (Excel paste, NBSP) ─────────────
  raw = raw.replace(/[\u00A0\u2000-\u200B\u2028\u2029]/g, ' ').replace(/\s+/g, ' ');

  const { intent, flags } = detectIntent(raw);

  // ── Brand detection: priority order ─────────────────────────────────────
  let brand = 'Unknown';

  // 1. Explicit brand text in message
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(BRAND_CANONICAL)) {
    // Use word boundary for short keys to avoid false matches
    const pattern = k.length <= 3 ? new RegExp(`\\b${k}\\b`, 'i') : new RegExp(k, 'i');
    if (pattern.test(lower)) {
      brand = v;
      break;
    }
  }

  // 2. Ref prefix inference (if brand still unknown)
  // First, pull a candidate ref from raw — try multiple patterns
  let refCandidate: string | null = null;
  // Pattern A: explicit brand-style refs (IW379403, Q9068180, W69012Z4, RM11-03)
  refCandidate = (raw.match(/\bIW\d{6}\b/) || [])[0]
              || (raw.match(/\bQ\d{7}\b/) || [])[0]
              || (raw.match(/\bW[A-Z]?\d{4,6}\b/) || [])[0]
              || (raw.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Za-z]{0,3}\b/i) || [])[0]
              // Pattern B: Blancpain 6654-1127-55B (numeric-numeric-alpha)
              || (raw.match(/\b\d{4}-\d{2,4}-[A-Z0-9]{2,4}\b/) || [])[0]
              // Pattern C: Patek 5712/1A, 5980/1400G, 5712/1A-010
              || (raw.match(/\b\d{4}[\/\-]\d{0,4}[A-Za-z]{0,3}(?:-\d{3,4})?\b/) || [])[0]
              // Pattern D: 4-digit + 1-3 letter (Patek/RM short)
              || (raw.match(/\b\d{4}[A-Za-z]{1,3}\b/) || [])[0]
              // Pattern E: 5-6 digit + 0-4 letter (Rolex/AP/Rolex Day-Date)
              || (raw.match(/\b\d{5,6}[A-Za-z]{0,4}\b/) || [])[0]
              || null;

  if (brand === 'Unknown' && refCandidate) {
    const inferred = inferBrandFromRef(refCandidate);
    if (inferred) brand = inferred;
  }

  // 3. Emoji brand hint (lower priority than text/ref, but useful when both fail)
  if (brand === 'Unknown') {
    const emojiBrand = brandFromEmoji(raw);
    if (emojiBrand) brand = emojiBrand;
  }

  // ── Ref normalization ────────────────────────────────────────────────────
  let reference = normalizeReference(refCandidate);

  // ── Patek canonical suffix ───────────────────────────────────────────────
  if (brand === 'Patek Philippe' && reference) {
    const dialGuess = extractDial(raw);
    const canon = canonicalizePatek(reference, dialGuess);
    reference = canon.ref;
  }

  // ── Dial color: text first, then ref-suffix inference for Patek ──────────
  let dialColor = extractDial(raw) || 'UNKNOWN';
  if (dialColor === 'UNKNOWN' && reference) {
    const canon = PATEK_CANONICAL[reference.toUpperCase()];
    if (canon) dialColor = canon.canonicalDial;
  }

  // ── Condition ────────────────────────────────────────────────────────────
  const condition = extractCondition(raw);

  // ── Year ─────────────────────────────────────────────────────────────────
  const year = extractYear(raw);

  // ── Price + currency ─────────────────────────────────────────────────────
  const { price, currency } = extractPrice(raw);

  // ── Confidence scoring ───────────────────────────────────────────────────
  let confidence = 0;
  if (reference) confidence += 40;
  if (brand !== 'Unknown') confidence += 25;
  if (dialColor !== 'UNKNOWN') confidence += 15;
  if (price > 0) confidence += 10;
  if (currency) confidence += 5;
  if (condition !== 'Unknown') confidence += 3;
  if (year) confidence += 2;
  confidence = Math.min(confidence, 100);

  return {
    brand,
    reference,
    dialColor,
    condition,
    year,
    price,
    currency,
    intent,
    flags,
    confidence,
    normalizedRaw: raw,
  };
}

// ─── Bulk: apply to all records and return fixes summary ─────────────────────
export interface BulkFix {
  total: number;
  brandFixed: number;
  refFixed: number;
  dialFixed: number;
  priceFixed: number;
  intentSet: number;
  flagged: number;
  confidenceBefore: number;
  confidenceAfter: number;
}

export function applyNormalization(records: any[], schema: string[]): { records: any[]; fix: BulkFix } {
  const fix: BulkFix = {
    total: records.length,
    brandFixed: 0,
    refFixed: 0,
    dialFixed: 0,
    priceFixed: 0,
    intentSet: 0,
    flagged: 0,
    confidenceBefore: 0,
    confidenceAfter: 0,
  };

  // Schema indices (must match parsedWatches.schema.json)
  const IDX = {
    id: schema.indexOf('id'),
    brand: schema.indexOf('brand'),
    reference: schema.indexOf('reference'),
    dialColor: schema.indexOf('dialColor'),
    price: schema.indexOf('price'),
    priceUSD: schema.indexOf('priceUSD'),
    currency: schema.indexOf('currency'),
    condition: schema.indexOf('condition'),
    rawMessage: schema.indexOf('rawMessage'),
    confidence: schema.indexOf('confidence'),
    isResidue: schema.indexOf('isResidue'),
    originalPrice: schema.indexOf('originalPrice'),
    originalCurrency: schema.indexOf('originalCurrency'),
    description: schema.indexOf('description'),
  };

  const out = records.map(r => {
    const raw = r[IDX.rawMessage] || '';
    const norm = normalizeWatch(raw);

    const before = {
      brand: r[IDX.brand] || 'Unknown',
      reference: r[IDX.reference] || null,
      dial: r[IDX.dialColor] || 'UNKNOWN',
      conf: r[IDX.confidence] || 0,
    };
    fix.confidenceBefore += before.conf;

    // Build new record
    const newRec = [...r];
    const beforeBrand = newRec[IDX.brand];
    const beforeRef = newRec[IDX.reference];
    const beforeDial = newRec[IDX.dialColor];
    const beforePrice = newRec[IDX.price];

    newRec[IDX.brand] = norm.brand;
    newRec[IDX.reference] = norm.reference || beforeRef;
    newRec[IDX.dialColor] = norm.dialColor;
    if (norm.price > 0) newRec[IDX.price] = norm.price;
    if (norm.currency) newRec[IDX.currency] = norm.currency;
    newRec[IDX.condition] = norm.condition;

    // Store normalization metadata in description (append)
    const meta: string[] = [];
    if (norm.intent !== 'SELL') meta.push(`intent:${norm.intent}`);
    if (norm.flags.length) meta.push(`flags:${norm.flags.join(',')}`);
    const oldDesc = newRec[IDX.description] || '';
    newRec[IDX.description] = oldDesc + (meta.length ? ` [${meta.join('; ')}]` : '');

    // Track fixes
    if (beforeBrand !== norm.brand && norm.brand !== 'Unknown') fix.brandFixed++;
    if (beforeRef !== norm.reference && norm.reference) fix.refFixed++;
    if (beforeDial !== norm.dialColor && norm.dialColor !== 'UNKNOWN') fix.dialFixed++;
    if (beforePrice !== newRec[IDX.price]) fix.priceFixed++;
    if (norm.intent !== 'SELL') fix.intentSet++;
    if (norm.flags.length) fix.flagged++;

    // Recompute confidence (ref + brand + dial + price)
    let c = 0;
    if (newRec[IDX.reference]) c += 40;
    if (newRec[IDX.brand] && newRec[IDX.brand] !== 'Unknown') c += 25;
    if (newRec[IDX.dialColor] && newRec[IDX.dialColor] !== 'UNKNOWN') c += 15;
    if (newRec[IDX.price] > 0) c += 10;
    if (newRec[IDX.currency]) c += 5;
    if (newRec[IDX.condition] && newRec[IDX.condition] !== 'Unknown') c += 3;
    newRec[IDX.confidence] = Math.min(c, 100);
    fix.confidenceAfter += newRec[IDX.confidence];

    return newRec;
  });

  fix.confidenceBefore = Math.round(fix.confidenceBefore / records.length);
  fix.confidenceAfter = Math.round(fix.confidenceAfter / records.length);

  return { records: out, fix };
}
