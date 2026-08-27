'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const floor = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('All inventory combines the complete Rolex and Patek shadow feeds', () => {
  assert.match(floor, /RANDOM_ALL_INVENTORY_BRANDS = \['Rolex', 'Patek Philippe'\]/);
  assert.match(floor, /Promise\.all\(RANDOM_ALL_INVENTORY_BRANDS\.map/);
  assert.match(floor, /brandTotals\[brand\] = Number\(payload\.total\) \|\| 0/);
  assert.match(floor, /total \+= brandTotals\[brand\]/);
  assert.match(floor, /publicationBrands: \[\.\.\.RANDOM_ALL_INVENTORY_BRANDS\]/);
  assert.doesNotMatch(floor, /records\.slice\(0,\s*(?:12|24|50)\)/);
});

test('random landing pages preserve an independent cursor for every full feed', () => {
  assert.match(floor, /brandCursors: Record<string, string \| null>/);
  assert.match(floor, /brandTotals: Record<string, number>/);
  assert.match(floor, /exhausted: Record<string, boolean>/);
  assert.match(floor, /if \(brandCursor\) params\.set\('cursor', brandCursor\)/);
  assert.match(floor, /nextCursor: hasMore \? encodeRandomAllInventoryCursor/);
  assert.match(floor, /seededPageShuffle\(records, stableSeed, page\)/);
});

test('brand, search, and filter requests retain the established API path', () => {
  assert.match(floor, /const randomAllInventory = categoryFilter === 'all'[\s\S]*!imagesOnly && !pricedOnly/);
  assert.match(floor, /if \(randomAllInventory\) \{[\s\S]*loadRandomAllInventory/);
  assert.match(floor, /else \{[\s\S]*fetch\(`\$\{endpoint\}\?\$\{params\.toString\(\)\}`/);
});
