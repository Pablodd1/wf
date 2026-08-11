'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const priceResearch = fs.readFileSync(path.join(root, 'api/price-research.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260811150000_trading_floor_pending_publication_contract.sql'),
  'utf8',
);

test('forward view admits only approved rows or reconciled QNSA pending singles', () => {
  assert.match(migration, /upper\(COALESCE\(l\.verdict, ''\)\) = 'APPROVED'/);
  assert.match(migration, /l\.trading_floor_status = 'published_pending_verification'/);
  assert.match(migration, /l\.normalization_run_key IS NOT NULL/);
  assert.match(migration, /l\.publication_review_status = 'PENDING_REVIEW'/);
  assert.match(migration, /c\.status = 'NORMALIZATION_STAGED'/);
  assert.match(migration, /c\.error_rows = 0/);
  assert.match(migration, /l\.raw_message_version_id IS NOT NULL/);
  assert.match(migration, /l\.parent_id IS NULL/);
  assert.match(migration, /COALESCE\(l\.is_bundle, FALSE\) = FALSE/);
});

test('Trading Floor queries category and does not restore an approved-only query', () => {
  assert.match(api, /queryParams\.set\('item_category', `eq\.\$\{itemCategory\}`\)/);
  assert.doesNotMatch(api, /queryParams\.set\('verdict', 'in\.\(APPROVED,approved\)'\)/);
  assert.match(api, /pageResult\.records\.filter\(isTradingFloorSourceRow\)/);
  assert.match(api, /item_category: normalizeItemCategory\(row\.item_category \|\| row\.category\)/);
});

test('pending Trading Floor publication does not loosen Price Research', () => {
  assert.match(priceResearch, /from\('price_research_verified_source'\)/);
  assert.match(priceResearch, /function isPriceResearchAdmissionCandidate\(row\)/);
  assert.match(priceResearch, /isReleaseListingEligible\(row\) \|\| isHumanReviewAnalyticsCandidate\(row\)/);
  assert.match(priceResearch, /classifyResearchEligibility\(row, catalogHit\)/);
  assert.match(priceResearch, /listing_type/);
  assert.doesNotMatch(priceResearch, /published_pending_verification/);
});

test('contact remains consent-gated and bundle media remains fail-closed', () => {
  assert.match(migration, /WHEN COALESCE\(l\.contact_consent, FALSE\)/);
  assert.match(migration, /COALESCE\(l\.contact_consent, FALSE\)\s+AS contact_publication_approved/);
  assert.match(api, /const contactApproved = row\.contact_publication_approved === true/);
  assert.match(api, /const sellerPhone = contactApproved/);
  assert.match(migration, /l\.parent_id IS NULL[\s\S]*COALESCE\(l\.is_bundle, FALSE\) = FALSE[\s\S]*AS user_image_url/);
});
