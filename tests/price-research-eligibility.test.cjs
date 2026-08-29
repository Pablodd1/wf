'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDemandItemEligibility,
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

test('excludes an explicit watch-part sale without excluding a complete watch on a strap', () => {
  assert.equal(classifyResearchEligibility({
    ...valid,
    raw_message: 'Black Ceramic Bezel for 116500LN Rolex Daytona Steel *$2,400*',
  }, catalog), 'WATCH_PART_ACCESSORY');
  assert.equal(classifyResearchEligibility({
    ...valid,
    raw_message: 'Rolex Daytona 116500LN watch on black strap $25,000',
  }, catalog), null);
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

test('admits enabled reviewed-brand human-review WTS candidates to evidence gates only', () => {
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, verdict: 'Human Review' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Patek Philippe', verdict: 'NEEDS_REVIEW' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Audemars Piguet', verdict: 'NEEDS_REVIEW' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Richard Mille', verdict: 'NEEDS_REVIEW' }), true);
  assert.equal(isHumanReviewAnalyticsCandidate({ ...valid, brand: 'Cartier', verdict: 'NEEDS_REVIEW' }), true);
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

test('WTB demand requires an exact watch identity but not a dial, model, catalog match, or asking price', () => {
  assert.equal(classifyDemandEligibility({ ...valid, listing_type: 'WTB', price_usd: null }, catalog), null);
  assert.equal(classifyDemandEligibility({
    brand: 'Zenith', reference: '03.2522.400', listing_type: 'WTB', price_usd: null, dial_color: null, model: null,
  }, { found: false }), null);
  assert.equal(classifyDemandEligibility({
    brand: 'Omega', reference: '210.30.42.20.01.001', listing_type: 'WTB', price_usd: null, dial_color: 'Purple', model: null,
  }, { found: false }), null);
  assert.equal(classifyDemandEligibility({ ...valid, listing_type: 'WTS' }, catalog), 'NOT_WTB_DEMAND');
  assert.equal(classifyDemandEligibility({ ...valid, listing_type: 'WTB', bundle_candidate_count: 2 }, catalog), 'BUNDLE_SOURCE_UNSPLIT');
});

test('excludes explicit watch-part requests from complete-watch WTB demand', () => {
  const explicitParts = [
    'Looking for saphir glass for Daytona 116500Ln new eu dealer',
    'Looking to buy just the clasp for a Rolex Daytona 116500LN pm if you have',
    '*NEED ONE Stainless Steel Link for 5712/1A Patek*',
    'NTQ 1.5 Link for 5712/1A',
    'Need 1 or 2 links for 26240st anyone has?',
    'Need strap RM11-03 / 65-01 Red double vented size M exact Please DM',
    'WTB bracelet for RM11-03 please DM',
    'Looking for a band RM11-03, black only',
  ];
  for (const raw_message of explicitParts) {
    assert.equal(classifyDemandItemEligibility({ raw_message }), 'WATCH_PART_DEMAND');
    assert.equal(
      classifyDemandEligibility({ ...valid, listing_type: 'WTB', price_usd: null, raw_message }, catalog),
      'WATCH_PART_DEMAND',
    );
  }
});

test('does not guess that whole-watch configuration language is a spare part', () => {
  const wholeWatchRequests = [
    'WTB new movement new buckle 2022+ 5712/1A complete set unpolished',
    'Looking for 5712/1A BNIB with new clasp. Pls DM me',
    'WTB retail ready 116500ln black complete full links 2021+',
    'NTQ: Audemars Piguet 26240ST blue dial only complete set',
    'WTB RM11-03 complete set on black strap, 2024 or newer',
    'Need RM11-03 full set with original bracelet and papers',
    'Looking for RM11-03 watch on a red band, retail ready',
  ];
  for (const raw_message of wholeWatchRequests) {
    assert.equal(classifyDemandItemEligibility({ raw_message }), null);
  }
});

test('uses an explicit non-watch category as a fail-closed demand gate', () => {
  assert.equal(classifyDemandItemEligibility({ category: 'ACCESSORY' }), 'NOT_WATCH_DEMAND');
  assert.equal(classifyDemandItemEligibility({ item_category: 'JEWELRY' }), 'NOT_WATCH_DEMAND');
  assert.equal(classifyDemandItemEligibility({ category: 'WATCH' }), null);
});

test('Vacheron source-proven references remain tracked but cannot affect exact cohort analytics', () => {
  const row = {
    brand: 'Vacheron Constantin',
    model: 'Overseas',
    reference: '49150',
    dial_color: 'Blue',
    listing_type: 'WTS',
    price_usd: 25000,
    analytics_currency_status: 'VERIFIED',
    publication_lane: 'QNSA_VACHERON_OVERSEAS_RELEASE_V1',
    catalog_reference_confirmed: false,
    owner_reviewed_identity: true,
  };
  assert.equal(classifyResearchEligibility(row, {
    found: true, model: 'Overseas', dialColors: ['Blue'],
  }), 'CATALOG_REFERENCE_UNCONFIRMED');
});
