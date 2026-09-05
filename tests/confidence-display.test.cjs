'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function confidencePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

test('supports legacy zero-to-one confidence', () => assert.equal(confidencePercent(0.92), 92));
test('supports database zero-to-100 confidence', () => assert.equal(confidencePercent(92), 92));
test('never displays more than 100 percent', () => assert.equal(confidencePercent(1000), 100));
test('handles invalid confidence safely', () => assert.equal(confidencePercent(Number.NaN), 0));
