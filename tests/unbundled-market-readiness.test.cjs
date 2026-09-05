'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  criticalReferenceFamily,
  marketCandidate,
  summarizeComparablePrices,
} = require('../tools/multilisting/audit-normalized-market-readiness.cjs');

const valid = {
  review_bucket: 'review-ready', listing_type: 'WTS', exact_raw_lineage: true,
  catalog_confirmed: true, catalog_dial_confirmed: true, price_usd: 25000,
  price_currency: 'USD', blockers: [],
};

test('market readiness accepts only complete review candidates', () => {
  assert.equal(marketCandidate(valid), true);
  assert.equal(marketCandidate({ ...valid, review_bucket: 'held-multi-watch' }), false);
  assert.equal(marketCandidate({ ...valid, listing_type: 'WTB' }), false);
  assert.equal(marketCandidate({ ...valid, catalog_dial_confirmed: false }), false);
  assert.equal(marketCandidate({ ...valid, price_usd: null }), false);
  assert.equal(marketCandidate({ ...valid, blockers: ['MULTI_WATCH_STOCK_LIST'] }), false);
});

test('critical references include terminal catalog variants', () => {
  assert.equal(criticalReferenceFamily('5712/1R-001', 'Patek Philippe'), '5712/1R');
  assert.equal(criticalReferenceFamily('5712/1A', 'Patek Philippe'), '5712/1A');
  assert.equal(criticalReferenceFamily('52506', 'Audemars Piguet'), null);
  assert.equal(criticalReferenceFamily('57121R', 'Patek Philippe'), null);
});

test('market readiness applies the live plausibility floor before IQR', () => {
  const result = summarizeComparablePrices([244, 229487, 240000, 244184, 250000, 262000]);
  assert.equal(result.marketPriceFloorUsd, 60523);
  assert.equal(result.floorExcludedCount, 1);
  assert.equal(result.summary.analytics_ready, true);
  assert.equal(result.summary.stats.min, 229487);
});
