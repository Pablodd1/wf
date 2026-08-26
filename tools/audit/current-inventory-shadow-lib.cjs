'use strict';

const { normalizeStructuralText, sha256 } = require('./raw-first-observation-v3-lib.cjs');

const TERMINAL_STATUSES = new Set([
  'WITHDRAWN', 'DELETED', 'HIDDEN', 'REJECTED', 'SUPERSEDED',
  'SUPPRESSED_EXACT_DUPLICATE', 'ARCHIVED', 'SOLD', 'EXPIRED', 'UNAVAILABLE',
  'CLOSED', 'REMOVED', 'CANCELLED', 'CANCELED',
]);
const ACTIVE_STATUSES = new Set(['ACTIVE', 'AVAILABLE', 'OPEN', 'LIVE', 'FOR_SALE', 'FOR_BUY', 'WANTED']);

const INVALID_CHILD_CLASSIFICATIONS = new Set([
  'NON_WATCH_FRAGMENT', 'FIELD_ONLY_FRAGMENT', 'REPEATED_IDENTICAL_OFFER',
  'AMBIGUOUS_CHILD_BOUNDARY', 'UNSPLITTABLE_PARENT', 'REVIEW_REQUIRED',
]);

function compact(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizedTimestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function exactTokenReplace(text, token) {
  if (!token) return text;
  return String(text).split(String(token)).join(' ');
}

function identityText(rawChildText, sourcePriceText) {
  return normalizeStructuralText(exactTokenReplace(rawChildText, sourcePriceText));
}

function specificFragmentClassification(occurrence) {
  const text = String(occurrence.raw_child_text ?? '').trim();
  if (!text) return 'NON_WATCH_FRAGMENT';
  if (/^(?:header|footer|inventory|stock\s*list|available\s*watches?|wts|wtb|rolex|patek(?:\s+philippe)?)\s*[:\-–—]*$/i.test(text)) {
    return 'NON_WATCH_FRAGMENT';
  }
  if (/^(?:(?:tel|phone|whatsapp|wa|contact)\s*[:+\- ]*)?\+?[\d ()-]{8,}$/i.test(text)) {
    return 'NON_WATCH_FRAGMENT';
  }
  if (/^(?:\d{1,2}[\/.\-]){2}\d{2,4}$|^(?:19|20)\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}$/i.test(text)) {
    return 'NON_WATCH_FRAGMENT';
  }
  if (/^(?:(?:usd|usdt|hkd|eur|gbp|chf|sgd|jpy|cad|aud|cny|rmb|hk\$|\$|€|£|¥)\s*)?[\d,.]+\s*(?:k|m|mil|million)?$/i.test(text)) {
    return 'FIELD_ONLY_FRAGMENT';
  }
  if (/^(?:(?:rolex|patek(?:\s+philippe)?)\s+)?(?:strap|bracelet|buckle|clasp|bezel|dial|movement|case|link|links|box|papers?|certificate)(?:\s+\S+){0,5}$/i.test(text)
    && !/\b(?:watch|wts|wtb|sale|sell|buy|new|used|unworn)\b/i.test(text)) {
    return 'NON_WATCH_FRAGMENT';
  }
  if (/^[#\s\p{P}]*[a-z0-9/.-]{3,20}[#\s\p{P}]*$/iu
    && !occurrence.source_price_amount && !occurrence.condition && !occurrence.dial_or_color
    && !occurrence.serial_or_distinguishing_marker && !occurrence.quantity_marker) {
    return 'NON_WATCH_FRAGMENT';
  }
  return null;
}

const EXPLICIT_BRAND_PATTERNS = [
  ['Rolex', /\brolex\b/i],
  ['Patek Philippe', /\b(?:patek(?:\s+philippe)?|philippe\s+patek)\b/i],
  ['Richard Mille', /\brichard\s+mille\b/i],
  ['Audemars Piguet', /\baudemars\s+piguet\b/i],
  ['Omega', /\bomega\b/i],
  ['Cartier', /\bcartier\b/i],
  ['Tudor', /\btudor\b/i],
  ['Zenith', /\bzenith\b/i],
  ['TAG Heuer', /\btag\s+heuer\b/i],
  ['Vacheron Constantin', /\bvacheron(?:\s+constantin)?\b/i],
  ['Panerai', /\bpanerai\b/i],
  ['IWC', /\biwc\b/i],
  ['Breitling', /\bbreitling\b/i],
  ['Hublot', /\bhublot\b/i],
  ['Bulgari', /\b(?:bulgari|bvlgari)\b/i],
  ['Franck Muller', /\bfranck\s+muller\b/i],
  ['Jaeger-LeCoultre', /\bjaeger[\s-]*lecoultre\b/i],
  ['A. Lange & Sohne', /\b(?:a\.?\s*)?lange\s*(?:&|and)?\s*sohne\b/i],
];

function explicitBrandConflict(occurrence) {
  const assigned = String(occurrence.observed_brand || occurrence.brand || '').trim();
  const text = String(occurrence.raw_child_text || '');
  const named = EXPLICIT_BRAND_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([brand]) => brand);
  if (named.length && !named.includes(assigned)) return true;
  const reference = String(occurrence.exact_observed_reference || occurrence.observed_reference || '')
    .trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ['Rolex', 'Patek Philippe'].includes(assigned)
    && /^(?:RM\d|W[A-Z0-9]|Q\d{6,})/.test(reference);
}

function effectiveChildClassification(occurrence) {
  if (occurrence.classification && occurrence.classification !== 'UNIQUE_MARKET_OBSERVATION') {
    return INVALID_CHILD_CLASSIFICATIONS.has(occurrence.classification)
      ? occurrence.classification : 'REVIEW_REQUIRED';
  }
  if (explicitBrandConflict(occurrence)) return 'REVIEW_REQUIRED';
  return specificFragmentClassification(occurrence) || 'UNIQUE_MARKET_OBSERVATION';
}

function familyIdentityMaterial(observation) {
  const stableSource = observation.dealer_key || observation.source_identity_key;
  const sourceScope = stableSource || `parent:${observation.parent_key}`;
  return {
    source_scope: sourceScope,
    brand: observation.brand,
    observed_reference_key: observation.observed_reference_key,
    intent: observation.intent,
    identity_text_sha256: sha256(identityText(observation.raw_child_text, observation.source_price_text)),
    serial_marker: compact(observation.serial_or_distinguishing_marker),
    quantity: Number(observation.quantity_marker?.count || 0) || null,
  };
}

function createObservationIdentity(observation) {
  const material = familyIdentityMaterial(observation);
  const offerFamilyKey = sha256(JSON.stringify(material));
  const offerStateKey = sha256(JSON.stringify({
    offer_family_key: offerFamilyKey,
    structural_text_sha256: observation.normalized_structural_text_sha256,
    source_price_amount: Number(observation.source_price_amount) || null,
    source_currency: compact(observation.source_currency)?.toUpperCase() || null,
    price_evidence_classification: observation.price_evidence_classification || null,
  }));
  return { ...material, offer_family_key: offerFamilyKey, offer_state_key: offerStateKey };
}

function compareObservation(left, right) {
  const leftTime = Date.parse(left.source_timestamp || '') || 0;
  const rightTime = Date.parse(right.source_timestamp || '') || 0;
  return leftTime - rightTime
    || String(left.raw_occurrence_key).localeCompare(String(right.raw_occurrence_key));
}

function terminalClassification(observation) {
  const explicit = String(observation.source_status || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (TERMINAL_STATUSES.has(explicit)) return explicit === 'DELETED' || explicit === 'HIDDEN'
    || explicit === 'REJECTED' || explicit === 'ARCHIVED' || explicit === 'SOLD'
    || explicit === 'EXPIRED' || explicit === 'UNAVAILABLE' || explicit === 'CLOSED'
    || explicit === 'REMOVED' || explicit === 'CANCELLED' || explicit === 'CANCELED' ? 'WITHDRAWN' : explicit;
  if (observation.disposition?.withdrawn) return 'WITHDRAWN';
  if (observation.disposition?.duplicate) return 'SUPERSEDED';
  if (observation.disposition?.superseded) return 'SUPERSEDED';
  return null;
}

function explicitActiveStatus(observation) {
  return ACTIVE_STATUSES.has(String(observation.source_status || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
}

function classifyOfferFamily(rows) {
  if (!rows.length) throw new Error('Offer family cannot be empty');
  const sorted = [...rows].sort(compareObservation);
  const states = new Map();
  for (const row of sorted) {
    const group = states.get(row.offer_state_key) || [];
    group.push(row);
    states.set(row.offer_state_key, group);
  }
  const latest = sorted.at(-1);
  const terminal = terminalClassification(latest);
  const currentStatus = terminal || (latest.disposition?.published || explicitActiveStatus(latest)
    ? 'CURRENT_ACTIVE' : 'CURRENT_LATEST_STATE');
  const stateCount = states.size;
  const repostCollapsed = sorted.length - stateCount;
  const historicalOnly = Math.max(0, stateCount - 1);
  const stateRows = [...states.values()].map(group => ({
    offer_state_key: group[0].offer_state_key,
    first_seen: normalizedTimestamp(group[0].source_timestamp),
    last_seen: normalizedTimestamp(group.at(-1).source_timestamp),
    occurrence_count: group.length,
    repost_same_offer_count: Math.max(0, group.length - 1),
    source_price_amount: group.at(-1).source_price_amount || null,
    source_currency: group.at(-1).source_currency || null,
    latest_parent_key: group.at(-1).parent_key,
  }));
  return {
    offer_family_key: latest.offer_family_key,
    brand: latest.brand,
    observed_reference: latest.observed_reference,
    observed_reference_key: latest.observed_reference_key,
    intent: latest.intent,
    historical_observations: sorted.length,
    distinct_offer_states: stateCount,
    repost_collapsed: repostCollapsed,
    historical_only: historicalOnly,
    price_change_states: Math.max(0, new Set(sorted.map(row => `${row.source_currency || ''}|${row.source_price_amount || ''}`)).size - 1),
    current_status: currentStatus,
    status_unresolved: currentStatus === 'CURRENT_LATEST_STATE',
    latest_observation: latest,
    first_seen: normalizedTimestamp(sorted[0].source_timestamp),
    last_seen: normalizedTimestamp(latest.source_timestamp),
    states: stateRows,
  };
}

function isVerifiedUsd(observation) {
  return ['USD', 'USDT'].includes(String(observation.source_currency || '').toUpperCase())
    && Number(observation.source_price_amount) > 0
    && ['SOURCE_EXPLICIT_USD_MATCH', 'SOURCE_EXPLICIT_USD_USDT', 'AUTO_APPROVED', 'VERIFIED_IN_NEW_COHORT']
      .includes(String(observation.price_evidence_classification || ''));
}

function isQualifiedComparable(observation) {
  return observation.intent === 'WTS' && Boolean(observation.observed_reference_key)
    && isVerifiedUsd(observation) && !terminalClassification(observation);
}

function displayTier(observation) {
  const image = observation.image_linked === true;
  const price = isVerifiedUsd(observation);
  if (image && price) return 'IMAGE_AND_PRICE';
  if (image) return 'IMAGE_ONLY';
  if (price) return 'PRICE_ONLY';
  return 'NEITHER';
}

function matchesShadowFilters(row, filters = {}) {
  if (filters.brand?.length && !filters.brand.includes(row.brand)) return false;
  if (filters.intent?.length && !filters.intent.includes(row.intent)) return false;
  if (filters.priced === true && !isVerifiedUsd(row)) return false;
  if (filters.images === true && row.image_linked !== true) return false;
  if (filters.locations?.length && !filters.locations.includes(row.country_code)) return false;
  const query = String(filters.search || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (query && !String(row.observed_reference_key || '').includes(query)
    && !String(row.search_text || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(query)) return false;
  return true;
}

module.exports = {
  ACTIVE_STATUSES,
  INVALID_CHILD_CLASSIFICATIONS,
  TERMINAL_STATUSES,
  classifyOfferFamily,
  createObservationIdentity,
  displayTier,
  effectiveChildClassification,
  explicitBrandConflict,
  explicitActiveStatus,
  familyIdentityMaterial,
  identityText,
  isQualifiedComparable,
  isVerifiedUsd,
  matchesShadowFilters,
  specificFragmentClassification,
  terminalClassification,
};
