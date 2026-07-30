'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Price Research distinguishes live Trading Floor inventory from price-eligible evidence', () => {
  const api = read('api/live-release-summary.js');
  const page = read('src/pages/PriceResearch.tsx');

  assert.match(api, /two_brand_verified_trading_release_cache/);
  assert.match(api, /count: 'exact', head: true/);
  assert.match(api, /const BRANDS = \['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Panerai', 'Zenith'\]/);
  assert.match(api, /REVIEWED_ZENITH_RECORD_START/);
  assert.match(api, /REVIEWED_ZENITH_SOURCE/);
  assert.match(api, /brand === 'Zenith'[\s\S]*\? 'watch_records'/);
  assert.match(api, /\.eq\('listing_status', 'ACTIVE'\)/);
  assert.match(page, /\/api\/live-release-summary/);
  assert.match(page, /Live verified inventory/);
  assert.match(page, /Price charts use a narrower source-proven WTS subset/);
  assert.match(page, /live Trading Floor listings/);
});
