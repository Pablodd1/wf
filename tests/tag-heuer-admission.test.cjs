'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const intake = require('../tools/intake/prepare-tag-heuer-admission.cjs');

function row(overrides = {}) {
  return {
    'Listing ID': 'tag-001',
    'Intent (WTS/WTB)': 'WTS',
    Category: 'WATCH',
    Brand: 'TAG Heuer',
    Model: 'Carrera',
    'Reference Number': 'CBL2111',
    'Trading Floor Status': 'published',
    'Price Research Status': 'eligible',
    'Full Image URL (DigitalOcean CDN)': 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/abc.jpg',
    'Image Key': 'abc.jpg',
    'Raw Post / Chat Message': 'TAG Heuer Carrera CBL2111 USD 5,000',
    ...overrides,
  };
}

test('TAG intake rewrites the known legacy Spaces image URL only at the adapter', () => {
  assert.equal(
    intake.sourceImageUrl('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/abc.jpg', 'abc.jpg'),
    'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/abc.jpg',
  );
});

test('TAG intake holds bundles, price-token references, and cross-brand models', () => {
  const decision = intake.classifyRow(row({
    Model: 'Daytona',
    'Reference Number': '18500HKD',
    'Trading Floor Status': 'bundle_pending_separation',
  }));
  assert.equal(decision.trading_floor_candidate, false);
  assert.equal(decision.price_research_candidate, false);
  assert.equal(decision.disposition, 'HOLD_FOR_REVIEW');
  assert.deepEqual(decision.reasons.filter(reason => reason !== 'IMAGE_PATH_CORRECTED_AT_ADAPTER'), [
    'BUNDLE_PENDING_SEPARATION',
    'REFERENCE_UNRESOLVED_OR_PRICE_TOKEN',
    'MODEL_BRAND_CONFLICT',
  ]);
});

test('TAG intake does not turn a workbook candidate into a public release', () => {
  const decision = intake.classifyRow(row());
  assert.equal(decision.trading_floor_candidate, true);
  assert.equal(decision.price_research_candidate, true);
  assert.equal(decision.disposition, 'REVIEW_REQUIRED');
  assert.match(decision.reasons.join('|'), /IMAGE_PATH_CORRECTED_AT_ADAPTER/);
});

test('TAG intake routes non-watch rows away from watch surfaces', () => {
  const decision = intake.classifyRow(row({ Category: 'JEWELRY' }));
  assert.equal(decision.trading_floor_candidate, false);
  assert.equal(decision.price_research_candidate, false);
  assert.match(decision.reasons.join('|'), /NON_WATCH_ROUTE_LUXURY_RESEARCH/);
});
