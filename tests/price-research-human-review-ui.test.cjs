'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'),
  'utf8',
);

test('review-state language stays internal while evidence gates remain explicit', () => {
  assert.doesNotMatch(source, /Provisional .* Human review/);
  assert.doesNotMatch(source, /Human-review status alone never qualifies a price/);
  assert.match(source, /positive source-backed price, source-stated currency/);
  assert.match(source, /'Strong' : data\.sample_quality === 'provisional' \? 'Developing' : 'Observed'/);
});

test('methodology is collapsed first and displays the exact IQR formula and evidence counts', () => {
  assert.match(source, /Analysis outcome and methodology/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(source, /Q1 - 3\.0 \* IQR <= price <= Q3 \+ 3\.0 \* IQR/);
  assert.match(source, /priced_wts_before_plausibility_count/);
  assert.match(source, /priced_wts_after_plausibility_count/);
  assert.match(source, /Statistical outliers/);
  assert.match(source, /Reposts counted once/);
});

test('qualified WTS range and dial-colored charts remain explicit', () => {
  assert.match(source, /aria-label="Qualified WTS price range"/);
  assert.match(source, /\['Minimum', stats\.min, NAVY\]/);
  assert.match(source, /\['Average', stats\.avg, GREEN\]/);
  assert.match(source, /\['Maximum', stats\.max, NAVY\]/);
  assert.match(source, /fill=\{dialChartColor\(dial\.dial_color\)\}/);
  assert.match(source, /stroke=\{selectedDialLine\}/);
  assert.match(source, /Source- and review-supported dial cohorts/);
  assert.doesNotMatch(source, /Catalog-valid dial cohorts/);
});

test('complete paginated WTS inventory appears before separate WTB demand while graphics remain WTS-only', () => {
  assert.doesNotMatch(source, />Reference activity</);
  assert.match(source, /data-testid="wtb-demand-summary"/);
  assert.match(source, /WTS listings for sale/);
  assert.match(source, /Priced WTS evidence is accessible page by page/);
  assert.match(source, /WTB requests follow in their own section/);
  assert.doesNotMatch(source, /Showing a compact source-evidence sample for speed/);
});

test('listing evidence preserves raw message and seller facts while suppressing invalid images', () => {
  assert.match(source, /row\.raw_message \?\? row\.raw_line/);
  assert.match(source, /Posted by:/);
  assert.doesNotMatch(source, /Contact:\s*\{publishedPhone\}/);
  assert.match(source, /row\.seller_name \|\| row\.posted_by/);
  assert.match(source, /const summaryPosterName = summary\.seller_name \|\| summary\.posted_by/);
  assert.doesNotMatch(source, /const summaryPosterPhone/);
  assert.doesNotMatch(source, /const summaryPosterPhone = summary\.seller_phone \|\| summary\.phone_number/);
  assert.match(source, /row\.seller_phone \|\| row\.phone_number/);
  assert.match(source, /row\.has_images === false \? '' : imageCandidate/);
  assert.match(source, /row\.has_images === false[\s\S]*\? null[\s\S]*row\.image_url/);
});

test('WTB demand stays visibly separate from WTS asking-price analytics and contact actions remain', () => {
  assert.match(source, /Requests remain separate from WTS asking-price averages/);
  assert.match(source, /Demand Signals \(WTB\)/);
  assert.match(source, /Qualified observations power the chart and statistics/);
  assert.match(source, /Contact on WhatsApp/);
  assert.match(source, /View full listing detail/);
});
