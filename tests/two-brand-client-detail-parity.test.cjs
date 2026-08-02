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

test('Trading Floor uses only the reviewed inventory evidence returned for its page', () => {
  assert.match(trading, /\/api\/reviewed-market-inventory\?/);
  assert.match(research, /\/api\/price-research-listing\?id=/);
  assert.doesNotMatch(trading, /\/api\/(?:price-research-listing|trading-listing|listing-contact)\?id=/);
  assert.match(research, /payload\.listing\?\.id !== row\.id/);
  assert.match(trading, /\/api\/reviewed-seller-summary\?id=/);
  assert.match(trading, /listing\.image_evidence_notice/);
  assert.match(trading, /SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE/);
  assert.match(research, /detail\?\.image_urls/);
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /rpc\('verified_listing_thumbnail'/);
    assert.match(api, /p_record_id: id/);
  }
});

test('customer details show original evidence and only explicitly approved workbook contacts', () => {
  assert.match(trading, /Original listing/);
  assert.match(trading, /dealer_name/);
  assert.match(trading, /seller_phone/);
  assert.match(trading, /sourcePosterContact/);
  assert.match(trading, /Source-supplied contact/);
  assert.doesNotMatch(trading, /dealer_company|dealer_profile_url|verified dealer/);
  assert.match(research, /reviewed-seller-summary/);
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

test('Trading Floor detail prices require verified USD or preserve the source price', () => {
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /analytics_currency_status === 'VERIFIED'/);
    assert.match(api, /price_evidence_status/);
  }
  assert.match(trading, /listing\.price_evidence_status !== 'SOURCE_EXPLICIT_USD_MATCH'/);
  assert.match(trading, /listing\.price_research_eligible !== true/);
  assert.match(trading, /function formatSourcePrice/);
  assert.doesNotMatch(trading, /price_usd: tradingListing\.price_usd/);
  assert.doesNotMatch(trading, /Price under review/);
  assert.doesNotMatch(trading, /Price on request/);
  assert.match(trading, /Reviewed price:/);
  assert.match(trading, /Workbook-reviewed USD - not in averages/);
  assert.match(trading, /Posted by/);
  assert.match(trading, /getListingMeta\(listing\)/);
});

test('Price Research sources every brand button from the reviewed inventory API', () => {
  assert.match(research, /fetch\('\/api\/reviewed-market-inventory\?page=1&pageSize=12'/);
  assert.match(research, /payload\.publicationBrands/);
  assert.doesNotMatch(research, /payload\.summary\?\.brands \|\|/);
  assert.match(research, /pBrands\.filter\(item => POPULAR_BRANDS\.includes\(item\.brand\)\)/);
  assert.doesNotMatch(research, /pBrands\.find\(item => item\.brand === brand\) \|\| \{ brand \}/);
});
