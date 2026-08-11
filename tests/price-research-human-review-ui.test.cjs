'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'PriceResearch.tsx'),
  'utf8',
);

test('human-review WTS evidence is visibly provisional and never presented as automatically approved', () => {
  assert.match(source, /Provisional · Human review/);
  assert.match(source, /Human-review status alone never qualifies a price/);
  assert.match(source, /positive source-backed price, verified currency evidence/);
  assert.match(source, /human_review_is_analytics_eligible_only_after_all_evidence_gates/);
  assert.match(source, /normalizedVerdict/);
  assert.match(source, /\['HUMAN REVIEW', 'NEEDS REVIEW'\]/);
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
});

test('listing evidence preserves raw message and seller facts while suppressing invalid images', () => {
  assert.match(source, /row\.raw_message \?\? row\.raw_line/);
  assert.match(source, /Posted by:/);
  assert.match(source, /Contact:/);
  assert.match(source, /row\.seller_name \|\| row\.posted_by/);
  assert.match(source, /row\.seller_phone \|\| row\.phone_number/);
  assert.match(source, /row\.has_images === false \? '' : imageCandidate/);
  assert.match(source, /row\.has_images === false[\s\S]*\? null[\s\S]*row\.image_url/);
});

test('WTB demand stays visibly separate from WTS asking-price analytics and contact actions remain', () => {
  assert.match(source, /Strictly separated from WTS asking-price averages/);
  assert.match(source, /Demand Signals \(WTB\)/);
  assert.match(source, /Qualified WTS observations power the chart and statistics/);
  assert.match(source, /Contact on WhatsApp/);
  assert.match(source, /View full listing detail/);
});
