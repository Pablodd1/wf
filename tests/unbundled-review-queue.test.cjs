'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('seller lineage maps the rows returned by the REST result wrapper', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'api', 'unbundled-review-queue.js'),
    'utf8',
  );

  assert.match(source, /new Map\(lineageRows\.rows\.map\(/);
  assert.doesNotMatch(source, /new Map\(lineageRows\.map\(/);
});

test('human correction drafts preserve raw and USD prices independently', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pages', 'ReviewQueue.tsx'),
    'utf8',
  );

  assert.match(source, /priceRaw: item\.price_raw \?\? null/);
  assert.match(source, /priceUsd: item\.price_usd \?\? null/);
  assert.match(source, /price_raw: item\.priceRaw == null \? '' : String\(item\.priceRaw\)/);
  assert.match(source, /price_usd: item\.priceUsd == null \? '' : String\(item\.priceUsd\)/);
  assert.match(source, /listing_type: item\.listingType \|\| 'OTHER'/);
});
