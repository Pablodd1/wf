'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildComparableCohorts,
  buildDialGroups,
  classifyPrice,
  marketPlausibilityFloor,
  summarizePrices,
} = require('../api/_lib/market-stats.cjs');

test('uses standard 3.0 IQR fences and preserves outliers separately', () => {
  const result = summarizePrices([100, 101, 102, 103, 104, 105, 500]);
  assert.equal(result.stats.iqr, 3);
  assert.equal(result.stats.upper_fence, 114);
  assert.deepEqual(result.outliers, [500]);
  assert.equal(result.included.length, 6);
  assert.equal(result.raw_count, 7);
  assert.equal(result.included_count, 6);
  assert.equal(result.outlier_count, 1);
  assert.equal(result.stats.iqr_multiplier, 3);
});

test('claims analytics readiness for two or more observations', () => {
  const result = summarizePrices([100, 110, 120, 1000]);
  assert.equal(result.analytics_ready, true);
  assert.equal(result.sample_quality, 'provisional');
  assert.deepEqual(result.outliers, []);
});

test('labels five to nine rows provisional and ten or more robust', () => {
  assert.equal(summarizePrices([1, 2, 3, 4, 5]).sample_quality, 'provisional');
  assert.equal(summarizePrices([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).sample_quality, 'robust');
});

test('merges condition variants into one analytics cohort per dial', () => {
  const cohorts = buildComparableCohorts([
    { condition: 'New', dial_color: 'Blue' },
    { condition: 'New', dial_color: 'Blue' },
    { condition: 'Used', dial_color: 'Blue' },
    { condition: 'New', dial_color: 'Green' },
  ]);
  assert.equal(cohorts.length, 2);
  assert.equal(cohorts[0].condition, 'All conditions');
  assert.equal(cohorts[0].dial_color, 'Blue');
  assert.equal(cohorts[0].count, 3);
  assert.deepEqual(cohorts[0].condition_counts, { New: 2, Used: 1 });
});

test('merges dial labels that differ only by case', () => {
  const cohorts = buildComparableCohorts([
    { condition: 'New', dial_color: 'Ice Blue' },
    { condition: 'New', dial_color: 'Ice blue' },
  ]);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].dial_color, 'Ice Blue');
  assert.equal(cohorts[0].count, 2);
});

test('groups one dial once while preserving condition counts', () => {
  const groups = buildDialGroups([
    { condition: 'New', dial_color: 'Blue' },
    { condition: 'Used', dial_color: 'Blue' },
    { condition: null, dial_color: 'blue' },
    { condition: 'New', dial_color: 'Green' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].dial_color, 'Blue');
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].condition_counts, { New: 1, Used: 1, Unspecified: 1 });
});

test('treats unknown and unspecified condition labels as one non-inferred cohort', () => {
  const rows = [
    { condition: 'Unknown', dial_color: 'Blue' },
    { condition: 'Unspecified', dial_color: 'Blue' },
    { condition: null, dial_color: 'Blue' },
  ];
  const cohorts = buildComparableCohorts(rows);
  const groups = buildDialGroups(rows);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].condition, 'All conditions');
  assert.equal(cohorts[0].count, 3);
  assert.deepEqual(cohorts[0].condition_counts, { Unspecified: 3 });
  assert.deepEqual(groups[0].condition_counts, { Unspecified: 3 });
});

test('classifies row-level outliers with an auditable reason', () => {
  const stats = summarizePrices([100, 101, 102, 103, 104, 105, 500]).stats;
  assert.deepEqual(classifyPrice(102, stats), { included: true, reason: null });
  assert.deepEqual(classifyPrice(90, stats), { included: false, reason: 'BELOW_IQR_FENCE' });
  assert.deepEqual(classifyPrice(500, stats), { included: false, reason: 'ABOVE_IQR_FENCE' });
  assert.deepEqual(classifyPrice(null, stats), { included: false, reason: 'INVALID_PRICE' });
});

test('rejects implausible watch prices before applying IQR fences', () => {
  const stats = { lower_fence: -1000, upper_fence: 100000 };
  assert.deepEqual(
    classifyPrice(244, stats, { minimumPrice: 1000 }),
    { included: false, reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' }
  );
  assert.deepEqual(classifyPrice(24000, stats, { minimumPrice: 1000 }), { included: true, reason: null });
});

test('uses a conservative cohort-relative luxury-watch plausibility floor', () => {
  assert.equal(marketPlausibilityFloor([20152, 109625, 130000, 172590, 239500]), 32500);
  assert.equal(marketPlausibilityFloor([244, 229487, 240000, 244184, 250000, 262000]), 60523);
});

