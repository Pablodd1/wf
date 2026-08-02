'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const pageRender = source.slice(source.indexOf('export default function PriceResearch'), source.indexOf('// â”€â”€ Sub-Components'));

test('Price Research renders analytics before a compact comparable sample', () => {
  assert.match(source, /const COMPARABLE_LISTING_PREVIEW_LIMIT = 12/);
  assert.match(pageRender, /Analysis outcome and methodology/);
  assert.match(pageRender, /Qualified comparable listings/);
  assert.ok(
    pageRender.indexOf('Analysis outcome and methodology') < pageRender.indexOf('Qualified comparable listings'),
    'analysis must render before listing evidence',
  );
  assert.match(pageRender, /\.slice\(0, COMPARABLE_LISTING_PREVIEW_LIMIT\)/);
  assert.match(pageRender, /\.sort\(\(left, right\) =>[\s\S]*Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
  assert.doesNotMatch(pageRender, /Available listings|reviewedInventory\.total|fetchReviewedInventory/);
});

test('qualified comparable listings are ordered from lowest to highest verified USD price', () => {
  const sortIndex = pageRender.indexOf('.sort((left, right) =>');
  const sliceIndex = pageRender.indexOf('.slice(0, COMPARABLE_LISTING_PREVIEW_LIMIT)');
  assert.ok(sortIndex > -1 && sortIndex < sliceIndex, 'price ordering must happen before the compact preview is sliced');
  assert.match(pageRender, /Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
});

test('customer listing rows contain included comparables only', () => {
  assert.match(pageRender, /\(data\?\.rows \|\| \[\]\)[\s\S]*\.filter\(row => !row\.is_outlier\)/);
  assert.match(pageRender, /listings\.map\(row =>/);
  assert.doesNotMatch(pageRender, /retainedListings\.map|data\.outlier_rows\.slice/);
  assert.match(pageRender, /Outliers and other exclusions are summarized above and are not displayed as watch listings/);
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
  assert.match(fetchData, /Select a brand to run the exact comparable analysis/);
  assert.match(source, /aria-label="Watch brand"/);
});
