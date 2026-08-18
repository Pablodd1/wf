'use strict';

const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');
const { isLikelyYearAsPrice, isReferencePriceCollision } = require('./trading-record-safety.cjs');
const { classifyWatchPartListing } = require('./watch-item-classification.cjs');

function isMultiListingSentinel(value) {
  return /^(?:multiple|multi|mixed)$/i.test(String(value || '').trim());
}

const HUMAN_REVIEW_VERDICTS = new Set([
  'HUMAN REVIEW',
  'HUMAN_REVIEW',
  'NEEDS REVIEW',
  'NEEDS_REVIEW',
]);

const ANALYTICS_BLOCKED_STATUSES = new Set([
  'HIDDEN',
  'REJECTED',
  'DELETED',
  'ARCHIVED',
  'BUNDLE_CHILD_PENDING_REVIEW',
  'BUNDLE_PENDING_SEPARATION',
  'SUPPRESSED_EXACT_DUPLICATE',
]);

function normalizedStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function isHumanReviewAnalyticsCandidate(row) {
  const brand = normalizedStatus(row?.brand);
  const statuses = [
    row?.listing_status,
    row?.trading_floor_status,
    row?.normalization_status,
  ].map(normalizedStatus).filter(Boolean);
  return Boolean(
    row
    && ['ROLEX', 'PATEK PHILIPPE', 'AUDEMARS PIGUET', 'RICHARD MILLE', 'CARTIER', 'ZENITH'].includes(brand)
    && HUMAN_REVIEW_VERDICTS.has(normalizedStatus(row.verdict))
    && normalizedStatus(row.listing_type) === 'WTS'
    && !statuses.some(status => ANALYTICS_BLOCKED_STATUSES.has(status))
  );
}

function classifyResearchEligibility(row, catalog) {
  const price = Number(row?.price_usd);
  const ownerReviewedIdentity = row?.owner_reviewed_identity === true;
  if (classifyWatchPartListing(row)) return 'WATCH_PART_ACCESSORY';
  if (Number(row?.bundle_candidate_count || 0) > 1) return 'BUNDLE_SOURCE_UNSPLIT';
  if ([row?.model, row?.dial_color].some(isMultiListingSentinel)) return 'BUNDLE_SOURCE_UNSPLIT';
  if (!row?.brand || String(row.brand).trim().toUpperCase() === 'UNKNOWN') return 'MISSING_BRAND';
  if (!row?.reference) return 'MISSING_REFERENCE';
  if ((!catalog?.found || !catalog.model) && !ownerReviewedIdentity) return 'CATALOG_MODEL_UNCONFIRMED';
  if (!Number.isFinite(price) || price <= 0) return 'MISSING_PRICE';
  if (row?.listing_type && normalizedStatus(row.listing_type) !== 'WTS') return 'NOT_WTS_SALE';
  if (row?.analytics_currency_status !== 'VERIFIED') {
    return row?.analytics_currency_status || 'CURRENCY_UNVERIFIED';
  }
  if (isReferencePriceCollision(row)) return 'REFERENCE_TOKEN_AS_PRICE';
  if (isLikelyYearAsPrice(row)) return 'YEAR_TOKEN_AS_PRICE';

  const dial = normalizeDialValue(row?.dial_color);
  if (!dial.known) return 'MISSING_DIAL';
  const catalogDials = uniqueCatalogDials(catalog.dialColors || []);
  if (!catalogDials.length && !ownerReviewedIdentity) return 'CATALOG_DIAL_UNCONFIRMED';
  const dialKey = comparisonKey(dial.value);
  if (catalogDials.length && !catalogDials.some(value => dialKey === comparisonKey(value)) && !ownerReviewedIdentity) {
    return 'CATALOG_DIAL_MISMATCH';
  }
  return null;
}

function classifyDemandEligibility(row, catalog) {
  const itemReason = classifyDemandItemEligibility(row);
  if (itemReason) return itemReason;
  return classifyResearchEligibility({
    ...row,
    listing_type: 'WTS',
    price_raw: null,
    price_usd: 1,
    analytics_currency_status: 'VERIFIED',
  }, catalog);
}

// Demand analytics describe buyers seeking a complete watch. A canonical
// reference in the message is not enough when the preserved raw evidence says
// the requested object is a spare part. Keep this deliberately conservative:
// configuration phrases such as "new clasp", "full links", and "blue dial
// only" may still describe a complete watch and must not be auto-reclassified.
const EXPLICIT_WATCH_PART_REQUESTS = [
  /\b(?:looking\s+(?:for|to\s+buy)|need|wtb|ltb|ntq)\b[^\n.!?]{0,80}\b(?:saphir|sapphire)\s+(?:glass|crystal)\s+for\b/i,
  /\b(?:looking\s+(?:for|to\s+buy)|need|wtb|ltb|ntq)\b[^\n.!?]{0,80}\bjust\s+the\s+(?:clasp|buckle|bracelet|strap|band|bezel|crystal|glass|movement|case)\s+for\b/i,
  /\b(?:looking\s+(?:for|to\s+buy)|need|wtb|ltb|ntq)\b[^\n.!?]{0,80}\b(?:one|two|1(?:\.\d+)?|2)\s+(?:stainless\s+steel\s+)?links?\s+for\b/i,
  /^\s*(?:looking\s+(?:for|to\s+buy)|need|wtb|ltb|ntq)\s+(?:just\s+)?(?:a\s+|one\s+|the\s+)?(?:strap|band|bracelet|clasp|buckle|bezel|crystal|glass|movement|case|part)\b(?:\s+for)?\s+[A-Z0-9]/i,
];

function classifyDemandItemEligibility(row) {
  const category = normalizedStatus(row?.category || row?.item_category);
  if (category && category !== 'WATCH') return 'NOT_WATCH_DEMAND';
  const rawMessage = String(row?.raw_message || '');
  return EXPLICIT_WATCH_PART_REQUESTS.some(pattern => pattern.test(rawMessage))
    ? 'WATCH_PART_DEMAND'
    : null;
}

module.exports = {
  ANALYTICS_BLOCKED_STATUSES,
  HUMAN_REVIEW_VERDICTS,
  classifyDemandItemEligibility,
  classifyDemandEligibility,
  classifyResearchEligibility,
  isHumanReviewAnalyticsCandidate,
  isMultiListingSentinel,
};
