'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('Price Research visibly preserves qualified WTS and WTB demand without the outlier summary card', () => {
  assert.match(source, /Liquidity and demand summary/);
  assert.match(source, /Featured listings for sale/);
  assert.match(source, /WTB \/ WTS ratio/);
  assert.doesNotMatch(source, /Statistical price outliers/);
  assert.match(source, /wtbDemandCount \/ qualifiedWtsCount/);
  assert.match(source, /Q1 - 3\.0 \* IQR <= price <= Q3 \+ 3\.0 \* IQR/);
  assert.match(source, /Exclusions remain preserved for authorized audit and analysis/);
});

test('Reference activity is replaced by WTS-first inventory and separate WTB demand', () => {
  assert.doesNotMatch(source, />Reference activity</);
  assert.match(source, /data-testid="wtb-demand-summary"/);
  assert.match(source, /Demand Signals \(WTB\)/);
  assert.match(source, /WTS listings for sale/);
  assert.match(source, /Previous WTS/);
  assert.match(source, /Next WTB/);
});

test('WTB demand section derives a live ratio when legacy indicators are unavailable', () => {
  assert.match(source, /const demandSupplyRatio = data\.liquidity\?\.wtb_fs_ratio \?\?/);
  assert.match(source, /qualifiedWtsCount > 0 \? demandCount \/ qualifiedWtsCount : null/);
  assert.match(source, /\{demandSupplyRatio\.toFixed\(2\)\}/);
});
