'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cohortKey, evaluateSourceRow, normalizeCheckpointState } = require('../tools/price-quality/audit-source-price-cohorts.cjs');

test('source audit rejects an emoji-bullet parent before it can publish a price', () => {
  const result = evaluateSourceRow({
    brand: 'Patek Philippe', reference: '5712/1R', price_usd: 480000,
    raw_message: '🚀 5712/1R 5/2025 NEW HKD 1.73m 🚀 5303R 5/2025 NEW 1.05m usdt',
  });
  assert.equal(result.gate, 'BUNDLE_SOURCE_UNSPLIT');
  assert.equal(result.derived_price_usd, 221795);
});

test('normalizes reference casing when grouping source audit cohorts', () => {
  assert.equal(
    cohortKey({ brand: 'Patek Philippe', reference: '5167R', dial_color: 'Brown', condition: 'New' }),
    cohortKey({ brand: 'Patek Philippe', reference: '5167r', dial_color: 'brown', condition: 'new' }),
  );
});

test('consolidates case-split checkpoint cohorts without losing counts', () => {
  const state = normalizeCheckpointState({
    cohorts: {
      'Patek Philippe|5167R|Brown|New': { brand: 'Patek Philippe', reference: '5167R', dial_color: 'Brown', condition: 'New', scanned: 2, eligible: 1, excluded: 1, gate_counts: { CURRENCY_AMBIGUOUS: 1 }, currency_status_counts: {}, price_normalization_counts: {} },
      'Patek Philippe|5167r|Brown|New': { brand: 'Patek Philippe', reference: '5167r', dial_color: 'Brown', condition: 'New', scanned: 3, eligible: 2, excluded: 1, gate_counts: { CURRENCY_UNVERIFIED: 1 }, currency_status_counts: {}, price_normalization_counts: {} },
    },
  });
  const cohorts = Object.values(state.cohorts);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].scanned, 5);
  assert.equal(cohorts[0].eligible, 3);
});
