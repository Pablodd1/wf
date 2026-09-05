'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ingestSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ingest.js'), 'utf8');

test('cursor browsing does not count the complete verified view', () => {
  assert.match(ingestSource, /cursorMode[\s\S]*\? 'return=representation'[\s\S]*\? 'count=planned'[\s\S]*: 'count=estimated'/);
  assert.match(ingestSource, /const total = cursorMode[\s\S]*\? null/);
});

test('strict browsing verifies and globally deduplicates the bounded reviewed release', () => {
  assert.match(ingestSource, /const strictVerifiedPublication = true/);
  assert.match(ingestSource, /loadStrictIdentityCandidates\(supabaseUrl, readKey, limit = 999\)/);
  assert.match(ingestSource, /Range: `0-\$\{limit\}`/);
  assert.match(ingestSource, /hasMore: Array\.isArray\(rows\) && rows\.length > limit/);
  assert.match(ingestSource, /if \(identityPage\.hasMore\)[\s\S]*999-row global repost-deduplication window/);
  assert.match(ingestSource, /sortTradingItems\(deduplicateTradingItems\(mediaResolved\)\)/);
  assert.match(ingestSource, /item\.resolved\?\.has_images && !current\.resolved\?\.has_images/);
  assert.match(ingestSource, /listingIsAfterCursor/);
  assert.match(ingestSource, /rest\/v1\/trading_floor_verified_listings/);
  assert.match(ingestSource, /verdict: 'eq\.APPROVED'/);
  assert.match(ingestSource, /confidence: 'gte\.90'/);
  assert.match(ingestSource, /rest\/v1\/listing_identity_reviews/);
  assert.match(ingestSource, /status: 'in\.\(CATALOG_CONFIRMED,HUMAN_APPROVED\)'/);
  assert.match(ingestSource, /Verified media batch unavailable; images remain withheld/);
  assert.match(ingestSource, /if \(strictVerifiedPublication\) \{[\s\S]*loadStrictCursorPage/);
  assert.match(ingestSource, /Strict publication requires server-side verification/);
});
