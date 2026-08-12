'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('Price Research visibly restores liquidity, WTB/WTS ratio and outlier analytics', () => {
  assert.match(source, /Liquidity, demand and outlier summary/);
  assert.match(source, /Featured listings for sale/);
  assert.match(source, /WTB \/ WTS ratio/);
  assert.match(source, /Statistical price outliers/);
  assert.match(source, /wtbDemandCount \/ qualifiedWtsCount/);
  assert.match(source, /3\.0× IQR fences/);
});

test('WTB demand section derives a live ratio when legacy indicators are unavailable', () => {
  assert.match(source, /const demandSupplyRatio = data\.liquidity\?\.wtb_fs_ratio \?\?/);
  assert.match(source, /qualifiedWtsCount > 0 \? demandCount \/ qualifiedWtsCount : null/);
  assert.match(source, /\{demandSupplyRatio\.toFixed\(2\)\}/);
});
