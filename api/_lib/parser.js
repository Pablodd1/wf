/**
 * SHARED WATCH PARSER — api/_lib/parser.js
 *
 * Canonical parser for ALL ingestion paths (manual ingest, Green API webhook,
 * Telegram bot, polling). Every fix applied here applies everywhere.
 *
 * Exported functions:
 *   parseFull(rawMsg)        — full message parse → {brand, ref, dial, condition, month_code, year,
 *                               price, currency, confidence, field_confidence, accessories, listing_type}
 *   parsePrice(text, ref?)   — price extraction with year/ref/karat guards
 *   parseCurrency(text)      — currency detection
 *   verdict(parsed)           — APPROVED / HUMAN / RECYCLE
 *   splitMultiWatch(text)    — split bundled messages into individual listings
 *   classifyListingType(text) — WTS / WTB / WTT / GARBAGE
 *   inferBrandFromRef(ref)   — brand inference from reference number
 *   inferDialFromRef(ref)    — dial color inference from reference suffix
 *   isYearLike(n)            — year guard
 *   isReferenceNumber(n,ref) — ref guard
 *   isKaratContext(t,i,l)    — karat gold filter
 *   toUSD(amount, currency)  — FX conversion
 *   hashMessage(text)        — SHA-256 for dedup
 *   RATES                    — currency rates
 *   APPROVE_THRESHOLD        — 100
 *   HUMAN_THRESHOLD          — 80
 */

const crypto = require('crypto');

const APPROVE_THRESHOLD = 100;
const HUMAN_THRESHOLD = 80;

const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

/** Compute a SHA-256 hex digest of a string (for dedup). */
function hashMessage(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/** Return true if the number looks like a calendar year (1990–2030). */
function isYearLike(n) {
  return Number.isFinite(n) && n >= 1990 && n <= 2030;
}

/** P0-B: Return true if a bare number matches a known reference pattern already extracted. */
function isReferenceNumber(n, normalizedRef) {
  if (!normalizedRef) return false;
  const refDigits = normalizedRef.replace(/[^0-9]/g, '');
  return refDigits === String(n);
}

/** P0-C: Return true if "k" after a number means karat (gold), not thousand. */
function isKaratContext(text, matchIndex, matchLength) {
  const afterK = text.substring(matchIndex + matchLength, matchIndex + matchLength + 10).toLowerCase();
  if (/\bgold\b/.test(afterK)) return true;
  const beforeK = text.substring(Math.max(0, matchIndex - 10), matchIndex).toLowerCase();
  if (/(?:\bkarat\b|\bgold\b)/.test(beforeK)) return true;
  return false;
}

function parsePriceDetailed(text, normalizedRef = null) {
  // Normalize European thousands separator period: e.g. "16.500" or "153.000"
  // If there is a period followed by exactly three digits at the end of a word or string
  let cleanedText = text.replace(/(\d+)\.(\d{3})\b/g, '$1$2');

  // Strip commas but preserve text for European-decimal detection
  const t = cleanedText.replace(/,/g, '');

  const safe = (n, curr = null) => {
    if (isYearLike(n)) return { priceRaw: null, explicitCurrency: null };
    // Convert to USD equivalent to check sanity
    const usdVal = toUSD(n, curr || 'USD');
    if (usdVal > 5000000) {
      return { priceRaw: null, explicitCurrency: null }; // reject insane prices (> $5M USD)
    }
    return { priceRaw: n, explicitCurrency: curr };
  };

  // P1: European decimal-thousands before currency: 64.000Usdt → 64000
  const euDecM = t.match(/(\d{1,4})\.(\d{3})\s*(usdt|usd|hkd)\b/i);
  if (euDecM) {
    const candidate = parseInt(euDecM[1] + euDecM[2], 10);
    return safe(candidate, euDecM[3].toUpperCase());
  }

  // P1: hk$ prefix with m/k multipliers
  const hkDollarM = t.match(/hk\$\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (hkDollarM) {
    const val = parseFloat(hkDollarM[1]);
    const isCaseSize = val >= 24 && val <= 50 && !hkDollarM[1].includes('.');
    if (!isCaseSize) return safe(Math.round(val * 1_000_000), 'HKD');
  }
  const hkDollarK = t.match(/hk\$\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (hkDollarK) return safe(Math.round(parseFloat(hkDollarK[1]) * 1000), 'HKD');
  const hkDollarPlain = t.match(/hk\$\s*(\d{4,8})/i);
  if (hkDollarPlain) return safe(parseInt(hkDollarPlain[1], 10), 'HKD');

  // HKD with decimals: HKD4.15m, HKD1.43m, etc.
  const hkdM = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (hkdM) {
    const val = parseFloat(hkdM[1]);
    const isCaseSize = val >= 24 && val <= 50 && !hkdM[1].includes('.');
    if (!isCaseSize) return safe(Math.round(val * 1_000_000), 'HKD');
  }
  const hkdK = t.match(/HKD\s*(\d{1,4}(?:\.\d{1,2})?)\s*k\b/i);
  if (hkdK) return safe(Math.round(parseFloat(hkdK[1]) * 1000), 'HKD');

  const hkdPlain = t.match(/HKD\s*(\d{4,8})/i);
  if (hkdPlain) return safe(parseInt(hkdPlain[1], 10), 'HKD');

  const numBeforeHkd = t.match(/(\d{5,8})\s*HKD/i);
  if (numBeforeHkd) return safe(parseInt(numBeforeHkd[1], 10), 'HKD');
  const kBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*HKD/i);
  if (kBeforeHkd) return safe(Math.round(parseFloat(kBeforeHkd[1]) * 1000), 'HKD');
  const mBeforeHkd = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\s*HKD/i);
  if (mBeforeHkd) {
    const val = parseFloat(mBeforeHkd[1]);
    const isCaseSize = val >= 24 && val <= 50 && !mBeforeHkd[1].includes('.');
    if (!isCaseSize) return safe(Math.round(val * 1_000_000), 'HKD');
  }

  const numBeforeUsd = t.match(/(\d{4,8})\s*(?:USD|USDT)/i);
  if (numBeforeUsd) return safe(parseInt(numBeforeUsd[1], 10), 'USD');
  const kBeforeUsd = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\s*(?:USD|USDT)/i);
  if (kBeforeUsd) return safe(Math.round(parseFloat(kBeforeUsd[1]) * 1000), 'USD');

  // U suffix patterns: "400000U", "400kU", "400k U"
  const uMatch = t.match(/(\d+(?:\.\d+)?)\s*([kKmM])?\s*U\b/i);
  if (uMatch) {
    let val = parseFloat(uMatch[1]);
    const suf = (uMatch[2] || '').toLowerCase();
    if (suf === 'm') val *= 1_000_000;
    else if (suf === 'k') val *= 1_000;
    return safe(Math.round(val), 'USD');
  }

  const mMatch = t.match(/(\d{1,4}(?:\.\d{1,3})?)\s*m\b/i);
  if (mMatch) {
    const val = parseFloat(mMatch[1]);
    const isCaseSize = val >= 24 && val <= 50 && !mMatch[1].includes('.');
    if (!isCaseSize) return safe(Math.round(val * 1_000_000));
  }

  const kMatchAll = t.match(/(\d{1,4}(?:\.\d{1,2})?)\s*k\b/gi);
  if (kMatchAll) {
    for (const kM of kMatchAll) {
      const kIdx = t.indexOf(kM);
      const digitMatch = kM.match(/(\d{1,4}(?:\.\d{1,2})?)/);
      if (digitMatch && !isKaratContext(t, kIdx, kM.length)) {
        return safe(Math.round(parseFloat(digitMatch[1]) * 1000));
      }
    }
  }

  const usdMatch = t.match(/(?:USD|USDT|\$)\s*(\d{4,8})/i);
  if (usdMatch) return safe(parseInt(usdMatch[1], 10), 'USD');

  const hasRefPattern = /\b(?:RM\s?\d{2}|[345]\d{3}[A-Z]?[\/\-]|\d{6}[A-Z]{0,5}\b|\d{5}[A-Z]{2,5}\b|PAM\d{3,5}|IW\d{6,8}|BR0?\d)/i.test(t);
  if (!hasRefPattern) {
    const plainMatch = t.match(/\b(\d{5,8})\b/);
    if (plainMatch) {
      const candidate = parseInt(plainMatch[1], 10);
      if (!isReferenceNumber(candidate, normalizedRef)) {
        return safe(candidate, euDecM[3].toUpperCase());
      }
    }
  }
  return null;
}


function parsePrice(text, normalizedRef = null) {
  const res = parsePriceDetailed(text, normalizedRef);
  return res ? res.priceRaw : null;
}

function parseCurrency(text) {
  const t = text.toUpperCase();
  // Use case-insensitive match on original to avoid word-boundary issues after digits (e.g. 208.000Usdt)
  if (/USDT/i.test(text)) return 'USDT';
  if (/HKD/i.test(text)) return 'HKD';
  // P1: hk$ prefix → HKD (must check BEFORE generic $ → USD)
  if (/hk\$/i.test(text)) return 'HKD';
  if (/\bEUR\b|€/.test(t)) return 'EUR';
  if (/\bGBP\b|£/.test(t)) return 'GBP';
  if (/\bCHF\b/.test(t)) return 'CHF';
  if (/\bCNY\b|\bRMB\b/.test(t)) return 'CNY';
  if (/\bSGD\b/.test(t)) return 'SGD';
  if (/\b\d+\s*U\b/i.test(text)) return 'USD';
  if (/\bUSD\b|\$/.test(t)) return 'USD';
  return null;
}

function inferBrandFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase().replace(/[^A-Z0-9\/\-\.]/g, '');
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^[34579]\d{3}[A-Z]?\//.test(r)) return 'Patek Philippe';
  if (/^[34579]\d{3}[A-Z]$/.test(r)) return 'Patek Philippe';
  if (/^[34579]\d{3}-/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,5}$/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,5}$/.test(r)) return 'Rolex';
  if (/^[48]\d{3}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  if (/^[48]\d{4}[A-Z]$/.test(r)) return 'Vacheron Constantin';
  if (/^PAM\d{3,5}/.test(r)) return 'Panerai';
  if (/^IW\d{6,8}/.test(r)) return 'IWC';
  if (/^RDDB\w*/.test(r) || /^WHCH\w*/.test(r)) return 'Cartier';
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  if (/^BR0?[0-9]{1,2}[-]?[A-Z0-9]{2,}/i.test(r)) return 'Bell & Ross';
  if (/^(WSSA|SPB|SRP|SBDY|SNE)\d{3,4}/.test(r)) return 'Seiko';
  return null;
}

// P7: Removed unsafe dial inference entries ST (steel code) and BC (bracelet code)
function inferDialFromRef(ref) {
  if (!ref) return null;
  const r = ref.toUpperCase();
  // Only confirmed Rolex dial suffixes kept; ST and BC removed (P7)
  const map = { LN: 'Black', LB: 'Blue', LV: 'Green', CHNR: 'Brown', OR: 'Pink', TI: 'Grey' };
  for (const [sfx, color] of Object.entries(map)) {
    if (r.endsWith(sfx)) return color;
  }
  const last = r.split(/[\/\-]/).pop() || '';
  if (last.endsWith('G') && last.length > 2) return 'Blue';
  if (last.endsWith('J') && last.length > 2) return 'Champagne';
  if (last.endsWith('P') && last.length > 2) return 'Blue';
  if (last.endsWith('R') && last.length > 2) return 'Brown';
  return null;
}

// P5: WTB / WTS / WTT / GARBAGE classifier
function classifyListingType(text) {
  // WTB signals
  if (/\bWTB\b|\bW\.T\.B\b|WANT\s+TO\s+BUY|LOOKING\s+FOR|\bISO\b|\bNTQ\b|IN\s+SEARCH\s+OF|WANTED\b|SEEKING/i.test(text)) return 'WTB';
  // WTT signals
  if (/\bWTT\b|WANT\s+TO\s+TRADE|TRADE\s+FOR/i.test(text)) return 'WTT';
  // Garbage: very short, emoji-only, footer
  if (text.trim().length < 15 && /^[\s\u2600-\u27BF\u{1F000}-\u{1FAFF}\uFE0F]+$/u.test(text)) return 'GARBAGE';
  // Default: WTS
  return 'WTS';
}

function parseFull(rawMsg) {
  const text = rawMsg || '';
  let brand = null;
  if (/\bpp\b|patek\s?philippe|patek/i.test(text)) brand = 'Patek Philippe';
  else if (/\bap\b|audemars\s?piguet/i.test(text)) brand = 'Audemars Piguet';
  else if (/\brm\b|richard\s?mille/i.test(text)) brand = 'Richard Mille';
  else if (/rolex/i.test(text)) brand = 'Rolex';
  // P0-A: Vacheron — "VC" abbreviation
  else if (/(?:\bvc\b|vacheron|constantin)/i.test(text)) brand = 'Vacheron Constantin';
  else if (/omega/i.test(text)) brand = 'Omega';
  else if (/cartier/i.test(text)) brand = 'Cartier';
  // P0-A: A. Lange — standalone "LANGE"
  else if (/a\.?\s?lange|\blange\b|lange\s?[&]?\s?s[oö]hne/i.test(text)) brand = 'A. Lange & Söhne';
  else if (/\biwc\b|schaffhausen/i.test(text)) brand = 'IWC';
  else if (/panerai|pam\d/i.test(text)) brand = 'Panerai';
  else if (/seiko|grand\s?seiko/i.test(text)) brand = 'Seiko';
  // P0-A: Tudor — "TD" abbreviation
  else if (/(?:\btd\b|tudor)/i.test(text)) brand = 'Tudor';
  else if (/hublot/i.test(text)) brand = 'Hublot';
  else if (/breitling/i.test(text)) brand = 'Breitling';
  else if (/jaeger|jlc/i.test(text)) brand = 'Jaeger-LeCoultre';
  else if (/bell\s*[&]\s*ross|bell.*ross/i.test(text)) brand = 'Bell & Ross';

  let ref = null;
  const rmM = text.match(/\bRM\s?\d{2}[-\s]?\d{2}[A-Z]?\b/i);
  const ppM = text.match(/\b[34579]\d{3}[A-Z]?\/\d{1,4}[A-Z]{0,4}(?:-\d{3})?\b/i);
  const shortPP = text.match(/\b[34579]\d{3}[A-Z]?\b/i);
  // P6: Updated AP reference regex to capture long formats like 26420IO.OO.A402CA.01
  const apM = text.match(/\b\d{5}[A-Z]{2,5}(?:[.\/][A-Z0-9]+){0,4}\b/i);
  const rolexM = text.match(/\b\d{6}[A-Z]{0,5}\b/i);
  const vcM = text.match(/\b[48]\d{4}[A-Z]?\b/i);
  // P6: VC long format e.g. 2305V/100A-B170
  const vcLongM = text.match(/\b[0-9]{4}[A-Z]?\/[0-9A-Z]{3,}-[A-Z][0-9]{3,}\b/i);
  const pamM = text.match(/\bPAM\d{3,5}\b/i);
  const iwcM = text.match(/\bIW\d{6,8}\b/i);
  const cartierM = text.match(/\b(?:RDDB|WHCH|WSTA|WSCL)\w*\b/i);
  const langeM = text.match(/\b\d{3}\.\d{3}\b/);
  const bellRossM = text.match(/(BR[0-9A-Z]{2,10}(?:[-][A-Z0-9]+){1,4})/i);
  const seikoM = text.match(/\b(?:WSSA|SPB|SRP|SBDY|SNE)\d{3,4}\b/i);
  const ppVintage = text.match(/\b(2499|5971|5970|3970|3979|5004|5959|5160|5168|5170|5205|5208|5216|5270|5372|5470|5520|5539|5905|5935|5940|5960|6002|6300|7040|7118|7120|7130|7140|7150|7230|7300|7320)\b/i);
  const pp82 = text.match(/\b8239[-\s]?\d{4}\b/i);

  if (rmM) ref = rmM[0].toUpperCase().replace(/\s/g, '');
  else if (ppM) ref = ppM[0].toUpperCase();
  else if (shortPP) ref = shortPP[0].toUpperCase();
  else if (apM) ref = apM[0].toUpperCase();
  else if (pamM) ref = pamM[0].toUpperCase();
  else if (iwcM) ref = iwcM[0].toUpperCase();
  else if (cartierM) ref = cartierM[0].toUpperCase();
  else if (langeM) ref = langeM[0];
  else if (seikoM) ref = seikoM[0].toUpperCase();
  else if (bellRossM) ref = bellRossM[0].toUpperCase();
  else if (rolexM) ref = rolexM[0].toUpperCase();
  // P6: vcLongM takes priority over plain vcM
  else if (vcLongM) ref = vcLongM[0].toUpperCase();
  else if (pp82) ref = pp82[0].toUpperCase().replace(/\s/g, '');
  else if (ppVintage) ref = ppVintage[0].toUpperCase();
  else if (vcM) ref = vcM[0].toUpperCase();

  if (!brand && ref) brand = inferBrandFromRef(ref);
  if (!brand && /\bAP\d{5}/i.test(text)) brand = 'Audemars Piguet';
  if (!brand && /\bRm\d{2}/i.test(text)) brand = 'Richard Mille';

  let dial = null;
  const dialM = text.match(/\b(blue|black|green|white|brown|grey|gray|silver|pink|purple|red|orange|yellow|champagne|tiffany|panda|hulk|zebra|mop|meteorite|candy|crash|blk|rom|roma)\b/i);
  if (dialM) {
    const d = dialM[1].toLowerCase();
    if (d === 'blk') dial = 'Black';
    else if (d === 'rom' || d === 'roma') dial = 'Roman';
    else dial = dialM[1].charAt(0).toUpperCase() + dialM[1].slice(1).toLowerCase();
  }
  if (!dial && ref) dial = inferDialFromRef(ref);

  // P3: Expanded condition detection — order matters: most specific first
  let condition = null;
  if (/\bnos\b|new\s+old\s+stock/i.test(text)) condition = 'New Old Stock';
  else if (/\d{2}%\s*new/i.test(text)) condition = 'Like New'; // 99%new, 98%new → Like New
  else if (/like\s*new|likenew/i.test(text)) condition = 'Like New'; // before bare 'new'
  else if (/brand\s*new/i.test(text)) condition = 'New';
  else if (/\bnew\b|unworn|bnib/i.test(text)) condition = 'New';
  else if (/\bused\b|pre-?owned|worn/i.test(text)) condition = 'Used';
  else if (/\bmint\b|excellent/i.test(text)) condition = 'Like New';
  else if (/good\s+cond(?:ition)?/i.test(text)) condition = 'Good';

  // P2: Year/month code extraction — improved to capture N+digit month codes
  let month_code = null;
  let year = null;

  // Pattern: n6/26, n5/26, N6/2026, etc. — N+digit/year(2 or 4 digits)
  const nCodeSlash = text.match(/\b([Nn]\d)\/(\d{2}|\d{4})\b/);
  if (nCodeSlash) {
    month_code = nCodeSlash[1].toUpperCase();
    const rawYear = parseInt(nCodeSlash[2], 10);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (!condition) condition = 'New'; // N-code implies new/unworn
  }

  // Pattern: N6 2026, N1 2026 (space-separated)
  if (!month_code) {
    const nCodeSpace = text.match(/\b([Nn]\d)\s+(20[12]\d)\b/);
    if (nCodeSpace) {
      month_code = nCodeSpace[1].toUpperCase();
      year = parseInt(nCodeSpace[2], 10);
      if (!condition) condition = 'New';
    }
  }

  // Fallback: bare 4-digit year or year with y/Y suffix
  if (!year) {
    const yearM = text.match(/\b(19\d{2}|20[123]\d)[Yy]?\b/);
    year = yearM ? parseInt(yearM[1], 10) : null;
  }

  let priceRes = parsePriceDetailed(text, ref);
  let priceRaw = priceRes ? priceRes.priceRaw : null;
  let explicitCurrency = priceRes ? priceRes.explicitCurrency : null;

  // P0-B: Reject price if it matches the extracted reference digits
  if (priceRaw !== null && ref) {
    const refDigits = String(ref).replace(/[^0-9]/g, '');
    if (refDigits.length >= 4 && String(priceRaw) === refDigits) {
      priceRaw = null;
    }
  }

  // Year guard: reject prices that look like years
  if (priceRaw !== null && isYearLike(priceRaw)) {
    priceRaw = null;
  }

  // Bug 5: additional guard — if priceRaw equals the extracted year, nullify
  if (priceRaw !== null && year !== null && priceRaw === year) {
    priceRaw = null;
  }

  const currency = explicitCurrency || parseCurrency(text);

  // P4: Set/accessories extraction
  let accessories = {
    has_box: null,
    has_papers: null,
    is_naked: false,
    missing_links: null,
    stickers: null,
    bracelet_adjustment: null,
    export_only: false,
  };
  // Full Set → box=true, papers=true
  if (/full\s*set|fullset/i.test(text)) { accessories.has_box = true; accessories.has_papers = true; }
  // Naked → no box, no papers
  if (/\bnaked\b/i.test(text)) { accessories.is_naked = true; accessories.has_box = false; accessories.has_papers = false; }
  // No box
  if (/no\s*box|without\s*box/i.test(text)) accessories.has_box = false;
  // No papers
  if (/no\s*papers?|without\s*papers?/i.test(text)) accessories.has_papers = false;
  // With box
  if (/\bwith\s*box|has\s*box/i.test(text) && accessories.has_box === null) accessories.has_box = true;
  // Missing links: "-2 links", "minus 2 links"
  const linksM = text.match(/[-−]\s*(\d+)\s*links?/i);
  if (linksM) accessories.missing_links = parseInt(linksM[1]);
  // Stickers
  if (/stickers?/i.test(text)) accessories.stickers = /some\s*stickers?/i.test(text) ? 'some' : 'present';
  // Unadjusted
  if (/unadj|unadjusted/i.test(text)) accessories.bracelet_adjustment = 'unadjusted';
  // Export only
  if (/\bexport\b/i.test(text)) accessories.export_only = true;

  // Confidence scoring (keep integer for backwards compat)
  let confidence = 0;
  if (ref) confidence += 40;
  if (brand) confidence += 25;
  if (dial) confidence += 10;
  if (condition) confidence += 8;
  if (priceRaw) confidence += 10;
  if (year) confidence += 4;
  if (currency) confidence += 3;

  // P8: Field-level confidence
  const fieldConf = {
    brand: brand ? (text.toLowerCase().includes(brand.toLowerCase().split(' ')[0]) ? 0.99 : 0.85) : 0,
    reference: ref ? 0.96 : 0,
    price: priceRaw ? 0.92 : 0,
    currency: currency ? 0.80 : 0,
  };

  // P5: listing_type via classifyListingType
  const listing_type = classifyListingType(rawMsg || '');

  return {
    brand,
    ref,
    dial,
    condition,
    month_code,   // P2
    year,
    price: priceRaw,
    currency,
    confidence,   // keep integer for backwards compat
    field_confidence: {
      brand: fieldConf.brand,
      reference: fieldConf.reference,
      price: fieldConf.price,
      currency: fieldConf.currency,
      overall: confidence / 100,
    },
    accessories,  // P4
    listing_type, // P5
  };
}

function verdict(parsed) {
  const hasRef = !!(parsed.ref && parsed.ref.length > 2);
  const hasBrand = !!(parsed.brand && parsed.brand !== 'Unknown');
  if (!hasRef && !hasBrand) return 'RECYCLE';
  if (parsed.confidence < 35) return 'RECYCLE';
  if (parsed.confidence >= APPROVE_THRESHOLD && hasRef && hasBrand) return 'APPROVED';
  // REVIEW tier: high enough to suggest but not auto-approve
  if (parsed.confidence >= HUMAN_THRESHOLD && (hasRef || hasBrand)) return 'REVIEW';
  return 'HUMAN';
}

// ─── MULTI-WATCH SPLITTER ───
function splitMultiWatch(text) {
  if (!text || text.length < 10) return [text];

  const refPattern = /\b(?:RM\s?\d{2}[-\s]?\d{2}|[34579]\d{3}[A-Z]?(?:[\/\-]\d+[A-Z]?)?\b|\d{5,6}[A-Z]{0,5}\b|PAM\d{3,5}\b|IW\d{6,8}\b|\d{3}\.\d{3}\b)/gi;
  const refMatches = text.match(refPattern) || [];
  if (refMatches.length <= 1) return [text];

  // 1. Split by emoji or list/bullet separators if present
  const separatorRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]|[\u2022\u2023\u25E6\u2043\u2219\u25C6\u25A0\u25C0\u25B6\u27A1\u27A2]|\s+[-*+]\s+/gu;
  
  if (separatorRegex.test(text)) {
    const rawParts = [];
    let lastIdx = 0;
    let match;
    separatorRegex.lastIndex = 0;
    while ((match = separatorRegex.exec(text)) !== null) {
      rawParts.push(text.slice(lastIdx, match.index));
      lastIdx = match.index + match[0].length;
    }
    rawParts.push(text.slice(lastIdx));

    const refinedParts = [];
    let currentAccumulator = '';
    
    for (const part of rawParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      // Test if this part contains any watch reference
      refPattern.lastIndex = 0;
      const hasRef = refPattern.test(trimmed);
      if (hasRef) {
        if (currentAccumulator) {
          refinedParts.push((currentAccumulator + ' ' + trimmed).trim());
          currentAccumulator = '';
        } else {
          refinedParts.push(trimmed);
        }
      } else {
        currentAccumulator = (currentAccumulator + ' ' + trimmed).trim();
      }
    }
    
    if (currentAccumulator && refinedParts.length > 0) {
      refinedParts[refinedParts.length - 1] = (refinedParts[refinedParts.length - 1] + ' ' + currentAccumulator).trim();
    }

    if (refinedParts.length > 1) return refinedParts;
  }

  // 2. Fallback: Split by newline
  const lines = text.split(/\n/);
  const parts = [];
  let currentPart = '';
  const newListingPattern = /^[\s\u2600-\u27BF\u{1F000}-\u{1FAFF}\ufe0f]*?(?:RM\s?\d{2}|[34579]\d{3}|\d{5,6}[A-Z]|PAM\d|IW\d|Rolex|Patek|Audemars|Richard|Cartier|Hublot|Omega|Tudor|IWC|Panerai|A\.?\s?Lange|Zenith|Breitling|Jaeger|Vacheron|Franck|Ulysse)/iu;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (newListingPattern.test(trimmed) && currentPart) {
      parts.push(currentPart.trim());
      currentPart = trimmed;
    } else {
      currentPart += (currentPart ? '\n' : '') + trimmed;
    }
  }
  if (currentPart.trim()) parts.push(currentPart.trim());

  const validParts = parts.filter(p => {
    refPattern.lastIndex = 0;
    return refPattern.test(p);
  });

  if (validParts.length > 1) return validParts;

  // 3. Fallback: Mid-line price-ref boundary split for space-separated listings without newlines
  if (!text.includes('\n')) {
    const STRONG_REF_RE = /(?:RM\s?\d{2}[-\s]?\d{2}|[34579]\d{3}[A-Z]?(?:[\/\-]\d+[A-Z]?)?\b|\d{5,6}[A-Z]{0,5}\b|PAM\d{3,5}\b|IW\d{6,8}\b|\d{3}\.\d{3}\b)/gi;
    const PRICE_TOKEN_RE = /\d{2,3}\s?[kKmM]\b|[$€£]|\b(?:hkd|usd|usdt|eur|chf|gbp|sgd)\b|[\d,]{4,}|\b\d+\s*U\b/i;
    
    const hits = [];
    let m;
    STRONG_REF_RE.lastIndex = 0;
    while ((m = STRONG_REF_RE.exec(text)) !== null) {
      if (/^(?:19|20)\d{2}[Yy]?$/.test(m[0])) continue;
      if (/^\d{3,7}(?:HKD|USD|USDT|EUR|CHF|GBP|SGD|JPY|AED|U)$/i.test(m[0])) continue;
      hits.push({ ref: m[0], idx: m.index });
    }
    
    const normRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const distinct = [...new Set(hits.map(h => normRef(h.ref)))];
    
    if (hits.length >= 2 && distinct.length >= 2) {
      const cuts = [hits[0].idx];
      for (let i = 1; i < hits.length; i++) {
        const between = text.slice(hits[i - 1].idx, hits[i].idx);
        if (normRef(hits[i].ref) === normRef(hits[i - 1].ref)) continue;
        if (PRICE_TOKEN_RE.test(between)) cuts.push(hits[i].idx);
      }
      
      if (cuts.length >= 2) {
        const midParts = [];
        for (let i = 0; i < cuts.length; i++) {
          const start = cuts[i];
          const end = i + 1 < cuts.length ? cuts[i + 1] : text.length;
          const seg = text.slice(start, end).trim();
          if (seg) midParts.push(seg);
        }
        if (cuts[0] > 0) {
          const lead = text.slice(0, cuts[0]).trim();
          if (lead) midParts[0] = (lead + ' ' + midParts[0]).trim();
        }
        return midParts;
      }
    }
  }

  return [text];
}

module.exports = {
  parseFull,
  parsePrice,
  parseCurrency,
  verdict,
  splitMultiWatch,
  classifyListingType,
  inferBrandFromRef,
  inferDialFromRef,
  isYearLike,
  isReferenceNumber,
  isKaratContext,
  toUSD,
  hashMessage,
  RATES,
  APPROVE_THRESHOLD,
  HUMAN_THRESHOLD,
};
