'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWtsReconciliation } = require('../api/_lib/price-research-reconciliation.cjs');

test('accounts for one selected dial without mislabeling other dials and reposts as unpriced', () => {
  const result = buildWtsReconciliation({
    analyticsRowsCount: 838,
    includedCount: 199,
    requiredFieldReasonCounts: { MISSING_PRICE: 120, MISSING_DIAL: 151 },
    requiredFieldExclusionsCount: 271,
    repostCount: 127,
    marketRowsCount: 440,
    listedRowsCount: 241,
    outliersCount: 42,
    unsplitBundlesCount: 0,
  });

  assert.deepEqual(result, {
    included: 199,
    excluded: 639,
    breakdown: {
      unpriced: 120,
      required_field_failures: 151,
      reposts_counted_once: 127,
      other_dial_cohorts: 199,
      outliers: 42,
      unsplit_bundles: 0,
      suppressed_duplicates: 0,
    },
    loaded: 838,
    reconciles: true,
  });
});

test('reports a failed invariant rather than hiding an accounting gap', () => {
  const result = buildWtsReconciliation({
    analyticsRowsCount: 10,
    includedCount: 2,
    requiredFieldReasonCounts: {},
    requiredFieldExclusionsCount: 1,
    repostCount: 0,
    marketRowsCount: 2,
    listedRowsCount: 2,
    outliersCount: 0,
    unsplitBundlesCount: 0,
    duplicateSuppressedCount: 2,
  });
  assert.equal(result.reconciles, false);
  assert.equal(result.loaded, 12);
  assert.equal(result.included + result.excluded, 5);
});
