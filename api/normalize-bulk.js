/**
 * BULK NORMALIZATION ENDPOINT  —  /api/normalize-bulk
 *
 * Applies the full normalization pipeline to all 117k+ records in
 * public/parsedWatches.json. Writes results back to the same file.
 *
 * Normalization pipeline (mirrors src/lib/normalize.ts in JS for Vercel):
 *   1. Strip whitespace artifacts (NBSP, tabs from Excel paste)
 *   2. Brand normalization (case + canonical)
 *   3. Brand auto-inference from ref prefix (covers PP/Rolex/AP/RM/VC/Cartier/IWC/JLC/Tudor/Omega/Hublot/Blancpain)
 *   4. Emoji → brand hint (🔵 🏮 ⭐ 🔴 etc.)
 *   5. Reference case/dash/typo normalization (Rm11-01ti → RM 11-01 TI)
 *   6. Patek canonical suffix (5168G → 5168G-001)
 *   7. Intent detection (SELL / WTB / INQUIRY / RED_FLAG)
 *   8. Red flag detection (replica / aftermarket / custom)
 *   9. Recompute confidence
 *
 * Run modes:
 *   POST /api/normalize-bulk                    → process all 117k records
 *   POST /api/normalize-bulk { sample: 1000 }    → process first 1000 (test)
 *   POST /api/normalize-bulk { dryRun: true }    → return fix summary without writing
 *   POST /api/normalize-bulk { text: "..." }     → normalize single text (test)
 */

const fs = require('fs');
const path = require('path');
const { requireServiceToken } = require('./_lib/require-service-token.cjs');

// ─── BRAND_CANONICAL ────────────────────────────────────────────────────────
const BRAND_CANONICAL = {
  'patek philippe': 'Patek Philippe', 'patek': 'Patek Philippe', 'pp': 'Patek Philippe',
  'philippe': 'Patek Philippe', 'rolex': 'Rolex', 'rlx': 'Rolex',
  'audemars piguet': 'Audemars Piguet', 'ap': 'Audemars Piguet', 'audemars': 'Audemars Piguet',
  'richard mille': 'Richard Mille', 'rm': 'Richard Mille',
  'vacheron constantin': 'Vacheron Constantin', 'vacheron': 'Vacheron Constantin', 'vc': 'Vacheron Constantin',
  'omega': 'Omega', 'cartier': 'Cartier', 'iwc': 'IWC',
  'jaeger-lecoultre': 'Jaeger-LeCoultre', 'jlc': 'Jaeger-LeCoultre',
  'tudor': 'Tudor', 'hublot': 'Hublot', 'breguet': 'Breguet',
  'tag heuer': 'TAG Heuer', 'panerai': 'Panerai', 'breitling': 'Breitling',
  'chopard': 'Chopard', 'zenith': 'Zenith',
  'a. lange & sohne': 'A. Lange & Söhne', 'lange': 'A. Lange & Söhne',
  'h. moser': 'H. Moser & Cie', 'blancpain': 'Blancpain',
  'fp journe': 'F. P. Journe', 'f.p. journe': 'F. P. Journe',
  'ulysse nardin': 'Ulysse Nardin', 'grand seiko': 'Grand Seiko', 'seiko': 'Grand Seiko',
};

function normalizeBrand(input) {
  if (!input) return 'Unknown';
  const key = String(input).toLowerCase().trim().replace(/\s+/g, ' ');
  return BRAND_CANONICAL[key] || 'Unknown';
}

// ─── REF_BRAND_RULES (order matters — specific first) ───────────────────────
const REF_BRAND_RULES = [
  { brand: 'Richard Mille',       test: r => /^RM\s?\d/i.test(r) },
  { brand: 'Cartier',             test: r => /^W[A-Z]?\d{4,6}/i.test(r) || /^H\d{4}/i.test(r) },
  { brand: 'IWC',                 test: r => /^IW\d/i.test(r) },
  { brand: 'Jaeger-LeCoultre',    test: r => /^Q\d{7}/i.test(r) || /^Q\d{6}/i.test(r) },
  { brand: 'Blancpain',           test: r => /^6654/i.test(r) },
  { brand: 'Audemars Piguet',     test: r => /^15\d{3}/i.test(r) },
  { brand: 'Audemars Piguet',     test: r => /^16\d{3}/i.test(r) },
  { brand: 'Audemars Piguet',     test: r => /^26\d{3}/i.test(r) },
  { brand: 'Audemars Piguet',     test: r => /^41\d{3}/i.test(r) },
  { brand: 'Audemars Piguet',     test: r => /^25\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^11\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^12\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^22\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^23\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^24\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^25\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^26\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^27\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^28\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^36\d{4}/i.test(r) },
  { brand: 'Rolex',               test: r => /^21\d{3}/i.test(r) },
  { brand: 'Rolex',               test: r => /^16\d{3}/i.test(r) && !/^16[0-2]\d{2}/i.test(r) },
  { brand: 'Rolex',               test: r => /^62\d{2}/i.test(r) },
  { brand: 'Rolex',               test: r => /^55\d{2}[A-Z]/i.test(r) && !/^552[0-9]/.test(r) && !/^6119/.test(r) },
  { brand: 'Rolex',               test: r => /^65\d{2}[A-Z]/i.test(r) && !/^665[0-9]/.test(r) },
  { brand: 'Rolex',               test: r => /^10\d{3}[A-Z]/i.test(r) },
  { brand: 'Patek Philippe',      test: r => /^[5-7]\d{3}[A-Z\-\/]/i.test(r) || /^[5-7]\d{3}$/i.test(r) },
  { brand: 'Patek Philippe',      test: r => /^\d{4}\/\d/i.test(r) },
  { brand: 'Vacheron Constantin', test: r => /^4\d{4}/i.test(r) && !/^4[1-3]\d{3}/i.test(r) },
  { brand: 'Vacheron Constantin', test: r => /^3\d{4}/i.test(r) && !/^3[1-3]\d{3}/i.test(r) },
  { brand: 'Vacheron Constantin', test: r => /^47\d{3}/i.test(r) },
  { brand: 'Tudor',               test: r => /^79\d{3}/i.test(r) },
  { brand: 'Tudor',               test: r => /^7\d{4}/i.test(r) && !/^7[0-1]\d{3}/i.test(r) },
  { brand: 'Omega',               test: r => /^3\d{2}\.\d{2}/i.test(r) },
  { brand: 'Hublot',              test: r => /^4\d{4}[A-Z]{2}/i.test(r) && /^(30|31|33|34|35|36|40|41|42|43|44|45|46|47|48|49|5\d|6\d|7\d)\d{3}[A-Z]{2}/i.test(r) },
];

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const cleaned = String(ref).trim().toUpperCase().replace(/\s+/g, '');
  for (const rule of REF_BRAND_RULES) if (rule.test(cleaned)) return rule.brand;
  return null;
}

// ─── Emoji → brand hint ─────────────────────────────────────────────────────
const EMOJI_BRAND_HINT = {
  '🔵': 'Patek Philippe', '🏮': 'Patek Philippe', '🟦': 'Patek Philippe', '🔷': 'Patek Philippe',
  '🔴': 'Audemars Piguet', '🟥': 'Audemars Piguet',
  '🟢': 'Rolex', '⚡': 'Rolex', '🔮': 'Rolex', '⭐': 'Rolex', '🌟': 'Rolex', '🔥': 'Rolex', '🌹': 'Rolex',
  '🌀': 'Richard Mille', '⭕': 'Patek Philippe', '💎': 'Cartier', '🌲': 'Patek Philippe',
  '🎯': 'Audemars Piguet', '✨': 'Cartier',
};

function brandFromEmoji(raw) {
  for (const [emoji, brand] of Object.entries(EMOJI_BRAND_HINT)) {
    if (raw.includes(emoji)) return brand;
  }
  return null;
}

// ─── Intent + red flag ─────────────────────────────────────────────────────
const WTB_RE = /\b(wtb|w\.t\.b|want to buy|looking for|need|iso|in search of|anybody have|anybody's got|got a|need a|seeking)\b/i;
const RED_FLAG_RE = /\b(genuine movement|replica|aftermarket|not original|custom|homage|seized franken|frankenstein|aftermarket dial|aftermarket strap|custom diamonds|fake|stolen)\b/i;
const INQUIRY_RE = /\b(price\?|how much|value|worth|appraisal|any idea|pm me|dm me|details|more pics|more info)\b/i;

function detectIntent(raw) {
  const flags = [];
  let intent = 'SELL';
  if (RED_FLAG_RE.test(raw)) { flags.push('RED_FLAG_REPLICA_OR_AFTERMARKET'); intent = 'RED_FLAG'; }
  if (WTB_RE.test(raw)) { flags.push('WTB'); if (intent !== 'RED_FLAG') intent = 'WTB'; }
  if (INQUIRY_RE.test(raw) && intent === 'SELL') intent = 'INQUIRY';
  if (/crosspost|cross.posted/i.test(raw)) flags.push('CROSS_POST');
  return { intent, flags };
}

// ─── Reference normalization ────────────────────────────────────────────────
function normalizeReference(input) {
  if (!input) return null;
  let ref = String(input).trim();
  ref = ref.replace(/[\t\r\n]/g, '');
  ref = ref.replace(/(\D)$/, m => m.toUpperCase());

  const rmMatch = ref.match(/^RM\s?(\d{2})[-\s]?(\d{2})([A-Z]{1,3})?$/i);
  if (rmMatch) {
    const [, a, b, suffix] = rmMatch;
    return `RM ${a}-${b}${suffix ? ' ' + suffix.toUpperCase() : ''}`.trim();
  }
  const patekSlash = ref.match(/^(\d{4})\/(\d{0,2})([A-Z]{0,3})$/i);
  if (patekSlash) {
    const [, num, slash, suffix] = patekSlash;
    return `${num}/${slash}${suffix.toUpperCase()}`;
  }
  const patekFull = ref.match(/^(\d{4})\/(\d{0,3}[A-Z]{1,3})(?:-(\d{3,4}))?$/i);
  if (patekFull) {
    const [, num, middle, suffix] = patekFull;
    const mid = middle.replace(/[a-z]+/g, m => m.toUpperCase());
    return suffix ? `${num}/${mid}-${suffix}` : `${num}/${mid}`;
  }
  const rolexMatch = ref.match(/^(\d{6})([A-Z]{0,4})$/i);
  if (rolexMatch) return rolexMatch[1] + rolexMatch[2].toUpperCase();
  const apMatch = ref.match(/^(\d{5})([A-Z]{1,3})$/i);
  if (apMatch) return apMatch[1] + apMatch[2].toUpperCase();
  const patek4 = ref.match(/^(\d{4})([A-Z]{1,3})$/i);
  if (patek4) return patek4[1] + patek4[2].toUpperCase();
  return ref || null;
}

// ─── Patek canonical suffix ─────────────────────────────────────────────────
const PATEK_CANONICAL = {
  '5168G':       { canonical: '5168G-001',  dial: 'Khaki' },
  '5168G-001':   { canonical: '5168G-001',  dial: 'Khaki' },
  '5167A':       { canonical: '5167A-001',  dial: 'Black' },
  '5167A-001':   { canonical: '5167A-001',  dial: 'Black' },
  '5167R':       { canonical: '5167R-001',  dial: 'Brown' },
  '5164R':       { canonical: '5164R-001',  dial: 'Brown' },
  '5270P':       { canonical: '5270P-001',  dial: 'Black' },
  '5271P':       { canonical: '5271P-001',  dial: 'Black' },
  '5205R':       { canonical: '5205R-001',  dial: 'Blue' },
  '5961P':       { canonical: '5961P-001',  dial: 'Black' },
  '5968G':       { canonical: '5968G-001',  dial: 'Green' },
  '6119R':       { canonical: '6119R-001',  dial: 'Brown' },
  '5227G':       { canonical: '5227G-001',  dial: 'White' },
  '5822P':       { canonical: '5822P-001',  dial: 'Blue' },
  '5328G':       { canonical: '5328G-001',  dial: 'White' },
  '5212A':       { canonical: '5212A-001',  dial: 'White' },
  '5712/1A':     { canonical: '5712/1A-010', dial: 'Blue' },
  '5712/1A-010': { canonical: '5712/1A-010', dial: 'Blue' },
  '5711/1A':     { canonical: '5711/1A-014', dial: 'Blue' },
  '5711/1A-014': { canonical: '5711/1A-014', dial: 'Blue' },
  '5980/1A':     { canonical: '5980/1A-014', dial: 'Blue' },
  '5980/1AR':    { canonical: '5980/1AR-001', dial: 'Brown' },
};

function canonicalizePatek(ref, dial) {
  if (!ref) return { ref: '', dial: dial || 'UNKNOWN' };
  const rule = PATEK_CANONICAL[ref.toUpperCase().trim()];
  if (!rule) return { ref: ref.toUpperCase(), dial: dial || 'UNKNOWN' };
  const finalDial = (dial && dial !== 'UNKNOWN') ? dial : rule.dial;
  return { ref: rule.canonical, dial: finalDial };
}

// ─── Dial color extraction ─────────────────────────────────────────────────
const DIAL_COLORS = ['Black','White','Blue','Green','Red','Yellow','Brown','Pink','Grey','Silver','Champagne','Salmon','Mop','Mother of Pearl','MOP','Tropical','Khaki','Beige','Panda','Tiffany','Ice Blue','Sundust','Chocolate','Olive','Luminous'];

function extractDial(text) {
  if (/mop|mother\s*of\s*pearl/i.test(text)) return 'MOP';
  if (/ice\s*blue/i.test(text)) return 'Ice Blue';
  const lower = text.toLowerCase();
  for (const c of DIAL_COLORS) if (lower.includes(c.toLowerCase())) return c;
  return null;
}

// ─── Year + Condition ───────────────────────────────────────────────────────
function extractYear(text) {
  const m = text.match(/\b(20[12]\d|2030)\b/);
  if (m) return parseInt(m[1], 10);
  const m2 = text.match(/[\s/](\d{2})Y\b/i);
  if (m2) {
    const y = parseInt(m2[1], 10);
    if (y >= 15 && y <= 30) return 2000 + y;
  }
  return null;
}
function extractCondition(text) {
  if (/\bnew\b|unworn|\bbnib\b|sealed|full\s*set|mint\b/i.test(text)) return 'New';
  if (/\bused\b|pre[-\s]?owned|worn|second[-\s]?hand/i.test(text)) return 'Used';
  return 'Unknown';
}

// ─── Price + currency ───────────────────────────────────────────────────────
function extractPrice(text) {
  const cleaned = text.replace(/[\t\n]/g, ' ');
  let m = cleaned.match(/(\d+(?:\.\d+)?)\s*([kKmM])\b\s*(hkd|usd|usdt|eur|€|\$)?/);
  if (m) {
    const num = parseFloat(m[1]);
    const mult = /m/i.test(m[2]) ? 1_000_000 : 1_000;
    let cur = (m[3] || '').toUpperCase();
    if (!cur) cur = cleaned.includes('HKD') ? 'HKD' : cleaned.includes('USD') ? 'USD' : cleaned.includes('€') ? 'EUR' : 'USD';
    return { price: Math.round(num * mult), currency: cur.replace('€', 'EUR') };
  }
  m = cleaned.match(/(hkd|usd|usdt|eur)\s*(\d+(?:[,.]\d+)?)\s*([kKmM]?)/i);
  if (m) {
    const cur = m[1].toUpperCase();
    const num = parseFloat(m[2].replace(',', ''));
    const mult = /m/i.test(m[3] || '') ? 1_000_000 : /k/i.test(m[3] || '') ? 1_000 : 1;
    return { price: Math.round(num * mult), currency: cur };
  }
  m = cleaned.match(/([\$€])\s*(\d{1,3}(?:,\d{3})*|\d+)/);
  if (m) return { price: parseInt(m[2].replace(/,/g, ''), 10), currency: m[1] === '€' ? 'EUR' : 'USD' };
  return { price: 0, currency: '' };
}

// ─── Main normalizer ────────────────────────────────────────────────────────
function normalizeWatch(rawInput) {
  let raw = String(rawInput || '').trim();
  raw = raw.replace(/[\u00A0\u2000-\u200B\u2028\u2029]/g, ' ').replace(/\s+/g, ' ');

  const { intent, flags } = detectIntent(raw);

  // Brand detection priority: text → ref prefix → emoji
  let brand = 'Unknown';
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(BRAND_CANONICAL)) {
    const pattern = k.length <= 3 ? new RegExp(`\\b${k}\\b`, 'i') : new RegExp(k, 'i');
    if (pattern.test(lower)) { brand = v; break; }
  }

  // Extract ref with multi-pattern
  let refCandidate =
    (raw.match(/\bIW\d{6}\b/) || [])[0] ||
    (raw.match(/\bQ\d{7}\b/) || [])[0] ||
    (raw.match(/\bW[A-Z]?\d{4,6}\b/) || [])[0] ||
    (raw.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Za-z]{0,3}\b/i) || [])[0] ||
    (raw.match(/\b\d{4}-\d{2,4}-[A-Z0-9]{2,4}\b/) || [])[0] ||
    (raw.match(/\b\d{4}[\/\-]\d{0,4}[A-Za-z]{0,3}(?:-\d{3,4})?\b/) || [])[0] ||
    (raw.match(/\b\d{4}[A-Za-z]{1,3}\b/) || [])[0] ||
    (raw.match(/\b\d{5,6}[A-Za-z]{0,4}\b/) || [])[0] ||
    null;

  if (brand === 'Unknown' && refCandidate) {
    const inferred = inferBrandFromRef(refCandidate);
    if (inferred) brand = inferred;
  }
  if (brand === 'Unknown') {
    const emojiBrand = brandFromEmoji(raw);
    if (emojiBrand) brand = emojiBrand;
  }

  let reference = normalizeReference(refCandidate);
  if (brand === 'Patek Philippe' && reference) {
    const dialGuess = extractDial(raw);
    const canon = canonicalizePatek(reference, dialGuess);
    reference = canon.ref;
  }

  let dialColor = extractDial(raw) || 'UNKNOWN';
  if (dialColor === 'UNKNOWN' && reference) {
    const canon = PATEK_CANONICAL[reference.toUpperCase()];
    if (canon) dialColor = canon.dial;
  }

  const condition = extractCondition(raw);
  const year = extractYear(raw);
  const { price, currency } = extractPrice(raw);

  let confidence = 0;
  if (reference) confidence += 40;
  if (brand !== 'Unknown') confidence += 25;
  if (dialColor !== 'UNKNOWN') confidence += 15;
  if (price > 0) confidence += 10;
  if (currency) confidence += 5;
  if (condition !== 'Unknown') confidence += 3;
  if (year) confidence += 2;
  confidence = Math.min(confidence, 100);

  return { brand, reference, dialColor, condition, year, price, currency, intent, flags, confidence };
}

// ─── Bulk normalize records array ───────────────────────────────────────────
function normalizeRecords(records) {
  const fix = {
    total: records.length,
    brandFixed: 0, refFixed: 0, dialFixed: 0, priceFixed: 0,
    intentSet: 0, flagged: 0,
    confidenceBefore: 0, confidenceAfter: 0,
    brandCanonFixed: 0,    // case + whitespace fixes
    unknownBrandResolved: 0,
    unknownDialResolved: 0,
  };

  const IDX = {
    brand: 1, reference: 2, dialColor: 3,
    price: 4, priceUSD: 5, currency: 6, condition: 7,
    rawMessage: 8, confidence: 9, isResidue: 10,
    originalPrice: 11, originalCurrency: 12, description: 13,
  };

  const out = records.map(r => {
    const raw = r[IDX.rawMessage] || '';
    const norm = normalizeWatch(raw);

    fix.confidenceBefore += (r[IDX.confidence] || 0);

    const newRec = [...r];
    const beforeBrand = newRec[IDX.brand];
    const beforeRef = newRec[IDX.reference];
    const beforeDial = newRec[IDX.dialColor];

    newRec[IDX.brand] = norm.brand;
    newRec[IDX.reference] = norm.reference || beforeRef;
    newRec[IDX.dialColor] = norm.dialColor;
    if (norm.price > 0) newRec[IDX.price] = norm.price;
    if (norm.currency) newRec[IDX.currency] = norm.currency;
    newRec[IDX.condition] = norm.condition;

    // Append normalization metadata to description
    const meta = [];
    if (norm.intent !== 'SELL') meta.push(`intent:${norm.intent}`);
    if (norm.flags.length) meta.push(`flags:${norm.flags.join(',')}`);
    const oldDesc = newRec[IDX.description] || '';
    newRec[IDX.description] = oldDesc + (meta.length ? ` [${meta.join('; ')}]` : '');

    // Track fixes
    if (beforeBrand !== norm.brand) {
      if (norm.brand !== 'Unknown' && beforeBrand === 'Unknown') fix.unknownBrandResolved++;
      else if (norm.brand !== 'Unknown') fix.brandCanonFixed++;
      fix.brandFixed++;
    }
    if (beforeRef !== norm.reference && norm.reference) fix.refFixed++;
    if (beforeDial !== norm.dialColor && norm.dialColor !== 'UNKNOWN') {
      fix.dialFixed++;
      if (beforeDial === 'UNKNOWN') fix.unknownDialResolved++;
    }
    if (norm.intent !== 'SELL') fix.intentSet++;
    if (norm.flags.length) fix.flagged++;

    // Recompute confidence
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

  // Compute approval distribution before/after
  const approve = conf => conf >= 85 ? 'APPROVED' : conf >= 50 ? 'HUMAN' : 'RECYCLE';
  const before = { APPROVED: 0, HUMAN: 0, RECYCLE: 0 };
  const after  = { APPROVED: 0, HUMAN: 0, RECYCLE: 0 };
  records.forEach(r => { const v = approve(r[IDX.confidence] || 0); before[v]++; });
  out.forEach(r => { const v = approve(r[IDX.confidence] || 0); after[v]++; });

  return { records: out, fix, distribution: { before, after } };
}

// ─── HTTP handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!requireServiceToken(req, res)) return;

  const body = req.body || {};

  // ── Mode 1: single-text test (for the demo page) ─────────────────────────
  if (body.text && typeof body.text === 'string') {
    const norm = normalizeWatch(body.text);
    return res.status(200).json({ success: true, normalized: norm });
  }

  // ── Mode 2: bulk normalization ──────────────────────────────────────────
  const dataPath = path.join(process.cwd(), 'public', 'parsedWatches.json');
  const distPath = path.join(process.cwd(), 'dist', 'parsedWatches.json');

  if (!fs.existsSync(dataPath)) {
    return res.status(500).json({ error: 'parsedWatches.json not found', tried: [dataPath, distPath] });
  }

  const sample = body.sample || null;
  const dryRun = body.dryRun === true;

  let records;
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    records = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ error: `read failed: ${e.message}` });
  }

  const subset = sample ? records.slice(0, sample) : records;
  const startTime = Date.now();
  const { records: fixed, fix, distribution } = normalizeRecords(subset);
  const elapsedMs = Date.now() - startTime;

  if (!dryRun) {
    try {
      // Write back the FULL dataset (fixed subset replaces its slice)
      const full = sample ? records.slice(0, sample).map((_, i) => fixed[i]) : fixed;
      const finalRecords = sample ? [...fixed, ...records.slice(sample)] : fixed;
      fs.writeFileSync(dataPath, JSON.stringify(finalRecords));
      // Also update dist copy if it exists
      if (fs.existsSync(distPath)) {
        fs.writeFileSync(distPath, JSON.stringify(finalRecords));
      }
    } catch (e) {
      return res.status(500).json({ error: `write failed: ${e.message}` });
    }
  }

  return res.status(200).json({
    success: true,
    sample: subset.length,
    dryRun,
    elapsedMs,
    fix,
    distribution,
  });
}
