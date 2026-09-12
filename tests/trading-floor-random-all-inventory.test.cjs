'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const floor = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('All inventory combines the complete Rolex and Patek shadow feeds', () => {
  assert.match(floor, /RANDOM_ALL_INVENTORY_BRANDS = \['Rolex', 'Patek Philippe'\]/);
  assert.match(floor, /Promise\.all\(RANDOM_ALL_INVENTORY_BRANDS\.map/);
  assert.match(floor, /brandTotals\[brand\] = payload\.total != null[\s\S]*decoded\?\.brandTotals\?\.\[brand\] \|\| 0/);
  assert.match(floor, /total \+= brandTotals\[brand\]/);
  assert.match(floor, /publicationBrands: \[\.\.\.RANDOM_ALL_INVENTORY_BRANDS\]/);
  assert.doesNotMatch(floor, /records\.slice\(0,\s*(?:12|24|50)\)/);
});

test('combined landing pages preserve an independent cursor for every full feed', () => {
  assert.match(floor, /brandCursors: Record<string, string \| null>/);
  assert.match(floor, /brandTotals: Record<string, number>/);
  assert.match(floor, /exhausted: Record<string, boolean>/);
  assert.match(floor, /if \(brandCursor\) params\.set\('cursor', brandCursor\)/);
  assert.match(floor, /nextCursor: hasMore \? encodeRandomAllInventoryCursor/);
  assert.match(floor, /sort === 'discovery'[\s\S]*discoveryOrderWithinSourceLanes\(records, stableSeed, page\)[\s\S]*newestObservedOrder/);
  assert.match(floor, /listingLane: 'single' \| 'multi'/);
  assert.match(floor, /params\.set\('sourceShape', listingLane\)/);
  assert.match(floor, /scope: string/);
  assert.match(floor, /decoded\.scope !== scope/);
});

test('combined inventory applies supported filters to both brand streams', () => {
  assert.match(floor, /const combinedFeedActive = \['all', 'watches'\]\.includes\(categoryFilter\)[\s\S]*!brandFilter && !modelFilter && !search/);
  assert.match(floor, /const combinedAllInventory = !canaryEnabled && combinedFeedActive/);
  assert.match(floor, /if \(intent\) params\.set\('type', intent\)/);
  assert.match(floor, /if \(imagesOnly\) params\.set\('images', 'true'\)/);
  assert.match(floor, /if \(pricedOnly\) params\.set\('priced', 'true'\)/);
  assert.match(floor, /if \(countries\.length > 0\) params\.set\('region', countries\.join\(','\)\)/);
  assert.match(floor, /if \(combinedAllInventory\) \{[\s\S]*loadRandomAllInventory/);
  assert.match(floor, /else \{[\s\S]*fetch\(`\$\{endpoint\}\?\$\{params\.toString\(\)\}`/);
});
