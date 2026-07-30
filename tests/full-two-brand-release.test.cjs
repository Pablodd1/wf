'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  rawSupportsExactReference,
  validateDecisionBody,
} = require('../api/identity-review-decision.js');
const {
  MAX_SCANNED_PER_PAGE,
  passesStaticReleaseGates,
} = require('../api/identity-review-queue.js');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('full-brand Trading Floor uses a service-only deduplicated keyset source', () => {
  const migration = read('supabase/migrations/20260727190000_full_rolex_patek_release.sql');
  const unpricedTradingMigration = read('supabase/migrations/20260727260000_include_unpriced_two_brand_trading.sql');
  const cacheMigration = read('supabase/migrations/20260727230000_materialized_two_brand_release.sql');
  const ingest = read('api/ingest.js');

  assert.match(migration, /CREATE OR REPLACE VIEW public\.two_brand_verified_trading_release/);
  assert.match(migration, /PARTITION BY repost_signature/);
  assert.match(migration, /ORDER BY has_images DESC, created_at DESC NULLS LAST, id DESC/);
  assert.match(migration, /w\.verdict = 'APPROVED'/);
  assert.match(migration, /w\.confidence >= 90/);
  assert.match(migration, /w\.price_usd >= 1000/);
  assert.doesNotMatch(unpricedTradingMigration, /w\.price_usd >= 1000/);
  assert.match(unpricedTradingMigration, /WTS price is optional on Trading Floor and remains mandatory for Price Research/);
  assert.match(unpricedTradingMigration, /CREATE OR REPLACE VIEW public\.two_brand_verified_trading_release/);
  assert.match(unpricedTradingMigration, /REVOKE ALL ON public\.two_brand_verified_trading_release[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(unpricedTradingMigration, /GRANT SELECT ON public\.two_brand_verified_trading_release TO service_role/);
  assert.match(migration, /duplicate\.status = 'SUPPRESSED'/);
  assert.match(migration, /shadow\.candidate_count > 1/);
  assert.doesNotMatch(migration, /public\.is_listing_duplicate_eligible\(w\.id\)/);
  assert.doesNotMatch(migration, /FROM public\.trading_floor_market_listings m/);
  assert.match(migration, /SET LOCAL lock_timeout = '30s'/);
  assert.match(migration, /r\.status IN \('CATALOG_CONFIRMED', 'HUMAN_APPROVED'\)/);
  assert.match(migration, /REVOKE ALL ON public\.two_brand_verified_trading_release[\s\S]*PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON public\.two_brand_verified_trading_release TO service_role/);
  assert.match(ingest, /isFullReviewedBrandRelease\(\)/);
  assert.match(cacheMigration, /CREATE MATERIALIZED VIEW IF NOT EXISTS public\.two_brand_verified_trading_release_cache/);
  assert.match(cacheMigration, /FROM public\.two_brand_verified_trading_release/);
  assert.match(cacheMigration, /GRANT SELECT ON public\.two_brand_verified_trading_release_cache TO service_role/);
  assert.match(ingest, /rest\/v1\/two_brand_verified_trading_release_cache/);
  assert.match(ingest, /loadVerifiedPublicListings\([\s\S]*selected\.map\(row => row\.id\)/);
  assert.match(ingest, /select: 'id,raw_message'[\s\S]*raw price evidence read returned/);
  assert.match(ingest, /normalizeMarketRow\(\s*\{\s*\.\.\.resolved,\s*raw_message: verified\?\.raw_message \|\| null/);
  assert.match(ingest, /order: 'has_images\.desc,price_usd\.desc\.nullslast,created_at\.desc\.nullslast,id\.desc'/);
  assert.match(ingest, /Number\.isSafeInteger\(cursor\?\.offset\)/);
  assert.match(ingest, /encodeTradingCursor\(\{ \.\.\.cursorRecord, offset: nextOffset \}\)/);
  assert.match(ingest, /controlledVerifiedById = controlledZenithRelease[\s\S]*loadReviewedZenithPublicRows[\s\S]*has_images: Boolean\(verified\?\.has_images\)[\s\S]*sortTradingItems\(controlledRows/);
  assert.match(ingest, /Range: `\$\{start\}-\$\{end\}`/);
  assert.match(ingest, /Prefer: 'return=representation'/);
  assert.doesNotMatch(ingest, /Prefer: 'count=exact'/);
  assert.match(ingest, /const total = Number\.isFinite\(parsedTotal\) \? parsedTotal : null/);
});

test('identity review is signed, evidence-first, and leaves raw records immutable', () => {
  const migration = read('supabase/migrations/20260727190000_full_rolex_patek_release.sql');
  const queue = read('api/identity-review-queue.js');
  const decision = read('api/identity-review-decision.js');
  const ui = read('src/pages/ReviewQueue.tsx');

  assert.match(migration, /CREATE OR REPLACE VIEW public\.two_brand_identity_review_queue/);
  assert.match(migration, /COALESCE\(r\.status, 'UNVERIFIED'\) IN \('UNVERIFIED', 'CONFLICT'\)/);
  assert.match(migration, /READY_FOR_IDENTITY_REVIEW/);
  assert.match(migration, /MARKET_REVIEW_REQUIRED/);
  assert.match(queue, /authorizeDealer\(req, res, new Set\(\['reviewer', 'admin'\]\)\)/);
  assert.match(queue, /req\.query\?\.bucket \|\| 'release-ready'/);
  assert.match(queue, /\.from\('watch_records'\)/);
  assert.match(queue, /\.order\('id', \{ ascending: false \}\)/);
  assert.match(queue, /\.lt\('id', scanCursor\)/);
  assert.match(queue, /enrichIdentityRows\(auth\.client, rows\)/);
  assert.doesNotMatch(queue, /\.from\('two_brand_identity_review_queue'\)/);
  assert.match(queue, /nextCursor/);
  assert.doesNotMatch(queue, /count: 'exact'/);
  assert.match(decision, /sameOrigin\(req\)/);
  assert.match(decision, /loadIdentityRow\(auth\.client, recordId\)/);
  assert.match(decision, /loadLedgerBlocks\(auth\.client, \[queueRow\]\)/);
  assert.doesNotMatch(decision, /\.from\('two_brand_identity_review_queue'\)/);
  assert.match(decision, /rawSupportsExactReference/);
  assert.match(decision, /confirmCatalogCandidate\(canonical\)/);
  assert.match(decision, /\.rpc\('apply_listing_identity_review'/);
  assert.doesNotMatch(decision, /\.from\('watch_records'\)\.(?:update|upsert|insert|delete)/);
  assert.match(ui, /Rolex and Patek identity review/);
  assert.match(ui, /Actionable identities are loaded in bounded pages of 50/);
  assert.match(ui, /Human approve identity/);
});

test('bounded identity pages apply every non-identity static publication gate', () => {
  const ready = {
    record_id: 'record-1',
    raw_message: 'Rolex 126500LN black USD 28000',
    verdict: 'APPROVED',
    confidence: 90,
    listing_type: 'WTS',
    price_usd: 28000,
    flags: [],
  };
  assert.equal(MAX_SCANNED_PER_PAGE, 1000);
  assert.equal(passesStaticReleaseGates(ready), true);
  assert.equal(passesStaticReleaseGates({ ...ready, raw_message: '' }), false);
  assert.equal(passesStaticReleaseGates({ ...ready, confidence: 89 }), false);
  assert.equal(passesStaticReleaseGates({ ...ready, listing_type: 'MULTI' }), false);
  assert.equal(passesStaticReleaseGates({ ...ready, price_usd: 999 }), true);
  assert.equal(passesStaticReleaseGates({ ...ready, price_usd: null }), true);
  assert.equal(passesStaticReleaseGates({ ...ready, flags: ['BUNDLE_SPLIT_REQUIRED'] }), false);
  assert.equal(passesStaticReleaseGates({
    ...ready,
    listing_type: 'WTB',
    price_usd: null,
  }), true);
});

test('identity approval requires complete two-brand canonical evidence', () => {
  assert.equal(rawSupportsExactReference('Rolex 126500LN black dial', '126500LN'), true);
  assert.equal(rawSupportsExactReference('Patek 5712/1A only', '5712/1A-001'), false);

  assert.deepEqual(validateDecisionBody({
    recordId: 'record-1',
    decision: 'APPROVE',
    reason: 'Exact reference and dial are visible in the raw listing.',
    canonical: {
      brand: 'Rolex',
      model: 'Cosmograph Daytona',
      reference: '126500LN',
      dial_color: 'Black',
    },
  }).value?.canonical, {
    brand: 'Rolex',
    model: 'Cosmograph Daytona',
    reference: '126500LN',
    dial_color: 'Black',
  });
  assert.match(validateDecisionBody({
    recordId: 'record-2',
    decision: 'APPROVE',
    reason: 'Complete reviewer reason.',
    canonical: {
      brand: 'Audemars Piguet',
      model: 'Royal Oak',
      reference: '15500ST',
      dial_color: 'Blue',
    },
  }).error, /Rolex and Patek/);
});

test('CTO control center makes the full two-brand release authoritative', () => {
  const control = read('docs/CTO_CONTROL_CENTER.md');
  const release = read('docs/FULL_ROLEX_PATEK_RELEASE_2026-07-27.md');
  assert.match(control, /FULL_ROLEX_PATEK_RELEASE_2026-07-27\.md/);
  assert.match(release, /two_brand_verified_trading_release/);
  assert.match(release, /PUBLICATION_REFERENCES=ALL_REVIEWED/);
  assert.match(release, /no `watch_records` writes/);
});
