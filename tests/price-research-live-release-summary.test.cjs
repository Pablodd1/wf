'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('legacy release summary remains isolated from the complete Price Research inventory', () => {
  const api = read('api/live-release-summary.js');
  const page = read('src/pages/PriceResearch.tsx');

  assert.match(api, /THREE_BRAND_RELEASE_CACHE === 'true'/);
  assert.match(api, /three_brand_verified_trading_release_cache/);
  assert.match(api, /two_brand_verified_trading_release_cache/);
  assert.match(api, /count: 'exact', head: true/);
  assert.match(api, /publicationBrands\(\)/);
  assert.match(api, /configuredBrands\.length \? configuredBrands : DEFAULT_BRANDS/);
  assert.match(api, /REVIEWED_ZENITH_RECORD_START/);
  assert.match(api, /REVIEWED_ZENITH_SOURCE/);
  assert.match(api, /\['Panerai', 'Zenith'\]\.includes\(brand\)[\s\S]*loadControlledRows/);
  assert.match(api, /brand === 'Panerai'[\s\S]*REVIEWED_PANERAI_RECORD_IDS[\s\S]*REVIEWED_PANERAI_SOURCE/);
  assert.match(api, /new Set\(rows\.map\(repostSignature\)\)\.size/);
  assert.match(api, /\.filter\(isReleaseListingEligible\)/);
  assert.doesNotMatch(page, /\/api\/live-release-summary/);
  assert.doesNotMatch(page, /Live verified inventory/);
  assert.match(page, /\/api\/reviewed-market-inventory\?page=1&pageSize=12/);
  assert.match(page, /Brands come from the complete available inventory/);
});
