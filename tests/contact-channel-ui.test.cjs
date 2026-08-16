'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('listing surfaces show verified channel actions without rendering contact numbers', () => {
  const trading = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');
  const evidence = read('src/components/ListingDealerEvidence.tsx');

  assert.match(trading, /contact_channels\?\.whatsapp/);
  assert.match(trading, /contact_channels\?\.telegram/);
  assert.match(trading, /surface=trading-floor&channel=whatsapp/);
  assert.match(trading, /Continue on Telegram/);
  assert.doesNotMatch(trading, /\{contact\?\.phone_display/);
  assert.doesNotMatch(trading, /Contact:\s*\{publishedPhone\}/);
  assert.match(research, /seller\?\.contact_channels\?\.whatsapp/);
  assert.match(research, /surface=price-research&channel=whatsapp/);
  assert.doesNotMatch(research, /seller\?\.phone_display/);
  assert.doesNotMatch(evidence, /Contact:\s*\{publishedPhone\}/);
});
