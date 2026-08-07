'use strict';

const { comparisonKey, normalizeDialValue, uniqueCatalogDials } = require('./dial-normalization.cjs');
const { isLikelyYearAsPrice, isReferencePriceCollision } = require('./trading-record-safety.cjs');

function isMultiListingSentinel(value) {
  return /^(?:multiple|multi|mixed)$/i.test(String(value || '').trim());
}

function classifyResearchEligibility(row, catalog) {
  const type = String(row?.listing_type || row?.intent || '').trim().toUpperCase();
  if (type === 'WTB') return 'BUY_REQUEST_NOT_SALE';
  const price = Number(row?.price_usd);
  const ownerReviewedIdentity = row?.owner_reviewed_identity === true;
  if (Number(row?.bundle_candidate_count || 0) > 1) return 'BUNDLE_SOURCE_UNSPLIT';
  if ([row?.model, row?.dial_color].some(isMultiListingSentinel)) return 'BUNDLE_SOURCE_UNSPLIT';
  if (!row?.brand || String(row.brand).trim().toUpperCase() === 'UNKNOWN') return 'MISSING_BRAND';
  if (!row?.reference) return 'MISSING_REFERENCE';
  if ((!catalog?.found || !catalog.model) && !ownerReviewedIdentity) return 'CATALOG_MODEL_UNCONFIRMED';
  if (!Number.isFinite(price) || price <= 0) return 'MISSING_PRICE';
  if (row?.analytics_currency_status && row.analytics_currency_status !== 'VERIFIED') return row.analytics_currency_status;
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
  return classifyResearchEligibility({ ...row, price_raw: null, price_usd: 1 }, catalog);
}

module.exports = { classifyDemandEligibility, classifyResearchEligibility, isMultiListingSentinel };
