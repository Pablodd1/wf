'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const pageRender = source.slice(source.indexOf('export default function PriceResearch'), source.indexOf('// â”€â”€ Sub-Components'));

test('Price Research renders analytics before the compact featured-sale sample', () => {
  assert.match(source, /const COMPARABLE_LISTING_PREVIEW_LIMIT = 12/);
  assert.match(pageRender, /Analysis outcome and methodology/);
  assert.match(pageRender, /Featured listings for sale/);
  assert.ok(
    pageRender.indexOf('key={`methodology-') < pageRender.indexOf('Featured listings for sale ({listings.length} shown)'),
    'analysis must render before listing evidence',
  );
  assert.match(pageRender, /\.slice\(0, COMPARABLE_LISTING_PREVIEW_LIMIT\)/);
  assert.match(pageRender, /\.sort\(\(left, right\) =>[\s\S]*Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
  assert.doesNotMatch(pageRender, /Available listings|reviewedInventory\.total|fetchReviewedInventory/);
  assert.doesNotMatch(pageRender, /Comparable evidence|Unique offers after eligibility checks|Final chart set:|Evidence path:/);
  assert.doesNotMatch(pageRender, /<details open/);
});

test('qualified comparable listings are ordered from lowest to highest verified USD price', () => {
  const sortIndex = pageRender.indexOf('.sort((left, right) =>');
  const sliceIndex = pageRender.indexOf('.slice(0, COMPARABLE_LISTING_PREVIEW_LIMIT)');
  assert.ok(sortIndex > -1 && sortIndex < sliceIndex, 'price ordering must happen before the compact preview is sliced');
  assert.match(pageRender, /Number\(left\.price_usd\) - Number\(right\.price_usd\)/);
});

test('featured-sale rows preserve source evidence while excluded rows never alter averages', () => {
  assert.match(pageRender, /\.\.\.data\.rows, \.\.\.\(data\.retained_rows \|\| \[\]\), \.\.\.\(data\.outlier_rows \|\| \[\]\)/);
  assert.match(pageRender, /eligibilityDifference/);
  assert.match(pageRender, /listings\.map\(row =>/);
  assert.match(pageRender, /Compact, full-width WTS source evidence only/);
  assert.match(pageRender, /WTB requests remain counted separately in the WTB \/ WTS ratio above/);
  assert.match(pageRender, /exclusionLabel=\{outlierReason\(row\.outlier_reason\)\}/);
  assert.match(source, /function ComparableThumbnail/);
  assert.match(source, /row\.raw_message \?\? row\.raw_line/);
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
  assert.match(fetchData, /Select a brand to run the exact comparable analysis/);
  assert.match(source, /aria-label="Watch brand"/);
});
