'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('Trading Floor loads bounded catalog suggestions without changing the typed value automatically', () => {
  assert.match(source, /\/api\/catalog-suggestions/);
  assert.match(source, /limit: '10'/);
  assert.match(source, /setSelectedCatalogReference\(null\);\s*setSearchInput\(event\.target\.value\)/);
  assert.match(source, /selectCatalogSuggestion\(suggestion\)/);
});

test('Trading Floor reference autocomplete exposes accessible combobox keyboard behavior', () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.match(source, new RegExp(key));
});

test('an explicit catalog selection connects Trading Floor and Price Research', () => {
  assert.match(source, /updateViewParams\(\{ q: selectedSearch, reference: suggestion\.reference, brand: suggestion\.brand \}\)/);
  assert.match(source, /params\.set\('reference', exactReference\)/);
  assert.match(source, /if \(search && !exactReference\) params\.set\('q', search\)/);
  assert.match(source, /Open Price Research/);
  assert.match(source, /selectedCatalogReference\.reference/);
});
