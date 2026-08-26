'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyOfferFamily,
  createObservationIdentity,
  displayTier,
  effectiveChildClassification,
  matchesShadowFilters,
} = require('../tools/audit/current-inventory-shadow-lib.cjs');

function observation(overrides = {}) {
  const row = {
    parent_key: 'parent-a', raw_occurrence_key: 'occ-a', source_identity_key: 'source-a',
    brand: 'Rolex', observed_reference: '126334', observed_reference_key: '126334', intent: 'WTS',
    raw_child_text: 'Rolex 126334 blue dial USD 13,500', source_price_text: 'USD 13,500',
    source_price_amount: 13500, source_currency: 'USD', price_evidence_classification: 'AUTO_APPROVED',
    normalized_structural_text_sha256: 'struct-a', source_timestamp: '2026-01-01T00:00:00Z',
    disposition: {}, image_linked: true, source_image_key: 'image-a', country_code: 'US',
    classification: 'UNIQUE_MARKET_OBSERVATION',
    ...overrides,
  };
  return { ...row, ...createObservationIdentity(row) };
}

test('unchanged reposts collapse to one current family state', () => {
  const first = observation();
  const second = observation({ parent_key: 'parent-b', raw_occurrence_key: 'occ-b',
    source_timestamp: '2026-02-01T00:00:00Z', disposition: { published: true } });
  const family = classifyOfferFamily([first, second]);
  assert.equal(first.offer_family_key, second.offer_family_key);
  assert.equal(first.offer_state_key, second.offer_state_key);
  assert.equal(family.repost_collapsed, 1);
  assert.equal(family.current_status, 'CURRENT_ACTIVE');
});

test('price changes retain one family and create a historical state', () => {
  const first = observation();
  const second = observation({ parent_key: 'parent-b', raw_occurrence_key: 'occ-b',
    raw_child_text: 'Rolex 126334 blue dial USD 14,200', source_price_text: 'USD 14,200',
    source_price_amount: 14200, normalized_structural_text_sha256: 'struct-b',
    source_timestamp: '2026-02-01T00:00:00Z' });
  assert.equal(first.offer_family_key, second.offer_family_key);
  assert.notEqual(first.offer_state_key, second.offer_state_key);
  const family = classifyOfferFamily([first, second]);
  assert.equal(family.price_change_states, 1);
  assert.equal(family.historical_only, 1);
});

test('material dial text keeps same-reference watches distinct', () => {
  const blue = observation();
  const wimbledon = observation({ raw_child_text: 'Rolex 126334 Wimbledon USD 14,800',
    source_price_text: 'USD 14,800', source_price_amount: 14800, source_image_key: 'image-b' });
  assert.notEqual(blue.offer_family_key, wimbledon.offer_family_key);
});

test('unresolved sources never collapse across parents', () => {
  const first = observation({ source_identity_key: null, dealer_key: null });
  const second = observation({ source_identity_key: null, dealer_key: null, parent_key: 'parent-b' });
  assert.notEqual(first.offer_family_key, second.offer_family_key);
});

test('specific parser fragments fail the child gate', () => {
  assert.equal(effectiveChildClassification(observation({ raw_child_text: '+1 (212) 555-1212' })), 'NON_WATCH_FRAGMENT');
  assert.equal(effectiveChildClassification(observation({ raw_child_text: 'USD 13500' })), 'FIELD_ONLY_FRAGMENT');
  assert.equal(effectiveChildClassification(observation({ raw_child_text: 'Rolex bracelet 20mm' })), 'NON_WATCH_FRAGMENT');
});

test('only the six review classifications may survive the child gate', () => {
  assert.equal(effectiveChildClassification(observation({ classification: 'UNKNOWN_PARSER_LABEL' })), 'REVIEW_REQUIRED');
});

test('explicit foreign-brand evidence vetoes parent-brand fallback', () => {
  assert.equal(effectiveChildClassification(observation({
    observed_brand: 'Rolex', exact_observed_reference: 'RM07-01WG',
    raw_child_text: 'Richard Mille RM07-01 WG USD 180000',
  })), 'REVIEW_REQUIRED');
  assert.equal(effectiveChildClassification(observation({
    observed_brand: 'Patek Philippe', exact_observed_reference: 'RM65-01',
    raw_child_text: 'RM65-01 USD 250000',
  })), 'REVIEW_REQUIRED');
  assert.equal(effectiveChildClassification(observation({
    observed_brand: 'Rolex', exact_observed_reference: 'W4BB0023',
    raw_child_text: 'W4BB0023 USD 9000',
  })), 'REVIEW_REQUIRED');
  assert.equal(effectiveChildClassification(observation({
    observed_brand: 'Patek Philippe', exact_observed_reference: 'WT100022',
    raw_child_text: 'WT100022 USD 12000',
  })), 'REVIEW_REQUIRED');
  assert.equal(effectiveChildClassification(observation({
    observed_brand: 'Patek Philippe', exact_observed_reference: 'Q9068670',
    raw_child_text: 'Q9068670 USD 4800',
  })), 'REVIEW_REQUIRED');
});

test('withdrawn latest state yields no current family', () => {
  const row = observation({ source_status: 'WITHDRAWN' });
  assert.equal(classifyOfferFamily([row]).current_status, 'WITHDRAWN');
});

test('only explicit source-active semantics can promote an unpublished family', () => {
  assert.equal(classifyOfferFamily([observation({ source_status: 'AVAILABLE' })]).current_status, 'CURRENT_ACTIVE');
  assert.equal(classifyOfferFamily([observation({ source_status: null })]).current_status, 'CURRENT_LATEST_STATE');
});

test('display tiers and server-side filter semantics remain source-backed', () => {
  const row = observation();
  assert.equal(displayTier(row), 'IMAGE_AND_PRICE');
  assert.equal(matchesShadowFilters(row, { search: '126334', priced: true, images: true,
    locations: ['US', 'HK'] }), true);
  assert.equal(matchesShadowFilters(row, { locations: ['HK', 'GB'] }), false);
});
