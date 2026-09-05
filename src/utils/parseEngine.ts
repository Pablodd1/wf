/**
 * Client-side luxury watch parser engine
 * Regex-first → confidence score → ≥90% auto-approved, <90% AI fallback
 */

// Whitespace-normalized reference resolution map (loaded from disambiguation_map.json)
// Maps "126331G" (no space) → "126331 G" (with space) — both should resolve to same
// Also covers "7118/1" prefix → "7118/1200A" most-common full ref
let _disambiguationCache: { normalized: Set<string>; canonical: Set<string> } | null = null;
function getDisambiguationSets() {
  if (_disambiguationCache) return _disambiguationCache;
  // Build small inline maps from common patterns (to avoid bundling 500-entry JSON in client)
  const normalized = new Set<string>([
    // Common Rolex datejust refs with space-separated dial colors
    '126331G', '126331NG', '126331VI', '126331PINK', '126331BLUE', '126331BLACK',
    '126333G', '126333NG', '126333VI', '126333PINK', '126333BLUE', '126333GRAY',
    '126334G', '126334NG', '126334VI', '126334PINK', '126334BLUE', '126334GREY', '126334GREY',
    '126300NEW', '126300BLUE', '126300GREY', '126300WIM', '126300BLK',
    '126500LN', '126500BLK', '126500NEW', '126500PAUL',
    '126503G', '126503NG', '126503GOLD', '126503BLK',
    '126505G', '126505BLK', '126505NEW', '126505PINK', '126505CHO',
    '126508G', '126508PN', '126508YML', '126508PAUL',
    '126515G', '126515LN', '126515BLK', '126515NEW',
    '126518G', '126518PN', '126518YML', '126518METE',
    '126519G', '126519LN', '126519BLK', '126519PINK', '126519METE',
    '116518NG', '116518METE', '116508PAUL', '116503GOLD', '116505PINK', '116505A',
    '116509METE', '116509G', '116509BLUE', '116509BLK',
    '126234VI', '126234G', '126234VIIX', '126234GREY',
    '128236ICE', '128238A', '128345A', '128348RBR', '128349RBR',
    '228235A', '228236ICE', '228235GREY', '228206ICE',
    '126600SEA', '126610LN', '126610LV', '126710BLRO', '126710BLNR', '126710GRNR',
    // Patek refs with slash + letter
    '7118/1200A', '7118/1200R', '7118/1300R', '7118/1300G', '5267/200A', '5267/200A-011',
    '7121/200G', '7121/200G-001',
  ]);
  const canonical = new Set<string>([
    '126610LV', '126710BLRO', '126710BLNR', '126710GRNR', '116610LN', '116610LV',
    '5712/1A', '5711/1A', '5270P', '5167A', '5935A',
  ]);
  _disambiguationCache = { normalized, canonical };
  return _disambiguationCache;
}

export interface ParsedWatch {
  rawMessage: string;
  brand: string;
  reference: string;
  model: string;
  dialColor: string;
  price: number;
  currency: string;
  usdEquivalent?: number;
  condition: string;
  year: number | null;
  confidence: number;
  flags: string[];
  intent: 'SELL' | 'BUY' | 'INQUIRY';
  _aiChangedRef?: boolean;
  _parserRef?: string | null;
}

// ── Brand catalog ──

// Emoji-based brand markers used by dealers in WhatsApp/Telegram
// (e.g., 🔵 = Patek Philippe, 🟢 = Rolex, 🔴 = Audemars Piguet)
const EMOJI_BRAND_MAP: Record<string, string> = {
  '🔵': 'Patek Philippe',        // blue circle
  '🏮': 'Patek Philippe',        // red lantern (often Patek)
  '🟢': 'Rolex',                 // green circle
  '⚫': 'Rolex',                 // black circle (Submariner)
  '🔴': 'Audemars Piguet',       // red circle
  '🟠': 'Audemars Piguet',       // orange circle
  '🟡': 'Richard Mille',         // yellow circle
  '⚪': 'Vacheron Constantin',   // white circle
  '🔶': 'Vacheron Constantin',   // orange diamond
  '🟣': 'Omega',                 // purple circle
  '🟤': 'IWC',                   // brown circle
  '⚪️': 'Patek Philippe',        // white circle (some dealers use for PP)
  '⭕': 'Patek Philippe',        // hollow circle (Patek Nautilus)
};

const BRAND_PATTERNS: [RegExp, string][] = [
  [/\b(?:patek\s*philippe|patek|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars\s*piguet|audemars|ap)\b/i, 'Audemars Piguet'],
  [/\b(?:richard\s*mille|rm)(?=\d)/i, 'Richard Mille'],
  [/\b(?:rolex|rolx?e?x?)\b/i, 'Rolex'],
  [/\b(?:omega)\b/i, 'Omega'],
  [/\b(?:tag\s*heuer|tag)\b/i, 'Tag Heuer'],
  [/\b(?:cartier)\b/i, 'Cartier'],
  [/\b(?:panerai)\b/i, 'Panerai'],
  [/\b(?:jaeger.*lecoultre|jlc)\b/i, 'Jaeger-LeCoultre'],
  [/\b(?:iuc|iwc)\b/i, 'IWC'],
  [/\b(?:hublot)\b/i, 'Hublot'],
  [/\b(?:breitling)\b/i, 'Breitling'],
  [/\b(?:vacheron.*constantin|vc)\b/i, 'Vacheron Constantin'],
  [/\b(?:tudor)\b/i, 'Tudor'],
  [/\b(?:grand.*seiko|gs)\b/i, 'Grand Seiko'],
  [/\\b(?:girard.*perregaux|gp)\\b/i, 'Girard-Perregaux'],
  [/\\b(?:glash[uü]tte|glashutte|glashutte\\s*original)\\b/i, 'Glashütte Original'],
  [/\\b(?:a\\.?\\s*lange|als|lange\\s*&\\s*s[oö]hne|lange\\s*und\\s*s[oö]hne)\\b/i, 'A. Lange & Söhne'],
  [/\\b(?:f\\.?\\s*p\\.?\\s*journe|fpj)\\b/i, 'F.P. Journe'],
  [/\\b(?:chopard)\\b/i, 'Chopard'],
  [/\\b(?:breguet)\\b/i, 'Breguet'],
  [/\\b(?:blancpain)\\b/i, 'Blancpain'],
  [/\\b(?:zenith)\\b/i, 'Zenith'],
  [/\\b(?:h\\.?\\s*moser|moser)\\b/i, 'H. Moser & Cie'],
  [/\\b(?:ulysse\\s*nardin|un)\\b/i, 'Ulysse Nardin'],
  [/\\b(?:montblanc)\\b/i, 'Montblanc'],
  [/\\b(?:piaget)\\b/i, 'Piaget'],
];

const ROLEX_MODELS = [
  'Submariner', 'Daytona', 'Datejust', 'Day-Date', 'GMT-Master II',
  'GMT-Master', 'Explorer II', 'Explorer', 'Yacht-Master II', 'Yacht-Master',
  'Sea-Dweller', 'Deepsea', 'Sky-Dweller', 'Air-King', 'Milgauss',
  'Cellini', 'Oyster Perpetual', 'Cosmograph',
];

// ── Reference patterns (ordered by specificity) ──

function refMatch(text: string): string {
  // RM references: RM followed by 2-4 digits
  let m = text.match(/\bRM[ -]?(\d{2,4}[A-Za-z0-9-]{0,6})\b/);
  if (m) return 'RM' + m[1];

  // Slash format: 5712/1A, 15400ST, 116610LV
  m = text.match(/\b(\d{4,6}\/[A-Za-z0-9-]{1,6})\b/);
  if (m) return m[1];

  // Rolex: 5-6 digit refs with optional letter suffix (116610LV, 126710BLRO, 1655, etc.)
  // \b doesn't work between digits and letters — match the suffix explicitly
  m = text.match(/\b(116\d{3}[A-Z]{0,4}|126\d{3}[A-Z]{0,4}|114\d{3}[A-Z]?|124\d{3}[A-Z]?|226\d{3}[A-Z]{0,4}|228\d{3}[A-Z]{0,4}|279\d{3}[A-Z]{0,4}|176\d{3}|184\d{3}|118\d{3}|155\d{3}[A-Z]{0,4}|177\d{3}|816\d{3}|190\d{3}|268\d{3}|128\d{3})(?![A-Z])/i);
  if (m) return m[1].toUpperCase();

  // Patek refs: 49xx, 50xx, 51xx, 52xx, 53xx, 54xx, 55xx, 56xx, 57xx, 58xx, 59xx, 61xx, 71xx, 72xx with 1-4 letter suffix (case-insensitive)
  m = text.match(/\b(49\d{2}[A-Z]{1,4}|50\d{2}[A-Z]{1,4}|51\d{2}[A-Z]{1,4}|52\d{2}[A-Z]{1,4}|53\d{2}[A-Z]{1,4}|54\d{2}[A-Z]{1,4}|55\d{2}[A-Z]{1,4}|56\d{2}[A-Z]{1,4}|57\d{2}[A-Z]{1,4}|58\d{2}[A-Z]{1,4}|59\d{2}[A-Z]{1,4}|61\d{2}[A-Z]{1,4}|71\d{2}[A-Z]{1,4}|72\d{2}[A-Z]{1,4})\b/i);
  if (m) return m[1].toUpperCase();

  // AP: 15xxx, 16xxx, 26xxx with optional suffix
  m = text.match(/\b(15\d{3}[A-Za-z]{0,4}|16\d{3}[A-Za-z]{0,4}|26\d{3}[A-Za-z]{0,4})\b/);
  if (m) return m[1];

  // Vacheron Constantin: 47xxx, 82xxx, 4300/4500/6000/7900/81180/85180/4010 patterns
  m = text.match(/\b(47\d{3}[A-Z]?|82\d{3}[A-Z]?|43\d{2}[A-Z]?|45\d{2}[A-Z]?|60\d{2}[A-Z]?|79\d{2}[A-Z]?|81180[A-Z]?|85180[A-Z]?|4010[A-Z]?)\b/);
  if (m) return m[1];

  // IWC: IW followed by digits (IW328904, IW3777)
  m = text.match(/\b(IW\d{4,6})\b/i);
  if (m) return m[1].toUpperCase();

  // Generic: 5-6 digit ref + 1-4 letter suffix (catches AP/RM/VC/Panerai/Omega/Hublot/Tudor)
  m = text.match(/\b(\d{5,6}[A-Z]{1,4})\b/);
  if (m) return m[1];

  // 4-digit vintage refs (not years 1900-2029)
  m = text.match(/\b(\d{4})\b/);
  if (m) {
    const n = parseInt(m[1]);
    if (n < 1900 || n > 2029) return m[1];
    // Year-like numbers (1900-2029) are NOT references, skip
    return '';
  }

  // Last fallback: try to find a ref anywhere by stripping whitespace
  // (handles "126331 G" → "126331G", "7118/1" → "7118/1200A", etc.)
  const collapsed = text.replace(/\s+/g, '').toUpperCase();
  const sets = getDisambiguationSets();
  for (const ref of sets.normalized) {
    if (collapsed.includes(ref)) {
      return ref;
    }
  }

  return '';
}

// ── Dial color inference from reference suffix ──

const SUFFIX_DIAL: Record<string, string> = {
  'A': 'Black', 'LB': 'Blue', 'LN': 'Black', 'LV': 'Green', 'CHNR': 'Brown',
  'R': 'Brown', 'G': 'Blue', 'J': 'Champagne', 'P': 'Blue', 'ST': 'Blue',
  'OR': 'Pink', 'TI': 'Grey', 'BC': 'Black', 'BLRO': 'Red Blue',
  'BLNR': 'Blue Black', 'GRNR': 'Green Black', 'RBOW': 'Rainbow',
};

export function inferDialWithVisionFallback(
  dialColor: string | null | undefined,
  reference: string | null | undefined,
  imageUrl?: string | null,
): string {
  if (dialColor && dialColor !== 'UNKNOWN' && dialColor !== 'Unspecified') {
    return dialColor;
  }
  if (reference) {
    const cleanRef = reference.toUpperCase();
    const overrides: Record<string, string> = {
      '116500LN': 'White', '116500': 'White', '126500LN': 'White', '126500': 'White',
      '116518': 'Champagne', '116519': 'Meteorite', '116595RBOW': 'Rainbow',
      '126710BLNR': 'Blue/Black', '126710BLRO': 'Blue/Red',
      '5711/1A': 'Blue', '5712/1A': 'Blue', '5167A': 'Black',
      '5164A': 'Black', '5968A': 'Black', '5968G': 'Green',
      '126334': 'Grey', '126234': 'Grey',
    };
    for (const [key, color] of Object.entries(overrides)) {
      if (cleanRef.includes(key)) return color;
    }
    const suffixes: Record<string, string> = {
      LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown',
      BLNR: 'Blue/Black', BLRO: 'Blue/Red', VTNR: 'Black/Green',
      GRNR: 'Black/Grey', SARU: 'Orange',
    };
    for (const [suf, color] of Object.entries(suffixes)) {
      if (cleanRef.endsWith(suf) || cleanRef.includes('/' + suf)) return color;
    }
  }
  if (imageUrl) {
    return 'Vision Fallback';
  }
  return 'Unspecified';
}

const DIAL_KEYWORDS: [RegExp, string][] = [
  [/\b(?:tiffany|tiffanie|tiff)\s*(?:blue|dial)?\b/i, 'Tiffany'],
  [/\b(?:ice\s*blue|icy\s*blue|light\s*blue|powder\s*blue)\b/i, 'Ice Blue'],
  [/\bmeteorite\b/i, 'Meteorite'],
  [/\bmother\s*(?:of\s*)?pearl\b|mop\b/i, 'Mother of Pearl'],
  [/\bdiamond\s*(?:dial|set|pave)?\b/i, 'Diamond'],
  [/\bskeleton\b/i, 'Skeleton'],
  [/\b(?:blue\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Blue'],
  [/\b(?:black\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Black'],
  [/\b(?:green\s*(?:dial)?)(?!\s*(?:strap|box|card|papers))\b/i, 'Green'],
  [/\b(?:white\s*(?:dial)?)(?!\s*(?:strap|box|card|papers|gold|steel|platinum|rotor))\b/i, 'White'],
  [/\b(?:silver\s*(?:dial)?)\b/i, 'Silver'],
  [/\b(?:grey|gray)\s*(?:dial)?\b/i, 'Grey'],
  [/\b(?:brown|chocolate|zebra)\s*(?:dial)?\b/i, 'Brown'],
  [/\b(?:pink|rose)\s*(?:dial)?\b/i, 'Pink'],
  [/\b(?:purple|violet|plum)\s*(?:dial)?\b/i, 'Purple'],
  [/\byellow\s*(?:dial)?(?!\s*gold)\b/i, 'Yellow'],
  [/\b(?:orange)\s*(?:dial)?\b/i, 'Orange'],
  [/\b(?:champagne|champ)\s*(?:dial)?\b/i, 'Champagne'],
  [/\bred\s*(?:dial)?\b/i, 'Red'],
  // Limited editions / country-named dials (RM, AP, Rolex special)
  // These appear in dealer messages like "RM67-02 Qatar Edition" or "AP Qatar"
  // When the message has a country/edition name AND no standard color, treat the ref as the dial
  [/\b(?:qatar|abu\s*dhabi|spa|monaco|le\s*mans|italy|japan|singapore|dubai|mexico|usa|america|france|germany|swiss|switzerland|la\s*villa|mykonos|cannes|st\s*tropez|monte\s*carlo|new\s*york|sahara|arctic|antarctic|equator|tropic|cocoa)\b/i, 'Edition Dial'],
];

const CONDITION_PATTERNS: [RegExp, string][] = [
  [/\b(?:brand\s*new|bnib|unworn|unused|nib)\b/i, 'New'],
  [/\b(?:like\s*new|mint|excellent|slider|lnib)\b/i, 'Like New'],
  [/\b(?:pre.owned|used|second.hand)\b/i, 'Used'],
  [/\b(?:fair|good|vintage)\b/i, 'Used'],
];

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/\bHKD\b/, 'HKD'], [/\bUSD\b/, 'USD'], [/\bEUR\b/, 'EUR'],
  [/\bUSDT\b/, 'USDT'], [/\bGBP\b/, 'GBP'], [/\bCHF\b/, 'CHF'],
  [/\bSGD\b/, 'SGD'], [/\bJPY\b/, 'JPY'], [/\bCNY\b/, 'CNY'],
  [/\bAED\b/, 'AED'], [/\$/, 'USD'], [/€/, 'EUR'], [/£/, 'GBP'],
  [/¥/, 'JPY'],
];

const PRICE_PATTERNS: RegExp[] = [
  // "1.2M HKD", "250k USD", "1.5M USD", "3.5k EUR"
  /([\d,]+\.?\d*)\s*([MmKk])\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT|JPY|CNY|AED)\b/i,
  // "HKD 850000", "USD 15000"
  /(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\s*([\d,]+\.?\d*)\s*([MmKk])?/i,
  // "$125,000", "$15k"
  /\$\s*([\d,]+\.?\d*)\s*([MmKk])?/,
  // "HK$ 970,000"
  /HK\$\s*([\d,]+\.?\d*)\s*([MmKk])?/i,
  // "¥1,200,000"
  /¥\s*([\d,]+)\s*([MmKk])?/,
  // Bare "850k", "1.2M" with no currency (USD default)
  /([\d,]+\.?\d*)\s*([MmKk])\b/,
  // "850000 HKD", "15000 USD" (no thousands suffix)
  /([\d,]+\.?\d*)\s*(?:HKD|USD|EUR|CHF|GBP|SGD|USDT)\b/i,
];

// ── Fuzzy brand matching (Levenshtein + alias resolution) ──

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

const ALL_CANONICAL_BRANDS = [
  'Patek Philippe', 'Rolex', 'Audemars Piguet', 'Richard Mille',
  'Vacheron Constantin', 'Cartier', 'Omega', 'IWC', 'Hublot', 'Breitling',
  'Tudor', 'Grand Seiko', 'Girard-Perregaux', 'Glashütte Original',
  'A. Lange & Söhne', 'F.P. Journe', 'Chopard', 'Breguet', 'Blancpain',
  'Zenith', 'H. Moser & Cie', 'Ulysse Nardin', 'Montblanc', 'Piaget',
  'Jaeger-LeCoultre', 'Tag Heuer', 'Panerai',
];

const BRAND_ALIAS_MAP: Record<string, string> = {
  'gp': 'Girard-Perregaux', 'vc': 'Vacheron Constantin',
  'pp': 'Patek Philippe', 'ap': 'Audemars Piguet',
  'rm': 'Richard Mille', 'als': 'A. Lange & Söhne',
  'fpj': 'F.P. Journe', 'jlc': 'Jaeger-LeCoultre',
  'gs': 'Grand Seiko', 'go': 'Glashütte Original',
};

function fuzzyMatchBrand(token: string): string | null {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t.length < 2) return null;
  // Check alias map first
  const alias = BRAND_ALIAS_MAP[t];
  if (alias) return alias;
  // Exact or prefix match
  for (const name of ALL_CANONICAL_BRANDS) {
    const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t === n || n.startsWith(t) || t.startsWith(n)) return name;
  }
  // Levenshtein ≤2 for tokens ≥5 chars, ≤1 for shorter
  let best: { name: string; dist: number } | null = null;
  for (const name of ALL_CANONICAL_BRANDS) {
    const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dist = levenshtein(t, n);
    const maxDist = t.length >= 5 ? 2 : 1;
    if (dist <= maxDist && (!best || dist < best.dist)) best = { name, dist };
  }
  return best?.name || null;
}

// ── Parser ──

export function parseWatch(raw: string): ParsedWatch {
  // 1. Brand from emoji (BEFORE emoji strip — emojis get removed below)
  let brand = 'Unknown';
  for (const [emoji, name] of Object.entries(EMOJI_BRAND_MAP)) {
    if (raw.includes(emoji)) { brand = name; break; }
  }

  const clean = raw.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();

  // 2. Brand from text patterns
  if (brand === 'Unknown') {
    for (const [re, name] of BRAND_PATTERNS) {
      if (re.test(clean)) { brand = name; break; }
    }
  }
  // 2b. Fuzzy brand matching: split clean text into tokens, try fuzzy on each
  if (brand === 'Unknown') {
    const tokens = clean.split(/[\s,;|/]+/).filter(t => t.length >= 2);
    for (const token of tokens) {
      const fuzzy = fuzzyMatchBrand(token);
      if (fuzzy) { brand = fuzzy; break; }
    }
  }
  // Brand from reference prefix if brand still unknown
  // REVERSE LOOKUP: cross-reference ref pattern against known brand schemas
  if (brand === 'Unknown') {
    // Patek Philippe: 49xx, 50xx, 51xx, 52xx, 53xx, 54xx, 55xx, 56xx, 57xx, 58xx, 59xx, 61xx, 71xx, 72xx
    if (/\b(49\d{2}|50\d{2}|51\d{2}|52\d{2}|53\d{2}|54\d{2}|55\d{2}|56\d{2}|57\d{2}|58\d{2}|59\d{2}|61\d{2}|71\d{2}|72\d{2})/.test(clean)) brand = 'Patek Philippe';
    // Rolex: ALL 6-digit refs starting with 1x, 2x, 3x, 8x are Rolex
    //  10xxxx (Datejust 36), 11xxxx (Datejust/Submariner/GMT/Daytona),
    //  12xxxx (Datejust 41/Daytona/Submariner), 13xxxx (Datejust 41 special dials),
    //  14xxxx (Datejust), 15xxxx (Cellini/Cosmograph), 16xxxx (Datejust 36),
    //  17xxxx (Day-Date), 18xxxx (Day-Date), 19xxxx (Cosmograph),
    //  21xxxx (Day-Date II), 22xxxx (Sky-Dweller/Day-Date), 26xxxx (Sea-Dweller),
    //  27xxxx (GMT-Master II / Lady-Datejust), 28xxxx (GMT-Master/Day-Date),
    //  31xxxx (Oyster Perpetual), 32xxxx (Oyster Perpetual), 81xxxx (Pearlmaster)
    else if (/\b(10[1-9]\d{3}|11[0-9]\d{3}|12[0-9]\d{3}|13[0-9]\d{3}|14[0-9]\d{3}|15[0-9]\d{3}|16[0-9]\d{3}|17[0-9]\d{3}|18[0-9]\d{3}|19[0-9]\d{3}|21[0-9]\d{3}|22[0-9]\d{3}|26[0-9]\d{3}|27[0-9]\d{3}|28[0-9]\d{3}|31[0-9]\d{3}|32[0-9]\d{3}|81[0-9]\d{3})/.test(clean)) brand = 'Rolex';
    // Rolex 5-digit vintage: 1675, 16700, 14060, 5513, etc.
    else if (/\b(1675\d?|16700|14060|5513|16610|1665\d?|14270|1657\d?)\b/.test(clean)) brand = 'Rolex';
    // Rolex extended: 6-digit+letter (e.g., 126599, 126710, 116610LV)
    else if (/^\d{6}[A-Z]{2,4}$/.test(clean.trim()) || /\b\d{6}[A-Z]{2,4}\b/.test(clean)) brand = 'Rolex';
    // Audemars Piguet: 15xxxx, 16xxxx, 26xxxx (Royal Oak & Offshore) — need \d{4} for 6-digit refs
    else if (/\b(15\d{4}[A-Z]?|16\d{4}[A-Z]?|26\d{4}[A-Z]?|77\d{4}[A-Z]?|15468[A-Z]+|26240[A-Z]+|26320[A-Z]+|26393[A-Z]+|67651[A-Z]+|26579[A-Z]+)\b/.test(clean)) brand = 'Audemars Piguet';
    // Vacheron Constantin: 33xxxx (Overseas), 30xxxx (Traditionnelle), 47xxxx (Malte), 85xxxx (Patrimony), 81180, 85180
    // Need \d{4} for 6-digit refs (336235, 336934, etc.)
    else if (/\b(33\d{4}[A-Z]?|30\d{4}[A-Z]?|47\d{4}[A-Z]?|85\d{4}[A-Z]?|81180[A-Z]?|85180[A-Z]?|40\d{4}[A-Z]?|60\d{4}[A-Z]?|79\d{4}[A-Z]?|200\d{2}|222[A-Z]?)\b/.test(clean)) brand = 'Vacheron Constantin';
    // Richard Mille: RM followed by digits (RM11-03, RM67-02, etc.)
    else if (/RM\d{2,4}/i.test(clean)) brand = 'Richard Mille';
    // IWC: IW followed by digits (IW328904, IW3777, IW379403)
    else if (/\bIW\d{4,6}\b/i.test(clean)) brand = 'IWC';
    // Tudor: 79xxxx (Black Bay), 70xxxx (Pelagos), 77xxxx (Heritage Chronograph)
    else if (/\b(79\d{4}[A-Z]+|70\d{4}[A-Z]+|77\d{4}[A-Z]+|7925\d[A-Z]+|701\d{2}[A-Z]+)\b/.test(clean)) brand = 'Tudor';
    // Cartier: starts with CR, WG, HP, or ends in xxx/xxxx
    else if (/\b(CR\d{3}|WG\d{4}|HP\d{3}|SANTOS|BALLON|TANK|PANTHERE|WE\d{4}|WSSA)\b/i.test(clean)) brand = 'Cartier';
    // Omega: 31xxxx, 32xxxx, 33xxxx (Seamaster/Speedmaster/Seamaster)
    else if (/\b(31[0139]\d{3}|32[013]\d{3}|33[012]\d{3}|SEAMASTER|SPEEDMASTER)\b/i.test(clean)) brand = 'Omega';
    // Hublot: HUB, HH, or 301/302/303/304/305 patterns
    else if (/\b(HUB\d{2}|30[12345]\d{3}|CLASSIC|BIG BANG)\b/i.test(clean)) brand = 'Hublot';
    // Panerai: PAM followed by digits
    else if (/\bPAM\d{3,4}\b/i.test(clean)) brand = 'Panerai';
    // Breitling: starts with AB, A1, A2, A3 or ends in chronomat/navitimer
    else if (/\b(AB\d{4}|A[123]\d{4}|CHRONOMAT|NAVITIMER|AVENGER)\b/i.test(clean)) brand = 'Breitling';
    // Vacheron Constantin: starts with 47xxx, reference format
    else if (/\b(47\d{3}|OVERSEAS|PATRIMONY|TRADITIONNELLE)\b/i.test(clean)) brand = 'Vacheron Constantin';
    // Jaeger-LeCoultre: Q followed by digits, or REVERSO
    else if (/\b(Q\d{5,6}|REVERSO|MASTER\s*.*CONTROL)\b/i.test(clean)) brand = 'Jaeger-LeCoultre';
  }

  // 2. Reference
  const reference = refMatch(clean);

  // 3. Model (Rolex-specific)
  let model = '';
  const cleanLC = clean.toLowerCase();
  for (const mdl of ROLEX_MODELS) {
    if (cleanLC.includes(mdl.toLowerCase())) { model = mdl; break; }
  }

  // 4. Dial color
  let dialColor = '';
  for (const [re, color] of DIAL_KEYWORDS) {
    if (re.test(clean)) { dialColor = color; break; }
  }
  // Infer from reference suffix if no dial found (Rolex-only — Patek/AP/RM
  // suffixes mean case material, not dial color: 5164R = Rose Gold, not Brown)
  if (!dialColor && reference) {
    const upperRef = reference.toUpperCase();
    // Only apply suffix dial inference to Rolex 6-digit refs (e.g. 116610LN, 126710BLNR)
    const isRolexRef = /^\d{6}[A-Z]{2,5}$/.test(upperRef);
    if (isRolexRef) {
      // Try longest suffix match first
      const suffixes = Object.keys(SUFFIX_DIAL).sort((a, b) => b.length - a.length);
      for (const suf of suffixes) {
        if (upperRef.endsWith(suf)) { dialColor = SUFFIX_DIAL[suf]; break; }
      }
    }
  }

  // 5. Condition
  let condition = 'Unknown';
  for (const [re, c] of CONDITION_PATTERNS) {
    if (re.test(clean)) { condition = c; break; }
  }

  // 6. Year
  let year: number | null = null;
  const yearMatch = clean.match(/\b(20[0-2]\d)\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y >= 1950 && y <= 2030) year = y;
  }

  // 7. Currency
  let currency = '';
  for (const [re, cur] of CURRENCY_PATTERNS) {
    if (re.test(clean)) { currency = cur; break; }
  }
  if (!currency) {
    if (/[+]\d{2}/.test(clean)) currency = 'HKD';
    else currency = 'USD';
  }

  // 8. Price
  let price = 0;
  for (const re of PRICE_PATTERNS) {
    const m = clean.match(re);
    if (m) {
      let val = parseFloat(m[1].replace(/,/g, ''));
      const suffix = (m[2] || '').toLowerCase();
      if (suffix === 'm') val *= 1_000_000;
      else if (suffix === 'k') val *= 1_000;
      // Min 100 (watches start ~$1k), max 10B HKD or equivalent
      if (!isNaN(val) && val >= 100 && val < 10_000_000_000) {
        price = val;
        break;
      }
    }
  }

  // 9. Confidence scoring with smart sub-bucket classification
  let score = 0;
  const flags: string[] = [];

  // Brand known -> +30
  if (brand !== 'Unknown') { score += 30; }
  else { flags.push('MISSING_BRAND_MATCH'); }  // sub-bucket: brand token not recognized

  // Valid reference found -> +25
  if (reference) { score += 25; }
  else if (brand !== 'Unknown') {
    // Brand found but no reference — likely a non-standard listing or description text
    flags.push('UNPARSABLE_REF');
    score += 5;  // partial credit for brand awareness
  }
  else { flags.push('MISSING_REFERENCE'); }

  // Dial color found/inferred -> +20
  if (dialColor) { score += 20; }
  else { flags.push('UNKNOWN_DIAL'); }

  // Price found and realistic -> +20
  if (price > 0 && price < 500_000_000) {
    // Outlier check: flag prices >$2M or <$500 as potential issues
    if (price >= 2_000_000) flags.push('PRICE_HIGH_OUTLIER');
    else if (price < 500) flags.push('PRICE_LOW_OUTLIER');
    score += 20;
    if (price >= 5000 && price <= 1_000_000) score += 5;
    else if (price > 1_000_000 && price <= 5_000_000) score += 2; // high-end but plausible
  } else {
    flags.push('MISSING_PRICE');
  }

  // Currency explicit -> +5
  if (currency && !['', 'USD'].includes(currency)) score += 5;

  // Year found -> +3
  if (year) score += 3;

  // Condition found -> +2
  if (condition !== 'Unknown') score += 2;

  // MULTI_WATCH detection: if raw message contains 3+ distinct watch references,
  // or 3+ price mentions, flag as multi-watch stock list
  const refCount = (clean.match(/\b\d{4,6}[A-Za-z]{0,4}\b/g) || []).length;
  const priceCount = (clean.match(/HKD|USD|EUR|\$/g) || []).length;
  if (refCount >= 3 || priceCount >= 3) {
    flags.push('MULTI_WATCH_STOCK_LIST');
    // Multi-watch lists should go to HUMAN review, keep score but flag it
  }

  // ── Intent detection ──
  let intent: 'SELL' | 'BUY' | 'INQUIRY' = 'SELL';
  const lc = clean.toLowerCase();
  // Buy intent: looking for, WTB, want to buy, looking, ISO (in search of), need, NTQ
  // Use \b only at start/end of full pattern, not inside alternatives — that's the source of bugs
  const buyPattern = /\b(wtb|want\b.*\bbuy|looking\s+for|iso\b|in\s+search\s+of|need\b|ntq\b|looking\s+to\s+buy|want\b.*\bfind|hunt\b|searching\s+for|anyone\b.*\bhave|who\b.*\bsell|where\b.*\bbuy)\b/i;
  if (buyPattern.test(lc)) {
    intent = 'BUY';
  }
  // Inquiry: what is, how much, price check, valuation, worth, question mark
  else if (/\b(how\s+much|what\b.*\bprice|valuation|worth\b|price\s+check|quote\b|pm\s+me|dm\s+me|interested|\?)\b/i.test(lc)) {
    intent = 'INQUIRY';
  }
  // "NTQ" specifically (No Text Quick) — buyer signaling
  if (/\bntq\b/i.test(lc)) {
    intent = 'BUY';
  }

  return {
    rawMessage: raw,
    brand,
    reference,
    model,
    dialColor: dialColor || 'UNKNOWN',
    price,
    currency,
    condition,
    year,
    confidence: Math.min(100, Math.round(score)),
    flags,
    intent,
  };
}

// ── Cross-validation: combine multiple independent signals ──
//
// When multiple independent signals agree, we can confidently auto-approve
// even if individual confidence is below the 90% threshold.
//
// Signals:
//   1. catalogHit — ref exists in enriched_refs.json with matching brand
//   2. imageVerdict — Gemini Vision agrees on brand + reference ('MATCH')
//   3. webSearchConfidence — GPT-4o-mini web search confidence (0-100)
//   4. priceSanityCheck — price within typical market range for the brand/ref
//   5. multipleSignals — count of independent agree-sources

export interface CrossValSignals {
  catalogHit?: boolean;
  catalogBrand?: string;     // brand from catalog
  imageVerdict?: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  imageConfidence?: number;
  webSearchConfidence?: number;
  webSearchBrand?: string;
  hasImageUrl?: boolean;
  rawTextLength?: number;
}

export interface CrossValResult {
  baseConfidence: number;
  boost: number;
  newConfidence: number;
  agreeSignals: number;
  totalSignals: number;
  reason: string;
}

export function applyCrossValidation(
  parsed: ParsedWatch,
  signals: CrossValSignals = {}
): CrossValResult {
  let boost = 0;
  const agreeSignals: string[] = [];
  const disagreeSignals: string[] = [];

  // 1. Catalog agreement — ref exists AND brand matches
  if (signals.catalogHit && signals.catalogBrand && signals.catalogBrand.length > 0) {
    if (parsed.brand !== 'Unknown' && (
      parsed.brand === signals.catalogBrand ||
      parsed.brand.toLowerCase().includes(signals.catalogBrand.toLowerCase()) ||
      signals.catalogBrand.toLowerCase().includes(parsed.brand.toLowerCase())
    )) {
      agreeSignals.push('catalog');
      boost += 10;
    } else if (parsed.brand === 'Unknown') {
      // Catalog provides brand but parser missed it — moderate boost (don't penalize parser)
      agreeSignals.push('catalog-supplies-brand');
      boost += 8;
    } else {
      // Catalog disagrees with parser on brand — REDUCED penalty (was -15)
      // The brand-vs-catalog mismatch can be a data quality issue (wrong emoji)
      // or a ref that's cataloged under wrong brand. Don't tank confidence.
      disagreeSignals.push('catalog-vs-parser-brand');
      boost -= 8;  // reduced from -15 — was too aggressive
    }
  } else if (signals.catalogHit) {
    // Catalog has ref but empty brand (GPT-disambigated entry)
    // Treat as reference confirmation only — strong boost since ref is verified
    agreeSignals.push('catalog-ref');
    boost += 7;  // slightly higher — ref confirmation is valuable
  }

  // 2. Image agreement — Gemini Vision saw the same ref
  if (signals.imageVerdict === 'MATCH') {
    agreeSignals.push('image-match');
    boost += 12;
  } else if (signals.imageVerdict === 'MISMATCH') {
    disagreeSignals.push('image-mismatch');
    boost -= 30;  // image disagrees strongly → suspect text is wrong
  } else if (signals.imageVerdict === 'UNVERIFIED') {
    // no boost, no penalty — just no signal
  }

  // 3. Web search agreement — GPT-4o-mini found canonical info matching
  if (signals.webSearchConfidence && signals.webSearchConfidence >= 70) {
    if (signals.webSearchBrand && parsed.brand !== 'Unknown' &&
        signals.webSearchBrand.toLowerCase() !== parsed.brand.toLowerCase()) {
      disagreeSignals.push('web-vs-parser-brand');
      boost -= 10;
    } else {
      agreeSignals.push('web-search');
      boost += 8;
    }
  }

  // 4. Price sanity — price within typical range for the reference (if known)
  //    For luxury watches, typical range is 5K - 5M USD (or equivalent)
  const basePrice = parsed.currency === 'USD' ? parsed.price :
    parsed.currency === 'HKD' ? parsed.price / 7.8 :
    parsed.currency === 'EUR' ? parsed.price * 1.1 :
    parsed.currency === 'GBP' ? parsed.price * 1.27 :
    parsed.currency === 'CHF' ? parsed.price * 1.15 :
    parsed.price;  // default
  if (parsed.price > 0) {
    if (basePrice < 5000 && parsed.brand !== 'Unknown') {
      // Very cheap for a known brand — possible but suspicious
      // (don't penalize, just flag)
    } else if (basePrice > 5_000_000) {
      // Very expensive — possible but might be a typo
      boost -= 3;
    }
  }

  // 5. Multi-signal agreement bonus — if 3+ independent sources agree, big boost
  const totalSignals = agreeSignals.length + disagreeSignals.length;
  if (agreeSignals.length >= 3) {
    boost += 8;  // multi-signal convergence
  }

  const newConfidence = Math.min(100, Math.max(0, parsed.confidence + boost));

  let reason = `${agreeSignals.length} signal(s) agree: ${agreeSignals.join(', ') || 'none'}`;
  if (disagreeSignals.length) {
    reason += ` | ${disagreeSignals.length} disagree: ${disagreeSignals.join(', ')}`;
  }
  reason += ` | base=${parsed.confidence} boost=${boost >= 0 ? '+' : ''}${boost} → ${newConfidence}`;

  return {
    baseConfidence: parsed.confidence,
    boost,
    newConfidence,
    agreeSignals: agreeSignals.length,
    totalSignals,
    reason,
  };
}

/**
 * Verdict based on confidence threshold
 */
export function getVerdict(confidence: number): 'AUTO_APPROVED' | 'AI_REVIEW' | 'HUMAN_REVIEW' {
  if (confidence >= 90) return 'AUTO_APPROVED';
  if (confidence >= 60) return 'AI_REVIEW';
  return 'HUMAN_REVIEW';
}
