'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { luxuryIdentityEligibility, normalizeLuxuryIdentity } = require('../api/_lib/luxury-item-normalization.cjs');
const { buildLuxuryResearchCoverage } = require('../api/_lib/luxury-research-coverage.cjs');
const { buildPublicationReview } = require('../tools/mariadb-live/publication-review.cjs');

function source(overrides = {}) {
  return {
    source_record_id: 'luxury-1',
    source_id: 1,
    raw_sha256: 'a'.repeat(64),
    source_created_on: '2026-08-15T00:00:00Z',
    raw_message_source: 'description',
    raw_message: 'WTS Hermes Birkin 30 Togo leather mint $25,000',
    raw_data: { title: 'Hermes Birkin 30 Togo handbag', price: 25000, from_name: 'Dealer One' },
    ...overrides,
  };
}

test('normalizes explicit non-watch maker, item name, type, condition, and source identity', () => {
  assert.deepEqual(normalizeLuxuryIdentity(source(), 'HANDBAG'), {
    brand: 'Hermès', model: 'Hermes Birkin 30 Togo handbag', reference: null,
    condition: 'Used - Like New', luxury_item_name: 'Hermes Birkin 30 Togo handbag', luxury_item_type: 'Birkin',
    source_item_description: 'Hermes Birkin 30 Togo handbag', maker_evidence_status: 'SOURCE_OR_SIGNATURE_EVIDENCE',
  });
});

test('uses signature product evidence without copying a full raw message into the normalized item name', () => {
  assert.deepEqual(normalizeLuxuryIdentity({
    raw_message: 'Excellent Condition\nBirkin 35 togo Blue Izmir Palladium Hardware N Stamp No Box $12000',
    raw_data: { model: 'Excellent Condition\nBirkin 35 togo Blue Izmir Palladium Hardware N Stamp No Box $12000' },
  }, 'HANDBAG'), {
    brand: 'Hermès', model: 'Hermès Birkin', reference: null, condition: 'Used - Good',
    luxury_item_name: 'Hermès Birkin', luxury_item_type: 'Birkin',
    source_item_description: 'Excellent Condition Birkin 35 togo Blue Izmir Palladium Hardware N Stamp No Box $12000',
    maker_evidence_status: 'SOURCE_OR_SIGNATURE_EVIDENCE',
  });
});

test('non-watch publication withholds watch packaging terms and category-only chatter', () => {
  assert.deepEqual(luxuryIdentityEligibility({
    raw_message: 'VC 7900v 2021year full set 20links No belt 32100usd',
  }, 'ACCESSORY'), {
    eligible: false, item_type: 'Belt', reasons: ['WHOLE_WATCH_EVIDENCE'],
  });
  assert.deepEqual(luxuryIdentityEligibility({
    raw_message: 'Please welcome Courtney to our group of Jewelry addicts',
  }, 'JEWELRY'), {
    eligible: false, item_type: null, reasons: ['MISSING_EXPLICIT_ITEM_TYPE'],
  });
  assert.equal(luxuryIdentityEligibility({
    raw_message: 'Louis Vuitton Cyclone sunglasses, brand new with box, GBP 390',
  }, 'ACCESSORY').eligible, true);
  assert.equal(luxuryIdentityEligibility({
    raw_message: 'Cartier cufflinks OG000654, like new, AED 30000',
  }, 'ACCESSORY').eligible, true);
  assert.equal(luxuryIdentityEligibility({
    raw_message: 'Panna 116520 lighter cream color $4350',
  }, 'ACCESSORY').eligible, false);
  assert.equal(luxuryIdentityEligibility({
    raw_message: 'VC5500 2021Y, no steel belt, 24,800 usd',
  }, 'ACCESSORY').eligible, false);
  assert.equal(luxuryIdentityEligibility({
    raw_message: 'Luxury 18K white gold diamond belt cocktail ring',
  }, 'ACCESSORY').eligible, false);
});

test('publication review keeps luxury identity and excludes it from watch Price Research', () => {
  const reviewed = buildPublicationReview(source(), {
    source_record_id: 'luxury-1', source_hash: 'a'.repeat(64), bundle_status: 'NO_CANDIDATE',
    review_disposition: 'READY_FOR_HUMAN_APPROVAL', review_reasons: [],
    normalization: { normalization_version: 'test', proposed_candidates: [] },
    catalog_confirmation: { confirmed: false },
  });
  assert.equal(reviewed.category, 'HANDBAG');
  assert.equal(reviewed.bundle_status, 'SINGLE_CANDIDATE');
  assert.equal(reviewed.candidate.brand, 'Hermès');
  assert.equal(reviewed.candidate.luxury_item_type, 'Birkin');
  assert.equal(reviewed.price_research_status, 'INELIGIBLE_NON_WATCH');
});

test('separate luxury research totals reconcile by category, intent, price, and brand', () => {
  const coverage = buildLuxuryResearchCoverage([
    { category: 'HANDBAG', brand: 'Hermes', listing_type: 'WTS', supplied_price: true, row_count: 4 },
    { category: 'HANDBAG', brand: 'Hermès', listing_type: 'WTS', supplied_price: false, row_count: 2 },
    { category: 'HANDBAG', brand: 'Chanel', listing_type: 'WTB', supplied_price: false, row_count: 3 },
    { category: 'JEWELRY', brand: 'Cartier', listing_type: 'WTS', supplied_price: true, row_count: 5 },
    { category: 'WATCH', brand: 'Rolex', listing_type: 'WTS', supplied_price: true, row_count: 999 },
  ]);
  assert.equal(coverage.total_listing_count, 14);
  assert.deepEqual(coverage.categories[0], {
    category: 'HANDBAG', listing_count: 9, wts_with_price: 4, wts_without_price: 2, wtb_activity: 3,
    brands: [{ brand: 'Hermès', listing_count: 6 }, { brand: 'Chanel', listing_count: 3 }],
  });
});

test('Trading Floor uses a storage-light bounded non-watch RPC with safe fallback', () => {
  const sourceText = fs.readFileSync(path.join(__dirname, '../api/reviewed-market-inventory.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260815103000_qnsa_non_watch_bounded_feed.sql'), 'utf8');
  assert.match(sourceText, /qnsa_non_watch_market_page_rows/);
  assert.match(sourceText, /QNSA_NON_WATCH_FEED_V1/);
  assert.match(sourceText, /luxury_identity_eligible === true/);
  assert.match(sourceText, /nonWatchFeed[\s\S]*\[404, 400\]/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.qnsa_non_watch_market_page_rows/);
  assert.match(migration, /l\.category = v_category/);
  assert.match(migration, /l\.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.match(migration, /CASE WHEN COALESCE\(l\.contact_consent, false\)[\s\S]*THEN COALESCE[\s\S]*ELSE NULL END AS seller_phone/);
  assert.match(migration, /COALESCE\(l\.contact_consent, false\) AS contact_publication_approved/);
  assert.match(migration, /JOIN public\.raw_message_versions rv[\s\S]*rv\.id = l\.raw_message_version_id[\s\S]*rv\.source_record_id = l\.source_record_id[\s\S]*rv\.source_hash = l\.source_hash/);
  assert.match(migration, /conversion_timestamp IS NOT NULL[\s\S]*conversion_source/);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
});

test('Luxury Item Research is a separate route and watch research stays isolated', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/LuxuryResearch.tsx'), 'utf8');
  const summary = fs.readFileSync(path.join(__dirname, '../api/live-release-summary.js'), 'utf8');
  assert.match(app, /path="\/luxury-research"/);
  assert.match(page, /Luxury Item Research/);
  assert.match(page, /separate from watch reference Price Research/i);
  assert.match(page, /Item name, maker, type, and market activity/);
  assert.match(page, /Raw source evidence/);
  assert.match(page, /Maker pending review/);
  assert.match(page, /Dealer profile/);
  assert.match(page, /at least two verified WTS observations/);
  assert.match(summary, /luxury_categories/);
  assert.match(summary, /total_luxury_item_count/);
});
