// tests/authoritative-evidence-normalizer.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAuthoritativeRow,
  resolveSourceTextEvidence,
  resolveStrictIntentFromText
} = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

test('1. Provenance: throws if any required provenance field is missing (no synthesis)', () => {
  assert.throws(() => {
    normalizeAuthoritativeRow({
      source_id: '1',
      source_hash: 'h'.repeat(64),
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions'
      // missing source_record_id
    });
  }, /Missing required source_record_id/);

  assert.throws(() => {
    normalizeAuthoritativeRow({
      source_id: '1',
      source_hash: 'h'.repeat(64),
      source_system: 'Benchmark Test',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_record_id: 'mysql_auctions_1'
    });
  }, /Benchmark namespace violation/);
});

test('2. Source Text Precedence: description alone', () => {
  const norm = normalizeAuthoritativeRow({
    source_id: 'desc-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_desc_1',
    raw_payload: {
      description: 'WTS: Rolex Submariner 126610LN 14000 USD',
      title: 'Ignored Title',
      comments: 'Ignored Comments'
    }
  });
  assert.equal(norm.listing_text_source, 'description');
  assert.equal(norm.listing_text_evidence, 'WTS: Rolex Submariner 126610LN 14000 USD');
  assert.ok(norm.listing_text_sha256);
  assert.equal(norm.intent, 'WTS');
  assert.equal(norm.original_price_currency, 'USD');
  assert.equal(norm.price_usd, 14000);
  assert.equal(norm.trading_floor_eligible, true);
  assert.equal(norm.price_research_eligible, true);
});

test('3. Source Text Precedence: title fallback when description is blank', () => {
  const norm = normalizeAuthoritativeRow({
    source_id: 'title-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_title_1',
    raw_payload: {
      description: '   ',
      title: 'WTS: Rolex 124060 11000 USD',
      comments: 'Ignored Comments'
    }
  });
  assert.equal(norm.listing_text_source, 'title');
  assert.equal(norm.listing_text_evidence, 'WTS: Rolex 124060 11000 USD');
  assert.ok(norm.listing_text_sha256);
  assert.equal(norm.intent, 'WTS');
  assert.equal(norm.original_price_currency, 'USD');
  assert.equal(norm.price_usd, 11000);
  assert.equal(norm.trading_floor_eligible, true);
  assert.equal(norm.price_research_eligible, true);
});

test('4. Source Text Precedence: comments fallback when description and title are blank', () => {
  const norm = normalizeAuthoritativeRow({
    source_id: 'comments-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_comments_1',
    raw_payload: {
      description: null,
      title: '',
      comments: 'WTS: Rolex 116500LN 28000 USD'
    }
  });
  assert.equal(norm.listing_text_source, 'comments');
  assert.equal(norm.listing_text_evidence, 'WTS: Rolex 116500LN 28000 USD');
  assert.ok(norm.listing_text_sha256);
  assert.equal(norm.intent, 'WTS');
  assert.equal(norm.original_price_currency, 'USD');
  assert.equal(norm.price_usd, 28000);
  assert.equal(norm.trading_floor_eligible, true);
  assert.equal(norm.price_research_eligible, true);
});

test('5. Source Text Precedence: all three blank routes to MISSING_SOURCE_TEXT', () => {
  const norm = normalizeAuthoritativeRow({
    source_id: 'blank-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_blank_1',
    raw_payload: {
      description: '',
      title: '   ',
      comments: null
    }
  });
  assert.equal(norm.listing_text_source, null);
  assert.equal(norm.listing_text_evidence, null);
  assert.equal(norm.listing_text_sha256, null);
  assert.equal(norm.trading_floor_eligible, false);
  assert.equal(norm.price_research_eligible, false);
  assert.ok(norm.review_flags.includes('MISSING_SOURCE_TEXT'));
  assert.equal(norm.reconciliation_category, 'REVIEW_REQUIRED');
});

test('6. Zero fallbacks to raw_payload metadata for price, currency, year, condition, intent', () => {
  const row = {
    source_id: 'no-fallbacks',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_no_fallbacks',
    source_created_on: '2026-01-01T00:00:00.000Z',
    raw_payload: {
      title: 'Rolex Daytona 116500LN', // no price, no currency, no year, no condition, no intent keywords
      type: 'sale',
      price: '28000',
      currency: 'USD',
      year: '2021',
      condition: 'Mint'
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.intent, null, 'Must not fallback to raw_payload.type');
  assert.equal(norm.original_price_amount, null, 'Must not fallback to raw_payload.price');
  assert.equal(norm.original_price_currency, null, 'Must not fallback to raw_payload.currency');
  assert.equal(norm.price_usd, null);
  assert.equal(norm.currency_status, 'MISSING_PRICE');
  assert.equal(norm.year, null, 'Must not fallback to raw_payload.year');
  assert.equal(norm.condition, null, 'Must not fallback to raw_payload.condition');
  assert.equal(norm.price_research_eligible, false);
});

test('7. DigitalOcean image URL rule: unreachable URL returns image_url=null and IMAGE_KEY_PRESERVED_URL_UNVERIFIED', () => {
  const row = {
    source_id: 'img-1',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_img_1',
    raw_payload: {
      title: 'WTS: Rolex Submariner 126610LN 14000 USD',
      front_image: '677ec3e161c64_front_image.jpg'
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.image_key, '677ec3e161c64_front_image.jpg');
  assert.equal(norm.image_url, null, 'Must return null until reachability is verified');
  assert.equal(norm.image_evidence_type, 'IMAGE_KEY_PRESERVED_URL_UNVERIFIED');
  assert.notEqual(norm.image_evidence_type, 'SOURCE_LISTING_IMAGE');
});

test('8. Unknown intent handling: held from publication and price research', () => {
  const row = {
    source_id: 'unk-intent',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_unk',
    raw_payload: {
      title: 'Rolex Submariner 126610LN 14000 USD' // no FS, WTS, WTB cues
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.intent, null);
  assert.equal(norm.trading_floor_status, 'HELD_INTENT_UNKNOWN');
  assert.equal(norm.trading_floor_eligible, false);
  assert.equal(norm.price_research_status, 'INELIGIBLE_TRADING_FLOOR_HOLD');
  assert.equal(norm.price_research_eligible, false);
  assert.ok(norm.review_flags.includes('UNKNOWN_INTENT'));
  assert.equal(norm.reconciliation_category, 'REVIEW_REQUIRED');
});

test('9. Separated Status: unpriced WTS listing is Trading Floor ready but Price Research ineligible', () => {
  const row = {
    source_id: 'unpriced-wts',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_unpriced_wts',
    raw_payload: {
      title: 'WTS: Rolex Submariner 126610LN PM for price'
    }
  };

  const norm = normalizeAuthoritativeRow(row);
  assert.equal(norm.intent, 'WTS');
  assert.equal(norm.trading_floor_status, 'ELIGIBLE_WTS');
  assert.equal(norm.trading_floor_eligible, true, 'Unpriced WTS listing with known identity is Trading Floor eligible');
  assert.equal(norm.price_research_status, 'INELIGIBLE_MISSING_PRICE');
  assert.equal(norm.price_research_eligible, false, 'Unpriced listing is Price Research ineligible');
});

test('10. Dealer Ratings: not published without explicit source review evidence', () => {
  const unverified = normalizeAuthoritativeRow({
    source_id: 'dealer-unverified',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_dealer_unverified',
    raw_payload: {
      title: 'WTS: Rolex 124060 11000 USD',
      dealer_rating: 4.8
      // missing dealer_rating_evidence
    }
  });
  assert.equal(unverified.seller_rating, null, 'Must hold rating without review evidence');
  assert.equal(unverified.seller_rating_status, 'HELD_MISSING_REVIEW_EVIDENCE');

  const verified = normalizeAuthoritativeRow({
    source_id: 'dealer-verified',
    source_hash: 'h'.repeat(64),
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
    source_record_id: 'mysql_auctions_dealer_verified',
    raw_payload: {
      title: 'WTS: Rolex 124060 11000 USD',
      dealer_rating: 4.8,
      dealer_rating_evidence: 'verified_marketplace_reviews_count: 52'
    }
  });
  assert.equal(verified.seller_rating, 4.8);
  assert.equal(verified.seller_rating_status, 'SOURCE_REVIEW_VERIFIED');
});
