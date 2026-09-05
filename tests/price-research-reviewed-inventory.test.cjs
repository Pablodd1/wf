'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const pageRender = source.slice(source.indexOf('export default function PriceResearch'), source.indexOf('// â”€â”€ Sub-Components'));

test('Price Research renders analytics before complete paginated WTS evidence', () => {
  assert.match(source, /const WTB_LISTING_PAGE_SIZE = 24/);
  assert.match(pageRender, /Analysis outcome and methodology/);
  assert.match(pageRender, /WTS listings for sale/);
  assert.ok(
    pageRender.indexOf('key={`methodology-') < pageRender.indexOf('WTS listings for sale · page'),
    'analysis must render before listing evidence',
  );
  assert.doesNotMatch(pageRender, /COMPARABLE_LISTING_PREVIEW_LIMIT/);
  assert.match(pageRender, /\.sort\(\(left, right\) =>[\s\S]*Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
  assert.doesNotMatch(pageRender, /Available listings|reviewedInventory\.total|fetchReviewedInventory/);
  assert.doesNotMatch(pageRender, /Comparable evidence|Unique offers after eligibility checks|Final chart set:|Evidence path:/);
  assert.doesNotMatch(pageRender, /<details open/);
});

test('qualified comparable listings are ordered from lowest to highest verified USD price', () => {
  const sortIndex = pageRender.indexOf('.sort((left, right) =>');
  const renderIndex = pageRender.indexOf('listings.map(row =>');
  assert.ok(sortIndex > -1 && sortIndex < renderIndex, 'price ordering must happen before the paginated evidence is rendered');
  assert.match(pageRender, /Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
});

test('priced sale rows preserve source evidence while unpriced WTS stays Trading-Floor-only', () => {
  assert.match(pageRender, /\.\.\.data\.rows, \.\.\.\(data\.outlier_rows \|\| \[\]\)/);
  assert.doesNotMatch(pageRender, /\.\.\.\(data\.retained_rows \|\| \[\]\)/);
  assert.match(pageRender, /Number\.isFinite\(Number\(row\.price_usd\)\)/);
  assert.match(pageRender, /eligibilityDifference/);
  assert.match(pageRender, /listings\.map\(row =>/);
  assert.match(pageRender, /Priced WTS evidence is accessible page by page/);
  assert.match(pageRender, /Unpriced WTS stays on the Trading Floor/);
  assert.match(pageRender, /WTB requests follow in their own section/);
  assert.match(pageRender, /exclusionLabel=\{outlierReason\(row\.outlier_reason\)\}/);
  assert.doesNotMatch(source, /No image|Source listing image unavailable/);
  assert.match(source, /const showImage = Boolean\(imageUrl\) && !imageFailed/);
  assert.match(source, /\{showImage && \(/);
  assert.match(source, /row\.raw_message \?\? row\.raw_line/);
});

test('all customer serialized sale evidence is priced and explicitly typed WTS', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');
  const extractSerializedBlock = (declaration, nextDeclaration) => {
    const start = api.indexOf(`const ${declaration} =`);
    const end = api.indexOf(`const ${nextDeclaration} =`, start);
    assert.ok(start >= 0 && end > start, `${declaration} serialization block must exist`);
    return api.slice(start, end);
  };
  const comparableBlock = extractSerializedBlock('comparableEvidenceRows', 'outlierDealerEvidenceRows');
  const outlierBlock = extractSerializedBlock('outlierDealerEvidenceRows', 'combinedDealerEvidenceRows');
  assert.match(outlierBlock, /listing_type: 'WTS'/);
  assert.match(comparableBlock, /listing_type: 'WTS'/);
  assert.doesNotMatch(api, /const retainedDealerEvidenceRows/);
  assert.match(api, /retained_rows: \[\]/);
  assert.match(api, /customerPricedOutlierRows = outlierRows\.filter\(isCustomerPricedSaleEvidence\)/);
});

test('charts render whenever qualified data exists and use the selected dial color', () => {
  assert.match(pageRender, /\{chartData\.length >= 1 \? \(/);
  assert.doesNotMatch(pageRender, /chartData\.length >= 1 && \(data\.monthly \|\| \[\]\)\.length >= 2/);
  assert.doesNotMatch(pageRender, /\(data\.dial_analysis \|\| \[\]\)\.length > 1 &&/);
  assert.match(pageRender, /stroke=\{selectedDialLine\}/);
  assert.match(source, /const cohortLineColor = dialChartColor/);
  assert.match(source, /stroke=\{cohortLineColor\}/);
});

test('outliers remain visible as aggregate methodology, never as customer watch rows', () => {
  assert.match(pageRender, /Statistical outliers/);
  assert.match(pageRender, /data\.outliersRemoved/);
  assert.match(pageRender, /Total exclusions/);
  assert.doesNotMatch(pageRender, /Excluded evidence for human review|View source detail for excluded observation/);
});

test('sub-five cohorts report their real qualified comparable count', () => {
  assert.match(pageRender, /data\.count\.toLocaleString\(\)\} qualified comparable/);
  assert.doesNotMatch(pageRender, /0 qualified comparables/);
});

test('brand browsing still comes from the gated reviewed publication inventory', () => {
  assert.match(source, /fetch\('\/api\/reviewed-market-inventory\?page=1&pageSize=12'/);
  assert.match(source, /payload\.publicationBrands \|\| payload\.summary\?\.publicationBrands/);
  assert.doesNotMatch(source, /payload\.summary\?\.brands \|\|/);
  assert.match(source, /typeof item === 'string'/);
});

test('search performs one analytics request and requires a brand when identity cannot resolve', () => {
  const fetchData = source.slice(source.indexOf('const fetchData'), source.indexOf('useEffect(() => {', source.indexOf('const fetchData')));
  assert.match(fetchData, /fetch\(`\/api\/price-research\?\$\{params\.toString\(\)\}`/);
  assert.doesNotMatch(fetchData, /reviewed-market-inventory|fetchReviewedInventory/);
  assert.match(fetchData, /Select a brand and reference to view market price research/);
  assert.match(source, /aria-label="Watch brand"/);
});
