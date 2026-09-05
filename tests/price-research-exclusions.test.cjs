const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionExcludedEvidence } = require('../api/_lib/exclusion-summary.cjs');

test('keeps statistical outliers separate from required-field and repost exclusions', () => {
  const required = [{ id: 'missing-dial', outlier_reason: 'DIAL_REQUIRED' }];
  const reposts = [{ id: 'repost' }];
  const classified = [
    { id: 'included', is_outlier: false },
    { id: 'low-price', is_outlier: true, outlier_reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' },
    { id: 'iqr', is_outlier: true, outlier_reason: 'IQR_OUTLIER' },
    { id: 'invalid', is_outlier: true, outlier_reason: 'INVALID_PRICE' },
  ];

  const result = partitionExcludedEvidence(required, reposts, classified);
  assert.equal(result.statisticalOutlierRows.length, 2);
  assert.equal(result.repostExclusions.length, 1);
  assert.equal(result.allExcludedRows.length, 4);
  assert.equal(result.repostExclusions[0].outlier_reason, 'REPOST_DUPLICATE');
});
