'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('Trading Floor provides complete three-brand entries without a reference restriction', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  assert.match(floor, /Browse all \{brand\}/);
  assert.match(floor, /\['Rolex', 'Patek Philippe', 'Audemars Piguet'\]/);
  assert.match(floor, /reference: null, brand, item: 'watches'/);
});

test('Price Research explains the all-reference Rolex autocomplete workflow', () => {
  const research = read('src/pages/PriceResearch.tsx');
  assert.match(research, /queryBrand === 'Rolex'/);
  assert.match(research, /All available Rolex references are searchable/);
  assert.match(research, /WTS prices, WTB demand, users, raw listings, and charts/);
  assert.match(research, /\/api\/catalog-suggestions/);
});
