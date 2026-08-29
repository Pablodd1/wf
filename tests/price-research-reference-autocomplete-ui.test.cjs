'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

test('Price Research loads bounded catalog suggestions without silently rewriting typed text', () => {
  assert.match(source, /\/api\/catalog-suggestions/);
  assert.match(source, /limit: '10'/);
  assert.match(source, /setSelectedCatalogReference\(null\);\s*setQuery\(event\.target\.value\)/);
  assert.match(source, /selectReferenceSuggestion\(suggestion\)/);
});

test('Price Research autocomplete requires explicit selection before analytics load', () => {
  assert.match(source, /void fetchData\(suggestion\.reference, '', suggestion\.brand\)/);
  assert.match(source, /Select an exact catalog reference to load its market analytics/);
  assert.doesNotMatch(source, /list="price-reference-suggestions"/);
});

test('Price Research autocomplete supports accessible keyboard selection', () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.match(source, new RegExp(key));
});
