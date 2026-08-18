'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
const hireFiRail = fs.readFileSync(path.join(root, 'src/components/HireFiScrollRail.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260811130000_trading_floor_location_and_media_contract.sql'),
  'utf8',
);

test('location is searchable on desktop and mobile and reaches the reviewed API', () => {
  assert.match(ui, /id="location-filter"[\s\S]*type="search"/);
  assert.match(ui, /placeholder="City, region, or country"/);
  assert.match(ui, /params\.set\('region', locationFilter\)/);
  assert.match(ui, /location\.includes\(requested\)/);
  assert.match(ui, /if \(!locationMatches\(location, locationFilter\)\) return false/);
  assert.match(api, /queryParams\.set\('location', `ilike\.\$\{regionPattern\}`\)/);
  assert.match(api, /location\.ilike\.\$\{pattern\}/);
  assert.match(api, /locationMatches\(record\.location, region\)/);
});

test('the Hire Fi rail cannot intercept mobile search and filter controls', () => {
  assert.match(hireFiRail, /className="[^"]*hidden[^"]*md:block[^"]*"/);
  assert.match(ui, /onClick=\{\(\) => setFiltersOpen\(true\)\}/);
});

test('bundle media and missing URLs cannot create an image frame', () => {
  assert.match(ui, /if \(isBundleListing\(listing\)\) return null/);
  assert.match(ui, /listing\.multi_listing \|\| listing\.is_unbundled_child/);
  assert.match(ui, /return listingImageUrl\(listing\) !== null/);
  assert.doesNotMatch(ui, /if \(listing\.has_images\) return true/);
  assert.doesNotMatch(ui, />Multi-Listing</);
});

test('forward view exposes location and zeroes every bundle image alias', () => {
  assert.match(migration, /NULLIF\(btrim\(l\.location\), ''\)\s+AS location/);
  assert.match(migration, /l\.parent_id IS NULL[\s\S]*COALESCE\(l\.is_bundle, FALSE\) = FALSE/);
  assert.match(migration, /btrim\(COALESCE\(l\.image_url, ''\)\) ~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/);
  assert.match(migration, /AS user_image_url/);
  assert.match(migration, /AS has_exact_source_image/);
  assert.match(migration, /bundle_pending_separation/);
  assert.match(migration, /suppressed_exact_duplicate/);
});
