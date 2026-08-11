'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDemandEligibility,
  classifyResearchEligibility,
  isHumanReviewAnalyticsCandidate,
} = require('../api/_lib/price-research-eligibility.cjs');

const catalog = { found: true, model: 'Cosmograph Daytona', dialColors: ['Black', 'White'] };
const valid = {
  brand: 'Rolex',
  reference: '116500LN',
  dial_color: 'Black',
  listing_type: 'WTS',
  price_usd: 25000,
  analytics_currency_status: 'VERIFIED',
};

test('accepts a complete catalog-consistent WTS observation', () => {
  assert.equal(classifyResearchEligibility(valid, catalog), null);
});

test('rejects a dial that is impossible for the cataloged reference', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, dial_color: 'Purple' }, catalog),
    'CATALOG_DIAL_MISMATCH',
  );
});

test('rejects white when the exact catalog configuration is silver', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, dial_color: 'White' }, { ...catalog, dialColors: ['Black', 'Silver'] }),
    'CATALOG_DIAL_MISMATCH',
  );
});

test('accepts a matching dial from a scalar legacy catalog field', () => {
  assert.equal(
    classifyResearchEligibility(
      { brand: 'Patek Philippe', reference: '3712/1A', dial_color: 'Blue', listing_type: 'WTS', price_usd: 120000, analytics_currency_status: 'VERIFIED' },
      { found: true, model: 'Nautilus Moon Phase', dialColors: 'Blue' },
    ),
    null,
  );
});

test('requires a catalog model, dial and price', () => {
  assert.equal(classifyResearchEligibility(valid, { found: true, model: null, dialColors: ['Black'] }), 'CATALOG_MODEL_UNCONFIRMED');
  assert.equal(classifyResearchEligibility({ ...valid, dial_color: 'Unknown' }, catalog), 'MISSING_DIAL');
  assert.equal(classifyResearchEligibility({ ...valid, price_usd: null }, catalog), 'MISSING_PRICE');
});

test('accepts owner-reviewed workbook identity without inventing catalog coverage', () => {
  const ownerReviewed = {
    brand: 'Zenith',
    reference: '0331003600',
    dial_color: 'Black',
    price_usd: 8000,
    listing_type: 'WTS',
    analytics_currency_status: 'VERIFIED',
    owner_reviewed_identity: true,
  };
  assert.equal(classifyResearchEligibility(ownerReviewed, { found: false }), null);
  assert.equal(
    classifyResearchEligibility({ ...ownerReviewed, dial_color: null }, { found: false }),
    'MISSING_DIAL',
  );
});

test('excludes a price whose reference-line currency proof is incomplete', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, analytics_currency_status: 'CURRENCY_AMBIGUOUS' }, catalog),
    'CURRENCY_AMBIGUOUS',
  );
});

test('excludes a priced row when explicit currency evidence is absent', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, analytics_currency_status: undefined }, catalog),
    'CURRENCY_UNVERIFIED',
  );
});

test('admits Rolex and Patek human-review WTS candidates to evidence gates only', () => {
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, verdict: 'Human Review' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Patek Philippe', verdict: 'NEEDS_REVIEW' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Omega', verdict: 'Human Review' }), false);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, listing_type: 'WTB', verdict: 'Human Review' }), false);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, verdict: 'Human Review', trading_floor_status: 'suppressed_exact_duplicate' }), false);
});

test('rejects unsplit bundle source rows from price analytics', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, bundle_candidate_count: 3 }, catalog),
    'BUNDLE_SOURCE_UNSPLIT',
  );
});

test('rejects multi-listing identity sentinels even for owner-reviewed rows', () => {
  const ownerReviewed = {
    ...valid,
    owner_reviewed_identity: true,
  };
  assert.equal(
    classifyResearchEligibility({ ...ownerReviewed, dial_color: 'multiple' }, { found: false }),
    'BUNDLE_SOURCE_UNSPLIT',
  );
  assert.equal(
    classifyResearchEligibility({ ...ownerReviewed, model: 'mixed' }, { found: false }),
    'BUNDLE_SOURCE_UNSPLIT',
  );
  assert.equal(
    classifyDemandEligibility({ ...ownerReviewed, dial_color: 'multi', price_usd: null }, { found: false }),
    'BUNDLE_SOURCE_UNSPLIT',
  );
});

test('rejects a numeric reference copied into the market price', () => {
  assert.equal(
    classifyResearchEligibility(
      { brand: 'Rolex', reference: '16610', dial_color: 'Black', listing_type: 'WTS', price_raw: 16610, price_usd: 16610, analytics_currency_status: 'VERIFIED' },
      catalog,
    ),
    'REFERENCE_TOKEN_AS_PRICE',
  );
});

test('rejects a year token copied into the market price', () => {
  assert.equal(
    classifyResearchEligibility({ ...valid, price_usd: 2025, price_raw: 2025 }, catalog),
    'YEAR_TOKEN_AS_PRICE',
  );
});

test('WTB demand requires identity and dial but not an asking price', () => {
  assert.equal(classifyDemandEligibility({ ...valid, listing_type: 'WTB', price_usd: null }, catalog), null);
  assert.equal(classifyDemandEligibility({ ...valid, listing_type: 'WTB', dial_color: 'Purple', price_usd: null }, catalog), 'CATALOG_DIAL_MISMATCH');
});
