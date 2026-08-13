'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Trading Floor links use the HashRouter Price Research workflow', () => {
  const source = read('src/pages/TradingFloor.tsx');
  assert.match(source, /<Link[\s\S]*to=\{`\/price-research\?brand=/);
  assert.doesNotMatch(source, /href=\{`\/price-research\?brand=/);
});

test('Price Research returns to the exact Trading Floor cohort', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /to=\{`\/trading\?brand=\$\{encodeURIComponent\(data\.brand\)\}&reference=\$\{encodeURIComponent\(data\.reference\)\}`\}/);
  assert.doesNotMatch(source, /to=\{`\/trading\?brand=\$\{encodeURIComponent\(data\.brand\)\}&q=/);
});

test('QNSA comparable detail reuses the exact evidence already loaded by analytics', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /row\.source \|\| ''\)\.toUpperCase\(\) === 'MARIADB_IMMUTABLE_RAW'/);
  assert.match(source, /setListingDetail\(\{/);
  assert.match(source, /raw_message_scope: rawMessage \? 'original_post' : 'unavailable'/);
  assert.match(source, /image_evidence_type: imageCandidate \? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE'/);
});

test('URL-selected brand remains visible while release-brand metadata loads', () => {
  const source = read('src/pages/PriceResearch.tsx');
  assert.match(source, /queryBrand && !pBrands\.some\(item => item\.brand === queryBrand\)/);
  assert.match(source, /<option value=\{queryBrand\}>\{queryBrand\}<\/option>/);
});
