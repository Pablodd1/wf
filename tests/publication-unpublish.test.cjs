'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  isPublicationBrandAllowed,
  publicationBrands,
} = require('../api/_lib/publication-brands.cjs');

const root = path.join(__dirname, '..');

test('Panerai and Zenith-only publication excludes the replaced Rolex and Patek datasets', () => {
  const configured = 'Panerai|Zenith';
  assert.deepEqual(publicationBrands(configured), ['Panerai', 'Zenith']);
  assert.equal(isPublicationBrandAllowed('Rolex', configured), false);
  assert.equal(isPublicationBrandAllowed('Patek Philippe', configured), false);
  assert.equal(isPublicationBrandAllowed('Panerai', configured), true);
  assert.equal(isPublicationBrandAllowed('Zenith', configured), true);
});

test('Trading Floor accepts an empty release response without loading sample inventory', () => {
  const page = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(page, /data\.status === 'supabase_not_configured'/);
  assert.doesNotMatch(page, /data\.records\.length === 0/);
  assert.match(page, /data\.publicationBrands/);
  assert.match(page, /releaseBrands\.map/);
  assert.match(page, /const nextListings = data\.records \|\| \[\]/);
  assert.match(page, /setListings\(\[\.\.\.withImages, \.\.\.withoutImages\]\)/);
  assert.doesNotMatch(page, /releaseBrands\[0\]/);
  assert.doesNotMatch(page, /top_watches_trading_floor\.json/);
});
