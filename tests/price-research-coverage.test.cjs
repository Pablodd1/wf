'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPriceResearchCoverage } = require('../api/_lib/price-research-coverage.cjs');

test('brand coverage is non-overlapping and reconciles to the Trading Floor total', () => {
  const result = buildPriceResearchCoverage([
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTS', supplied_price: true, row_count: 8 },
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTS', supplied_price: false, row_count: 2 },
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTB', supplied_price: true, row_count: 3 },
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTB', supplied_price: false, row_count: 4 },
    { category: 'HANDBAG', brand: 'Rolex', listing_type: 'WTS', supplied_price: true, row_count: 99 },
  ], [{ brand: 'Rolex', model_count: 19, reference_count: 301 }]);

  assert.deepEqual(result.brands[0], {
    brand: 'Rolex',
    wts_with_supplied_price: 8,
    wts_without_supplied_price: 2,
    wtb_with_target_price: 3,
    wtb_without_target_price: 4,
    trading_floor_listings: 17,
    wts_activity: 10,
    wtb_activity: 7,
    searchable_catalog_models: 19,
    searchable_catalog_references: 301,
    price_research_qualified_wts: null,
    reposts_counted_once: null,
    statistical_outliers: null,
    reference_scoped_analytics: true,
    reconciles: true,
  });
  assert.equal(result.totals.trading_floor_listings, 17);
});

test('coverage excludes malformed historical brand labels without a catalog identity', () => {
  const result = buildPriceResearchCoverage([
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTS', supplied_price: true, row_count: 8 },
    { category: 'WATCH', brand: 'Datejust', listing_type: 'WTS', supplied_price: true, row_count: 312 },
    { category: 'WATCH', brand: 'Unspecified', listing_type: 'WTB', supplied_price: false, row_count: 12492 },
  ], [{ brand: 'Rolex', model_count: 19, reference_count: 301 }]);

  assert.deepEqual(result.brands.map(item => item.brand), ['Rolex']);
  assert.equal(result.totals.trading_floor_listings, 8);
});

test('coverage API reads only the bounded market-count snapshot and labels exact analytics reference-scoped', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research-coverage.js'), 'utf8');
  assert.match(api, /client\.rpc\('qnsa_market_feed_counts'\)/);
  assert.doesNotMatch(api, /staging\.listings|count:\s*'exact'/);
  assert.match(api, /reference_scoped_analytics/);
  assert.match(api, /3\.0x IQR/);
});

test('Price Research keeps the coverage data service private and omits the removed market coverage section', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.doesNotMatch(page, /\/api\/price-research-coverage/);
  assert.doesNotMatch(page, /Brand market coverage/);
  assert.doesNotMatch(page, /Exact qualified totals remain reference-specific/);
});
