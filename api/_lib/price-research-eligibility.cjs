'use strict';

const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');
const { isLikelyYearAsPrice, isReferencePriceCollision } = require('./trading-record-safety.cjs');

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
    && ['ROLEX', 'PATEK PHILIPPE'].includes(brand)
    && HUMAN_REVIEW_VERDICTS.has(normalizedStatus(row.verdict))
    && normalizedStatus(row.listing_type) === 'WTS'
    && !statuses.some(status => ANALYTICS_BLOCKED_STATUSES.has(status))
  );
}

function classifyResearchEligibility(row, catalog) {
  const price = Number(row?.price_usd);
  const ownerReviewedIdentity = row?.owner_reviewed_identity === true;
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
  return classifyResearchEligibility({
    ...row,
    listing_type: 'WTS',
    price_raw: null,
    price_usd: 1,
    analytics_currency_status: 'VERIFIED',
  }, catalog);
}

module.exports = {
  ANALYTICS_BLOCKED_STATUSES,
  HUMAN_REVIEW_VERDICTS,
  classifyDemandEligibility,
  classifyResearchEligibility,
  isHumanReviewAnalyticsCandidate,
  isMultiListingSentinel,
};
