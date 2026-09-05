'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JOHN_COHORTS, chooseCondition, quantileSample, reportCsv } = require('../tools/forecast-readiness/audit-live-cohorts.cjs');

test('always includes the five owner-reviewed references', () => {
  assert.deepEqual(JOHN_COHORTS.map(row => row.reference), ['5712/1A', '5712/1R', '3712/1A', '116500LN', '52506']);
});

test('samples high, middle, and low volume references deterministically', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ reference: `R${index}`, listing_count: 10 - index }));
  assert.deepEqual(quantileSample(rows, 5).map(row => row.reference), ['R0', 'R2', 'R5', 'R7', 'R9']);
});

test('chooses the largest exact New or Used dial cohort', () => {
  const condition = chooseCondition([
    { dial_color: 'Blue', condition: 'Unknown', count: 100 },
    { dial_color: 'Blue', condition: 'Used', count: 20 },
    { dial_color: 'Blue', condition: 'New', count: 40 },
    { dial_color: 'Black', condition: 'New', count: 80 },
  ], 'Blue');
  assert.equal(condition, 'New');
});

test('CSV exposes withholding evidence without future price values', () => {
  const csv = reportCsv([{
    sample_group: 'JOHN_REFERENCE', brand: 'Rolex', reference: '52506', dial: 'Blue', condition: 'New',
    http_ok: true, included_offers: 100, verified_dealers: 0, monthly_periods: 0,
    forecast_ready: false, withholding_reasons: ['MINIMUM_MONTHS_NOT_MET'], release_candidate: false,
    sample_capped: false, error: null,
  }]);
  assert.match(csv, /MINIMUM_MONTHS_NOT_MET/);
  assert.doesNotMatch(csv, /expected_price|lower|upper/);
});
