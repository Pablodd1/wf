'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const floor = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const api = require('../api/reviewed-market-inventory.js');

test('Trading Floor serializes selected brands as repeated query parameters', () => {
  assert.match(floor, /searchParams\.getAll\('brand'\)/);
  assert.match(floor, /brandFilters\.forEach\(brand => params\.append\('brand', brand\)\)/);
  assert.match(floor, /value\.filter\(Boolean\)\.forEach\(entry => next\.append\(key, entry\)\)/);
  assert.match(floor, /checked=\{brands\.includes\(value\)\}/);
  assert.match(floor, /active=\{draftBrands\.includes\(value\)\}/);
  assert.match(floor, /dateFilter = DATE_OPTIONS/);
  assert.match(floor, /exactReference = searchParams\.get\('reference'\)/);
});

test('server applies multi-brand OR through independent indexed streams before cursor merge', () => {
  assert.match(apiSource, /Array\.isArray\(req\.query\?\.brand\)/);
  assert.match(apiSource, /const streamBrands = sixBrandScope/);
  assert.match(apiSource, /Promise\.all\(streamBrands\.map\(brandName/);
  assert.match(apiSource, /p_brand: brandName/);
  assert.match(apiSource, /p_listing_type: listingType \|\| null/);
  assert.match(apiSource, /p_has_image: requestedLane === 'images'/);
  assert.match(apiSource, /pendingMigration: 'Extend qnsa_six_brand_image_lane_page/);
  assert.match(apiSource, /This Trading Floor cursor belongs to a different multi-brand selection/);
});

test('composite cursor binds the selected brand scope', () => {
  const keysets = {
    Rolex: { hasPrice: true, createdAt: '2026-08-15T12:00:00.000Z', id: '00000000-0000-4000-8000-000000000001' },
    'Patek Philippe': { hasPrice: false, createdAt: '2026-08-14T12:00:00.000Z', id: '00000000-0000-4000-8000-000000000002' },
  };
  const token = api.encodeInventoryCursor({
    lane: 'images', offset: 0, page: 2, brandKeysets: keysets,
    brandScope: ['Rolex', 'Patek Philippe'],
  });
  const parsed = api.parseInventoryCursor(token, 50);
  assert.deepEqual(parsed.brandScope, ['Rolex', 'Patek Philippe']);
  assert.deepEqual(parsed.brandKeysets, keysets);
});

test('frontend does not re-filter a cursor page after the server returns it', () => {
  assert.match(floor, /const visibleListings = useMemo\(\(\) => \[\.\.\.listings\]\.sort\(compareListingsForDisplay\), \[listings\]\)/);
  assert.doesNotMatch(floor, /const visibleListings = useMemo\(\(\) => listings\.filter/);
});
