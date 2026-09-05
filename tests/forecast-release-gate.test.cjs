'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('public forecasts use validated trends or an explicitly provisional median baseline', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  assert.match(source, /buildMarketForecast\(includedRows\)/);
  assert.match(source, /buildIndicativeForecast\(includedRows\)/);
  assert.match(source, /dial_trends/);
  assert.doesNotMatch(source, /FEATURE_NOT_RELEASED/);
});
