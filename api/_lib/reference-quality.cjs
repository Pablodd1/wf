'use strict';

const { extractReference, inferBrandFromReference, segmentDealerMessage } = require('./normalization-v4.cjs');

function comparable(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function looksLikePriceOrListingText(reference) {
  const value = String(reference || '').trim();
  return /(?:HKD|HDK|USD|USDT|HK\$|US\$|\$)/i.test(value)
    || /^\d+(?:[.,]\d+)?(?:K|M|MIL|MILL|MN)$/i.test(value)
    || /\b(?:NEW|USED|WATCH\s*ONLY|FULL\s*SET|YEAR|ITEM|STOCK)\b/i.test(value);
}

function isPriceContext(rawLine, matchIndex, rawToken) {
  const text = String(rawLine || '');
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  const after = text.slice(matchIndex + String(rawToken || '').length, matchIndex + String(rawToken || '').length + 24);
  const compact = String(rawToken || '').toUpperCase();
  const numeric = /^\d{4,7}$/.test(compact);
  return numeric && (/(?:price|ask(?:ing)?|usd|hkd|hdk|usdt|us\$|hk\$|\$)\s*$/i.test(before)
    || /^\s*(?:USD|HKD|HDK|USDT|US\$|HK\$)/i.test(after)
    || /^\s*\$/.test(after));
}

function classifyNonWatch(rawLine) {
  const raw = String(rawLine || '').trim();
  if (/^(?:[_*\s-]*)(?:strap|bracelet|wooden\s+box|watch\s+box|box|link)\b/i.test(raw)
    || /\b(?:wooden\s+box|panthere\s+link|aquanaut\s+strap)\b/i.test(raw)
    || /\b(?:RM\s*)?\d{2,3}-\d{2}\s+strap\b/i.test(raw)
    || /\bstrap\s*\/\s*(?:RM\s*)?\d{2,3}-\d{2}\b/i.test(raw)) return 'ACCESSORY_NOT_WATCH';
  if (/\b(?:birkin|constance|hac\s+o\s+dos)\b/i.test(raw)) return 'NON_WATCH_OR_WRONG_CATEGORY';
  return null;
}

const BRAND_REFERENCE_PATTERNS = [
  [/ROLEX/, /\b((?:(?:[12]\d{4,5}|52\d{3}))(?:[A-Z]{1,5})?)\b/gi],
  [/RICHARDMILLE/, /\b((?:RM\s*)?\d{2,3}-\d{2}|RM\s*\d{2,3})(?:\s+(TI))?\b/gi,
    value => `RM${value.replace(/^RM\s*/i, '')}`],
  [/PATEKPHILIPPE|PATEK|PP/, /(?<![A-Z0-9.])([345678]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?)(?![A-Z0-9.])/gi],
  [/AUDEMARSPIGUET|AP/, /\b((?:15|26|67|77)\d{3}[A-Z]{2}(?:\.[A-Z0-9.]+)?)\b/gi],
  [/CARTIER/, /\b(W[A-Z]{3}\d{4})\b/gi],
  [/HUBLOT/, /\b(\d{3}\.[A-Z0-9]{2}\.[A-Z0-9]{4}\.[A-Z0-9]{2}(?:\.[A-Z0-9]{4})?)\b/gi],
  [/VACHERONCONSTANTIN|VACHERON|VC/, /\b((?:\d{4}[VH](?:\/\d{3}[A-Z]-[A-Z0-9]+)?|\d{5}))\b/gi],
  [/OMEGA/, /\b(\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3})\b/gi],
  [/TUDOR/, /\b(M?7\d{3}[A-Z0-9]+-\d{4})\b/gi, value => value.startsWith('M') ? value : `M${value}`],
  [/PANERAI/, /\bPAM\s*(\d{3,5})\b/gi, value => `PAM${value.padStart(5, '0')}`],
  [/JAEGERLECOULTRE|JLC/, /\b(Q\d{7})\b/gi],
  [/IWC/, /\b(IW\d{6})\b/gi],
  [/PIAGET/, /\b(G0A\s*\d{5})\b/gi, value => value.replace(/\s/g, '')],
  [/BREITLING/, /\b([A-Z]{2}\d{4}[A-Z0-9]{0,8})\b/gi],
  [/BVLGARI|BULGARI/, /\b(10\d{4})\b/gi],
  [/TAGHEUER|HEUER/, /\b((?:CAL|WW|CBL)[A-Z0-9]{4,})\b/gi],
  [/CHOPARD/, /\b((?:\d{6}-\d{4}|\d{4}))\b/gi],
  [/ZENITH/, /\b(\d{2}\.\d{4}\.\d{4}\/[A-Z0-9.]+)\b/gi],
  [/BLANCPAIN/, /\b([A-Z0-9]{4}-[A-Z0-9]{4,5}-[A-Z0-9]{3,4})\b/gi],
  [/ULYSSENARDIN/, /\b(\d{3,4}-\d{2,4}(?:\/\d{2,3})?)\b/gi],
  [/GIRARDPERREGAUX/, /\b(\d{5}-\d{2}-\d{4}-[A-Z0-9]{4})\b/gi],
  [/GRANDSEIKO/, /\b(SB[A-Z]{2}\d{3})\b/gi],
  [/GLASHUTTEORIGINAL/, /\b(\d(?:-\d{2}){5})\b/gi],
  [/LONGINES/, /\b(L\d\.\d{3}\.\d\.\d{2}\.\d)\b/gi],
  [/BELLROSS/, /\b(BR\s?\d{2}(?:-?\d{2}|[A-Z0-9/-]{5,}))\b/gi, value => value.replace(/\s/g, '')],
];

function looksLikeTrailingBarePrice(rawLine, matchIndex, token, exportedReference) {
  if (!/^\d{5,7}$/.test(token) || comparable(token) === comparable(exportedReference)) return false;
  const raw = String(rawLine || '');
  const before = raw.slice(0, matchIndex);
  const after = raw.slice(matchIndex + token.length);
  if (!/^\s*(?:\([^)]*\)|[?*!#.,-])*\s*$/.test(after)) return false;
  if (/\b(?:upgrade|swap|change|to)\s*$/i.test(before) || /[/&+]\s*$/.test(before)) return false;
  return /\b(?:N\d{1,2}(?:\/\d{2,4})?|\d{1,2}\/\d{2,4}|19\d{2}|20\d{2}|NEW|USED|JUB|OYS|INDEX|DIAL|BLACK|WHITE|BLUE|GREEN|GREY|GRAY|PINK|PURPLE|CHAMP|SILVER|SALMON|TIFF(?:ANY)?|CELEBRATION)\b/i.test(before);
}

function brandReferences(brand, rawLine, priceRaw = null, exportedReference = null) {
  const brandKey = comparable(brand);
  const rule = BRAND_REFERENCE_PATTERNS.find(([pattern]) => pattern.test(brandKey));
  if (!rule) return [];
  const [, pattern, formatter = value => value] = rule;
  pattern.lastIndex = 0;
  const matches = [];
  for (const match of String(rawLine || '').matchAll(pattern)) {
    const token = String(match[1] || '');
    const after = String(rawLine || '').slice(match.index + match[0].length);
    const dealerPrefix = match.index === 0
      && /^\s*-\s*[A-Za-z]/.test(after)
      && comparable(after).startsWith(comparable(brand));
    const numericToken = /^\d{4,7}$/.test(token) ? Number(token) : null;
    const matchesSeparatedPrice = numericToken != null
      && Number.isFinite(Number(priceRaw))
      && Math.abs(numericToken - Number(priceRaw)) <= 1;
    if (looksLikePriceOrListingText(token)
      || isPriceContext(rawLine, match.index, token)
      || dealerPrefix
      || matchesSeparatedPrice
      || looksLikeTrailingBarePrice(rawLine, match.index, token, exportedReference)) continue;
    const value = formatter(String(match[1] || '').toUpperCase(), match);
    if (value && !matches.includes(value)) matches.push(value);
  }
  return matches;
}

function assessReferenceQuality({ brand, reference, rawLine, priceRaw = null }) {
  const reasons = [];
  const nonWatchReason = classifyNonWatch(rawLine);
  if (nonWatchReason) reasons.push(nonWatchReason);

  const exported = String(reference || '').trim();
  const candidates = segmentDealerMessage(rawLine || '');
  const exactBrandReferences = brandReferences(brand, rawLine, priceRaw, exported);
  if (candidates.length > 1 || exactBrandReferences.length > 1) reasons.push('MULTI_WATCH_STOCK_LIST');

  const extracted = exactBrandReferences.length === 1 ? exactBrandReferences[0] : extractReference(rawLine || '');
  const exportedKey = comparable(exported);
  const extractedKey = comparable(extracted);
  let proposedReference = null;

  if (!exported) reasons.push('REFERENCE_MISSING');
  if (exported && looksLikePriceOrListingText(exported)) reasons.push('REFERENCE_IS_PRICE_OR_LISTING_TEXT');
  if (exported && comparable(brand) === exportedKey) reasons.push('REFERENCE_IS_BRAND_ONLY');

  const exportedBrand = inferBrandFromReference(exported);
  if (exactBrandReferences.length === 1
    && extractedKey !== exportedKey
    && exportedBrand
    && brand
    && !looksLikePriceOrListingText(exported)
    && comparable(exportedBrand) !== comparable(brand)
    && comparable(rawLine).includes(exportedKey)) {
    reasons.push('MULTI_WATCH_STOCK_LIST');
  }

  if (extracted && extractedKey !== exportedKey && !reasons.includes('MULTI_WATCH_STOCK_LIST')) {
    proposedReference = extracted;
    reasons.push('REFERENCE_CORRECTION_AVAILABLE');
  } else if (!extracted && (reasons.includes('REFERENCE_MISSING')
    || reasons.includes('REFERENCE_IS_PRICE_OR_LISTING_TEXT')
    || reasons.includes('REFERENCE_IS_BRAND_ONLY'))) {
    reasons.push('NEEDS_MANUAL_REVIEW');
  }

  const inferredBrand = inferBrandFromReference(proposedReference || extracted || exported);
  // Generic numeric references overlap across brands. A brand-specific exact
  // match is stronger evidence than the generic Rolex/Patek fallback.
  if (!exactBrandReferences.length && inferredBrand && brand && comparable(inferredBrand) !== comparable(brand)) {
    reasons.push('WRONG_BRAND_SUSPECT');
  }

  return {
    proposed_reference: proposedReference,
    extracted_reference: extracted || null,
    reasons: [...new Set(reasons)],
    safe: reasons.length === 0,
  };
}

module.exports = { assessReferenceQuality, brandReferences, classifyNonWatch, looksLikePriceOrListingText };
