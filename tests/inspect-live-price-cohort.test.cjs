'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCohortRow } = require('../tools/price-quality/inspect-live-price-cohort.cjs');

test('flags a selected cohort row whose raw source is a multilist message', () => {
  const result = classifyCohortRow({
    id: 'row-1', api_price_usd: 1050000, price_usd: 480000, reference: '5712/1R',
    raw_message: '5712/1R 2025 new HKD 1.9M\n4300V/220G 2025 new USD 1050000',
  }, '5712/1R');
  assert.ok(result.issues.includes('MULTILISTING_OR_BUNDLE_SOURCE'));
});
