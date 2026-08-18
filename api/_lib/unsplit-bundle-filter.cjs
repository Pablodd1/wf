'use strict';

const {
  extractPriceObservations,
  extractReference,
  segmentDealerMessage,
} = require('./normalization-v4.cjs');

const REVIEWED_BRAND_PATTERNS = [
  [/\brolex\b/i, 'Rolex'],
  [/\b(?:patek(?:\s+philippe)?|pp)\b/i, 'Patek Philippe'],
  [/\b(?:audemars(?:\s+piguet)?|AP)\b/i, 'Audemars Piguet'],
  [/\b(?:richard\s+mille|RM(?=\s*\d))\b/i, 'Richard Mille'],
  [/\bcartier\b/i, 'Cartier'],
  [/\bzenith\b/i, 'Zenith'],
];

const EXPLICIT_MULTI_ITEM = /\b(?:bundle|multi[\s-]?listing|multiple\s+watches|several\s+watches|two\s+watches|both\s+watches|pair\s+of\s+watches|set\s+of\s+watches|lot\s+of\s+watches|watch\s+lot|stock\s+list|package\s+deal|combo\s+deal)\b/i;
const QUANTITY_MULTI_ITEM = /\b(?:x\s*[2-9]|[2-9]\s*x|[2-9]\s*(?:pcs|pieces|watches))\b/i;
const REQUEST_LANGUAGE = /\b(?:WTB|NTQ|looking(?:\s+for)?|seeking|wanted|need)\b/i;

function messageClauses(rawMessage) {
  return String(rawMessage || '')
    .replace(/_x000D_/gi, '\n')
    .split(/\r?\n|[;•▪◦]|,(?=\s*(?:RM\s*\d|Zenith\s+\d{2}\.|[A-Za-z]*\s*\d{4,6}))/i)
    .flatMap(part => part.split(/\s+\/(?=\s*RM\s*\d)|\s+(?:and|or|plus)\s+(?=(?:Rolex|Patek|PP|AP|Audemars|Richard|RM\s*\d|Cartier|Zenith)\b)/i))
    .map(part => part.trim())
    .filter(Boolean);
}

function distinctReferences(rawMessage) {
  const references = [];
  const keys = new Set();
  const add = value => {
    const key = String(value || '').replace(/[\s.-]/g, '').toUpperCase();
    const rmBaseAlreadyCaptured = /^RM\d{2,3}$/.test(key)
      && [...keys].some(existing => existing.startsWith(key));
    const overlappingFragmentAlreadyCaptured = key.length >= 5
      && [...keys].some(existing => existing.includes(key) || key.includes(existing));
    if (key && !keys.has(key) && !rmBaseAlreadyCaptured && !overlappingFragmentAlreadyCaptured) {
      keys.add(key);
      references.push(value);
    }
  };
  for (const match of String(rawMessage || '').matchAll(/\bRM\s*\d{2,3}(?:-\d{2})?(?:-[A-Z0-9]{1,4})?\b/gi)) add(match[0]);
  for (const match of String(rawMessage || '').matchAll(/\b\d{2}\.\d{4}\.\d{3,4}\/[0-9A-Z]+(?:\.[0-9A-Z]+)*\b/gi)) add(match[0]);
  for (const clause of messageClauses(rawMessage)) add(extractReference(clause));
  return references;
}

function multiItemRisk(rawMessage) {
  const raw = String(rawMessage || '').trim();
  if (!raw) return { is_multi: false, reasons: [], references: [], brands: [], segment_count: 0 };
  const segments = segmentDealerMessage(raw);
  const references = distinctReferences(raw);
  const brands = REVIEWED_BRAND_PATTERNS.filter(([pattern]) => pattern.test(raw)).map(([, brand]) => brand);
  const priceObservations = extractPriceObservations(raw).length;
  const priceLines = raw.replace(/_x000D_/gi, '\n').split(/\r?\n/)
    .filter(line => extractPriceObservations(line).length > 0).length;
  const reasons = [];
  if (segments.length > 1) reasons.push('MULTIPLE_DETERMINISTIC_SEGMENTS');
  if (brands.length > 1) reasons.push('MULTIPLE_REVIEWED_BRANDS');
  if (EXPLICIT_MULTI_ITEM.test(raw)) reasons.push('EXPLICIT_MULTI_ITEM_LANGUAGE');
  if (QUANTITY_MULTI_ITEM.test(raw)) reasons.push('MULTI_ITEM_QUANTITY');
  if (priceLines > 1 && references.length > 1) reasons.push('MULTIPLE_PRICED_LINES');
  if (priceObservations > 1 && references.length > 1) reasons.push('MULTIPLE_REFERENCE_PRICES');
  // Request posts frequently separate references with whitespace only (for
  // example, "Looking RM001 WG RM002 WG"). Two distinct reference tokens in
  // WTB/NTQ/request language are already sufficient to prove that this is not
  // one publishable watch. Fail closed even when punctuation is absent.
  if (references.length > 1 && REQUEST_LANGUAGE.test(raw)) reasons.push('MULTI_REFERENCE_REQUEST');
  return {
    is_multi: reasons.length > 0,
    reasons: [...new Set(reasons)],
    references,
    brands,
    segment_count: segments.length,
  };
}

function hasStoredBundleFlag(row) {
  const flags = row?.flags;
  if (Array.isArray(flags)) return flags.includes('BUNDLE_SPLIT_REQUIRED');
  return Boolean(flags && typeof flags === 'object' && flags.BUNDLE_SPLIT_REQUIRED);
}

function deterministicCandidateCount(row) {
  if (hasStoredBundleFlag(row)) return 2;
  const risk = multiItemRisk(row?.raw_message || '');
  return risk.is_multi ? Math.max(2, risk.segment_count, risk.references.length) : risk.segment_count;
}

async function loadShadowBundleParentIds(client, rows) {
  const ids = [...new Set((rows || []).map(row => String(row?.id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Set();
  try {
    const { data, error } = await client.rpc('unsplit_bundle_parent_ids', {
      p_source_record_ids: ids,
    });
    if (error) throw error;
    return new Set((data || []).map(row => String(row.source_record_id || '').trim()).filter(Boolean));
  } catch (error) {
    // The raw-message gate remains active while a preview deployment is still
    // applying the supporting RPC. Never promote on an RPC failure.
    console.warn('[bundle-filter] shadow lookup unavailable:', error.message);
    return new Set();
  }
}

function bundleCandidateCount(row, shadowBundleIds) {
  if (shadowBundleIds?.has(String(row?.id || ''))) return 2;
  return deterministicCandidateCount(row);
}

module.exports = {
  bundleCandidateCount,
  deterministicCandidateCount,
  hasStoredBundleFlag,
  loadShadowBundleParentIds,
  messageClauses,
  multiItemRisk,
};
