'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const trading = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'),
  'utf8',
);
const research = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'),
  'utf8',
);
const tradingApi = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'trading-listing.js'),
  'utf8',
);
const researchDetailApi = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research-listing.js'),
  'utf8',
);

test('Trading Floor uses the same safe listing evidence source as Price Research', () => {
  assert.match(trading, /\/api\/price-research-listing\?id=/);
  assert.match(research, /\/api\/price-research-listing\?id=/);
  assert.match(trading, /publicListing\.id !== listing\.id/);
  assert.match(research, /payload\.listing\?\.id !== row\.id/);
  assert.match(trading, /evidence\?\.image_urls/);
  assert.match(trading, /Array\.isArray\(publicListing\.image_urls\)/);
  assert.doesNotMatch(trading, /tradingListing\.image_urls/);
  assert.match(research, /detail\?\.image_urls/);
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /rpc\('verified_listing_thumbnail'/);
    assert.match(api, /p_record_id: id/);
  }
});

test('both customer details show contact-redacted original evidence and display-safe seller data', () => {
  for (const page of [trading, research]) {
    assert.match(page, /Original listing/);
    assert.match(page, /contact redacted|CONTACT REDACTED/i);
    assert.match(page, /dealer_name/);
    assert.match(page, /dealer_company/);
    assert.match(page, /dealer_profile_url/);
    assert.doesNotMatch(page, /seller_phone/);
  }
});

test('only Price Research renders cohort analytics for the selected listing', () => {
  assert.doesNotMatch(trading, /Price rating/);
  assert.doesNotMatch(trading, /Price when posted/);
  assert.doesNotMatch(trading, /dataKey="avg_price"/);
  assert.doesNotMatch(trading, /dataKey="selected_price"/);
  assert.match(research, /Price when posted/);
  assert.match(research, /dataKey="avg_price"/);
  assert.match(research, /dataKey="selected_price"/);
  assert.match(research, /monthly/);
  assert.match(research, /dial/i);
  assert.match(research, /condition/i);
});

test('customer detail prices require exact raw-line currency evidence', () => {
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /analytics_currency_status === 'VERIFIED'/);
    assert.match(api, /priceVerified \? normalized\.analytics_price_usd : null/);
    assert.match(api, /price_evidence_status/);
  }
  assert.doesNotMatch(trading, /Price under review/);
  assert.match(trading, /Price on request/);
  assert.match(trading, /getListingMeta\(detailListing\)/);
});

test('Price Research never fabricates brand buttons outside the API catalog', () => {
  assert.match(research, /useState<\{ brand: string; model_count\?: number; reference_count\?: number \}\[]>\(\[]\)/);
  assert.match(research, /pBrands\.filter\(item => POPULAR_BRANDS\.includes\(item\.brand\)\)/);
  assert.doesNotMatch(research, /pBrands\.find\(item => item\.brand === brand\) \|\| \{ brand \}/);
});
