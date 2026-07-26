'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('Price Research cancels stale detail requests and validates the returned listing id', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.match(source, /listingRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /payload\.listing\?\.id !== row\.id/);
  assert.match(source, /listingRequestRef\.current\.sequence !== sequence/);
  assert.match(source, /key=\{selectedRow\.id\}/);
});

test('public listing detail keeps Trading Floor raw evidence private and redacts Price Research source text', () => {
  const trading = fs.readFileSync(path.join(root, 'api', 'trading-listing.js'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'api', 'price-research-listing.js'), 'utf8');
  assert.match(trading, /raw_message: null/);
  assert.doesNotMatch(trading, /redactPublicSource/);
  assert.match(research, /redactPublicSource\(rawSource\.text\)/);
  assert.match(research, /slice\(0, 12_000\)/);
  assert.match(research, /raw_message: publicSource \|\| null/);
  assert.doesNotMatch(research, /raw_message_lineage_id/);
});

test('Price Research detail is customer-facing and compares the selected listing with its exact cohort', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
  assert.doesNotMatch(source, /Normalized record/);
  assert.doesNotMatch(source, /Normalization confidence/);
  assert.doesNotMatch(source, /Record ID/);
  assert.match(source, /title="Original listing"/);
  assert.match(source, /title="Posted by"/);
  assert.match(source, /title="Price when posted"/);
  assert.match(source, /dataKey="selected_price"/);
  assert.match(source, /dataKey="avg_price"/);
  assert.match(source, /cohortDial=\{data\?\.selected_cohort\.dial_color/);
  assert.match(source, /surface=price-research/);
});
