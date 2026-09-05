'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditResult, deriveCohortTargets } = require('../tools/price-quality/audit-all-price-research-cohorts.cjs');

test('flags a Price Research response that exposes statistics below the minimum sample', () => {
  const result = auditResult({ brand: 'Rolex', reference: '123', dial: 'Blue', condition: 'Used' }, {
    count: 2, totalListings: 2, analytics_ready: false, stats: { avg: 100 }, rawCount: 2,
  });
  assert.equal(result.status, 'ANALYTICAL_REVIEW');
  assert.ok(result.issues.includes('STATS_BELOW_MINIMUM'));
});

test('treats a capped sample as a coverage limitation rather than a broken contract', () => {
  const result = auditResult({ brand: 'Rolex', reference: '123' }, {
    count: 5, totalListings: 5, analytics_ready: true, stats: { min: 10000, max: 20000 }, sampleCapped: true,
  });
  assert.equal(result.status, 'OK');
  assert.equal(result.sample_capped, true);
});

test('flags extreme retained spread in a small eligible cohort for human analysis', () => {
  const result = auditResult({ brand: 'Patek Philippe', reference: '5712/1R', dial: 'Black', condition: 'New' }, {
    count: 7, totalListings: 8, analytics_ready: true, stats: { min: 229487, max: 1050000 },
  });
  assert.equal(result.status, 'ANALYTICAL_REVIEW');
  assert.ok(result.issues.includes('SMALL_COHORT_HIGH_SPREAD'));
});

test('creates every condition target for discovered dial groups', () => {
  const targets = deriveCohortTargets({ brand: 'Rolex', reference: '123', discovered_dials: ['Blue', 'White'] });
  assert.equal(targets.length, 8);
  assert.deepEqual(targets[0], { brand: 'Rolex', reference: '123', dial: 'Blue', condition: 'All' });
});
