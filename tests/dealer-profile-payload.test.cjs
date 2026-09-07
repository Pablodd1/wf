'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildDealerStats,
  hasAmbiguousShorthandPrice,
  hasCrossBrandReferenceContradiction,
  sanitizeDealerListing,
  sanitizeDealerProfile,
} = require('../api/dealer-profile.js');

test('dealer profile exposes only approved activity metrics and verified contact', () => {
  const stats = buildDealerStats([
    { listing_type: 'WTS', listing_date: '2025-01-02T00:00:00Z' },
    { listing_type: 'WTB', listing_date: '2026-01-03T00:00:00Z' },
  ], { whatsapp_group_count: 4, contact_consent: true }, '+1 (786) 956-9201', {
    wts_posts: 40,
    wtb_posts: 3,
    first_post_at: '2020-01-01T00:00:00Z',
    last_post_at: '2026-08-07T00:00:00Z',
  });

  assert.deepEqual(stats, {
    wts_count: 40,
    wtb_count: 3,
    group_count: 4,
    first_post: '2020-01-01T00:00:00Z',
    latest_post: '2026-08-07T00:00:00Z',
    verified_contact_info: { phone: '+1 (786) 956-9201', verification_status: 'VERIFIED' },
  });
  assert.equal('total_posts' in stats, false);
  assert.equal('active_listings' in stats, false);
});

test('dealer profile keeps raw messages, currency, and normalized prices in its contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.match(source, /price_usd,currency,raw_message/);
  assert.match(source, /raw_message_access: true/);
  assert.doesNotMatch(source, /WITHHELD_UNTIL_APPLIED_LINEAGE_AGGREGATE/);
  assert.match(source, /price_review_required/);
});

test('dealer profile fails closed for shorthand prices misparsed as cents-free USD', () => {
  for (const listing of [
    { raw_message: '126711CHNR, $17,9 + label', price_usd: 179, display_price: '$179' },
    { raw_message: '116518LN, $40,8 + label', price_usd: 408, display_price: '$408' },
  ]) {
    assert.equal(hasAmbiguousShorthandPrice(listing), true);
    const safe = sanitizeDealerListing(listing);
    assert.equal(safe.price_usd, null);
    assert.equal(safe.display_price, null);
    assert.equal(safe.price_review_required, true);
    assert.equal(safe.price_review_reason, 'AMBIGUOUS_SHORTHAND_PRICE');
  }
  assert.equal(hasAmbiguousShorthandPrice({ raw_message: '$17,900', price_usd: 17900 }), false);
  assert.equal(hasAmbiguousShorthandPrice({ raw_message: '$17,9', price_usd: 17900 }), false);
});

test('dealer profile fails closed for a cross-brand reference contradiction', () => {
  const listing = {
    brand: 'Patek Philippe', reference: '69178', dial_color: 'Tapestry', price_usd: 9300,
    raw_message: 'Crisp 69178 Tapestry Dial naked 🔥$9300 + lbl🔥',
  };
  assert.equal(hasCrossBrandReferenceContradiction(listing), true);
  const safe = sanitizeDealerListing(listing);
  assert.equal(safe.brand, null);
  assert.equal(safe.reference, null);
  assert.equal(safe.dial_color, null);
  assert.equal(safe.price_usd, null);
  assert.equal(safe.identity_review_required, true);
  assert.equal(safe.price_review_reason, 'IDENTITY_PENDING_REVIEW');
  assert.equal(hasCrossBrandReferenceContradiction({ ...listing, raw_message: 'Patek Philippe 69178 $9300' }), false);
});

test('dealer profile distinguishes aggregate-only group counts from published group names', () => {
  const countOnly = sanitizeDealerProfile({ stats: { group_count: 12 }, listings: [], groups: [] });
  assert.equal(countOnly.group_details_status, 'COUNT_ONLY');
  assert.deepEqual(countOnly.groups, []);

  const detailed = sanitizeDealerProfile({ stats: { group_count: 1 }, listings: [], groups: [{ name: 'Published group' }] });
  assert.equal(detailed.group_details_status, 'PUBLISHED_DETAILS');
  assert.deepEqual(detailed.groups, [{ name: 'Published group' }]);
});

test('dealer profile requires approved database evidence and never promotes static source profiles', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-profile.js'), 'utf8');
  assert.doesNotMatch(source, /sourceProfilePayload/);
  assert.match(source, /get_approved_dealer_profile_v2/);
  assert.match(source, /dealer\.status !== 'VERIFIED'/);
  assert.match(source, /listing_identity_reviews/);
  assert.match(source, /seller_listing_lineage_staging/);
});
