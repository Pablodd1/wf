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
  assert.match(trading, /hasEmbeddedWorkbookEvidence/);
  assert.match(trading, /\/api\/reviewed-seller-summary\?id=/);
  assert.match(trading, /Array\.isArray\(publicListing\.image_urls\)/);
  assert.match(trading, /const imageSource = Array\.isArray\(publicListing\.image_urls\)/);
  assert.match(trading, /image_evidence_notice: imageSource\.image_evidence_notice/);
  assert.match(trading, /SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE/);
  assert.match(research, /detail\?\.image_urls/);
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /rpc\('verified_listing_thumbnail'/);
    assert.match(api, /p_record_id: id/);
  }
});

test('customer details show original evidence and only explicitly approved workbook contacts', () => {
  for (const page of [trading, research]) {
    assert.match(page, /Original listing/);
    assert.match(page, /dealer_name/);
    assert.match(page, /dealer_company/);
    assert.match(page, /dealer_profile_url/);
    assert.match(page, /seller_phone/);
  }
  assert.match(trading, /sourcePosterContact/);
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

test('customer detail prices require exact evidence or an owner-reviewed workbook price', () => {
  for (const api of [tradingApi, researchDetailApi]) {
    assert.match(api, /analytics_currency_status === 'VERIFIED'/);
    assert.match(api, /price_evidence_status/);
  }
  assert.match(tradingApi, /reviewedWorkbookPrice/);
  assert.match(tradingApi, /HUMAN_APPROVED_WORKBOOK/);
  assert.match(trading, /price_usd: tradingListing\.price_usd \?\? listing\.price_usd/);
  assert.doesNotMatch(trading, /Price under review/);
  assert.match(trading, /Price on request/);
  assert.match(trading, /getListingMeta\(detailListing\)/);
});

test('Price Research sources every brand button from the reviewed inventory API', () => {
  assert.match(research, /fetch\('\/api\/reviewed-market-inventory\?page=1&pageSize=12'/);
  assert.match(research, /payload\.summary\?\.brands/);
  assert.match(research, /pBrands\.filter\(item => POPULAR_BRANDS\.includes\(item\.brand\)\)/);
  assert.doesNotMatch(research, /pBrands\.find\(item => item\.brand === brand\) \|\| \{ brand \}/);
});
