'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BATCH_SIZE, DEFAULT_BRANDS, groupSummary, referenceKey } = require('../tools/audit/seven-brand-price-research-coverage-live.cjs');

test('seven-brand audit stays within the deployed batch contract', () => {
  assert.equal(BATCH_SIZE, 24);
  assert.deepEqual(DEFAULT_BRANDS, [
    'Tudor', 'Cartier', 'TAG Heuer', 'Patek Philippe', 'Rolex', 'Zenith', 'Omega',
  ]);
});

test('reference identity ignores punctuation but preserves brand scope', () => {
  assert.equal(referenceKey('Patek Philippe', '5712/1A-001'), 'PATEK PHILIPPE|57121A001');
  assert.notEqual(referenceKey('Patek Philippe', '5712/1A-001'), referenceKey('Rolex', '5712/1A-001'));
});

test('coverage summaries separate observed, qualified, ready, missing, capped and failed references', () => {
  const summary = groupSummary([
    { brand: 'Zenith', model: 'Defy', source_observation_count: 3, wts_observation_count: 2, wtb_observation_count: 1, reference_qualified_wts_count: 2, reference_analytics_ready: true, sample_capped: true },
    { brand: 'Zenith', model: 'Defy', source_observation_count: 0, wts_observation_count: 0, wtb_observation_count: 0, reference_qualified_wts_count: 0, reference_analytics_ready: false },
    { brand: 'Zenith', model: 'Defy', error: 'SOURCE_UNAVAILABLE' },
  ], 'model')[0];
  assert.deepEqual(summary, {
    brand: 'Zenith',
    model: 'Defy',
    catalog_references: 3,
    references_with_observations: 1,
    references_with_wts: 1,
    references_with_qualified_wts: 1,
    references_analytics_ready: 1,
    references_without_observations: 1,
    bounded_source_observations: 3,
    bounded_wts_observations: 2,
    bounded_wtb_observations: 1,
    capped_references: 1,
    failed_references: 1,
  });
});
