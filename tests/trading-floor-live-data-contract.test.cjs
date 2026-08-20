'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const floorPath = path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx');
const floor = fs.readFileSync(floorPath, 'utf8');

test('Trading Floor is server-authoritative and never loads the static archive in browser memory', () => {
  assert.doesNotMatch(floor, /parsedWatches\.json/);
  assert.doesNotMatch(floor, /inventory_manifest\.json/);
  assert.doesNotMatch(floor, /3527754/);
  assert.match(floor, /data\.status === 'ok' && Array\.isArray\(data\.records\)/);
});

test('Trading Floor preserves compact no-image cards and never substitutes stock watch media', () => {
  assert.doesNotMatch(floor, /images\.unsplash\.com/);
  assert.doesNotMatch(floor, /BRAND_FALLBACK_IMAGES/);
  assert.match(floor, /if \(isBundleListing\(listing\) \|\| listing\.is_unbundled_child === true\) return null/);
  assert.match(floor, /\{cardHasImage && \(/);
});

test('Trading Floor card evidence uses bounded market summaries and source-backed dealer evidence', () => {
  assert.match(floor, /loadPriceResearchBatchSummaries/);
  assert.match(floor, /Price rating:/);
  assert.match(floor, /DealerRatingBadge/);
  assert.match(floor, /seller_rating_evidence_status/);
  assert.doesNotMatch(floor, /Price rating: <span[^>]*>Calculating\.\.\.<\/span>/);
});

test('Trading Floor supplies a keyboard-accessible right-side quick-scroll rail for long result pages', () => {
  assert.match(floor, /function TradingFloorQuickScroll\(\)/);
  assert.match(floor, /aria-label="Quick Trading Floor scroll"/);
  assert.match(floor, /aria-label="Scroll to top of Trading Floor"/);
  assert.match(floor, /aria-label="Trading Floor scroll position"/);
  assert.match(floor, /aria-label="Scroll to bottom of Trading Floor"/);
  assert.match(floor, /window\.scrollTo\(\{ top:/);
  assert.match(floor, /fixed right-20 top-1\/2/);
});
