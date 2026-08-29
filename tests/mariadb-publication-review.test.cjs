'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPublicationReview, sourceMediaUrl } = require('../tools/mariadb-live/publication-review.cjs');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function proposal(source, overrides = {}) {
  const candidate = overrides.candidate || {
    raw_line: source.raw_message,
    brand: 'Patek Philippe',
    reference: '5712/1A',
    listing_type: 'WTB',
    dial_color: 'Blue',
    prices: [],
  };
  return {
    source_record_id: source.source_record_id,
    source_hash: source.raw_sha256,
    bundle_status: overrides.bundle_status || 'SINGLE_CANDIDATE',
    catalog_confirmation: overrides.catalog_confirmation || { confirmed: true },
    review_disposition: overrides.review_disposition || 'READY_FOR_HUMAN_APPROVAL',
    review_reasons: overrides.review_reasons || ['CATALOG_CONFIRMED'],
    normalization: {
      normalization_version: 'v4.2-line-condition',
      proposed_candidates: overrides.candidates || [candidate],
    },
  };
}

test('resolves MariaDB front-image keys to the verified listings/full object path', () => {
  assert.equal(
    sourceMediaUrl('677ec3e161c64_front_image.jpg'),
    'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/677ec3e161c64_front_image.jpg',
  );
  assert.equal(
    sourceMediaUrl('listings/full/677ec3e161c64_front_image.jpg'),
    'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/677ec3e161c64_front_image.jpg',
  );
  assert.equal(
    sourceMediaUrl('https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/existing.jpg'),
    'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/existing.jpg',
  );
});

test('keeps a catalog-confirmed no-price WTB on the Trading Floor demand lane', () => {
  const source = sourceRecord({
    id: 'wtb-1', type: 'search', created_on: '2026-08-10 10:00:00',
    title: 'Patek Philippe 5712/1A blue dial full set', brand: 'Patek Philippe',
    reference: '5712/1A', from_name: 'Buyer One', from_number: '+15551234567',
  });
  const row = buildPublicationReview(source, proposal(source));
  assert.equal(row.trading_floor_status, 'READY_FOR_PUBLICATION_REVIEW');
  assert.equal(row.price_research_status, 'DEMAND_PENDING_HUMAN_APPROVAL');
  assert.equal(row.candidate.price, null);
  assert.equal(row.seller.public.phone, null);
  assert.equal(row.seller.private_source_evidence.phone, '+15551234567');
});

test('preserves a bare-dollar WTS source amount without admitting it into Price Research', () => {
  const source = sourceRecord({
    id: 'wts-bare-dollar', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'Rolex 116500LN white $28000', brand: 'Rolex', reference: '116500LN',
  });
  const candidate = {
    raw_line: source.raw_message, brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    dial_color: 'White', prices: [],
  };
  const row = buildPublicationReview(source, proposal(source, {
    candidate,
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['CURRENCY_AMBIGUOUS'],
  }));
  assert.equal(row.trading_floor_status, 'PUBLISHED_PENDING_VERIFICATION');
  assert.equal(row.price_research_status, 'INELIGIBLE_CURRENCY_OR_FX');
  assert.equal(row.candidate.price.amount_original, 28000);
  assert.equal(row.candidate.price.currency_original, null);
  assert.equal(row.candidate.price.amount_usd, null);
  assert.equal(row.candidate.price.raw_price_text, '$28000');
  assert.equal(row.candidate.price.currency_evidence, 'bare_dollar_unconfirmed');
  assert.equal(row.candidate.price.analytics_currency_evidence_eligible, false);
});

test('does not manufacture a display price from unlabelled references, years, or quantities', () => {
  const source = sourceRecord({
    id: 'wts-no-explicit-price', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'Rolex 116500LN white 2020 full set 108k', brand: 'Rolex', reference: '116500LN',
  });
  const candidate = {
    raw_line: source.raw_message, brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    dial_color: 'White', prices: [],
  };
  const row = buildPublicationReview(source, proposal(source, { candidate }));
  assert.equal(row.candidate.price, null);
  assert.equal(row.price_research_status, 'INELIGIBLE_NO_PRICE');
});

test('requires timestamped FX provenance before non-USD sales analytics', () => {
  const source = sourceRecord({
    id: 'wts-hkd', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'Rolex 116500LN white HKD 220000', brand: 'Rolex', reference: '116500LN',
  });
  const candidate = {
    raw_line: source.raw_message, brand: 'Rolex', reference: '116500LN', listing_type: 'WTS',
    dial_color: 'White', prices: [{
      is_primary: true, amount_original: 220000, amount_usd: 28205,
      currency_original: 'HKD', currency_evidence: 'explicit_line_currency', raw_price_text: 'HKD 220000',
    }],
  };
  const row = buildPublicationReview(source, proposal(source, { candidate }));
  assert.equal(row.trading_floor_status, 'READY_FOR_PUBLICATION_REVIEW');
  assert.equal(row.price_research_status, 'INELIGIBLE_FX_UNVERIFIED');
});

test('routes strong non-watch inventory to Trading Floor only with explicit price evidence', () => {
  const source = sourceRecord({
    id: 'jewelry-1', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'Diamond necklace USD 12000', brand: 'Independent', from_name: 'Jeweler',
  });
  const row = buildPublicationReview(source, proposal(source, {
    candidates: [],
    bundle_status: 'NO_CANDIDATE',
    catalog_confirmation: { confirmed: false },
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['CATALOG_IDENTITY_INCOMPLETE'],
  }));
  assert.equal(row.category, 'JEWELRY');
  assert.equal(row.trading_floor_status, 'PUBLISHED_PENDING_VERIFICATION');
  assert.equal(row.price_research_status, 'INELIGIBLE_NON_WATCH');
  assert.equal(row.candidate.price.currency_original, 'USD');
  assert.equal(row.candidate.price.amount_usd, 12000);
});

test('non-watch identity never inherits watch-parser candidate attributes', () => {
  const source = sourceRecord({
    id: 'cartier-necklace-1', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'WTS Cartier diamond necklace style 116500 USD 12000', brand: 'Cartier',
  });
  const row = buildPublicationReview(source, proposal(source, {
    candidate: {
      raw_line: source.raw_message, brand: 'Rolex', reference: '116500',
      listing_type: 'WTS', dial_color: 'White', prices: [],
    },
    catalog_confirmation: { confirmed: false },
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['NON_WATCH_CATEGORY'],
  }));
  assert.equal(row.category, 'JEWELRY');
  assert.equal(row.candidate.brand, 'Cartier');
  assert.match(row.candidate.model, /Cartier diamond necklace/);
  assert.equal(row.candidate.reference, null);
  assert.equal(row.candidate.dial_color, null);
  assert.equal(row.price_research_status, 'INELIGIBLE_NON_WATCH');
});

test('retains a bare-dollar non-watch amount for display without creating USD analytics', () => {
  const source = sourceRecord({
    id: 'handbag-bare-dollar', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'WTS Hermes Birkin 30 handbag $24,000', brand: 'Hermes', from_name: 'Seller',
  });
  const row = buildPublicationReview(source, proposal(source, {
    candidates: [], bundle_status: 'NO_CANDIDATE', catalog_confirmation: { confirmed: false },
    review_disposition: 'HUMAN_REVIEW', review_reasons: ['NON_WATCH_CATEGORY'],
  }));
  assert.equal(row.category, 'HANDBAG');
  assert.equal(row.trading_floor_status, 'PUBLISHED_PENDING_VERIFICATION');
  assert.equal(row.price_research_status, 'INELIGIBLE_NON_WATCH');
  assert.equal(row.candidate.price.amount_original, 24000);
  assert.equal(row.candidate.price.currency_original, null);
  assert.equal(row.candidate.price.amount_usd, null);
});

test('keeps bundle parent media out of every proposed child', () => {
  const source = sourceRecord({
    id: 'bundle-1', type: 'sale', created_on: '2026-08-10 10:00:00',
    title: 'Rolex 116500LN USD 28000\nPatek 5712/1A USD 100000',
    front_image: 'bundle_front_image.jpg', is_bundle: 1,
  });
  const candidates = [
    { raw_line: 'Rolex 116500LN USD 28000', brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', prices: [] },
    { raw_line: 'Patek 5712/1A USD 100000', brand: 'Patek Philippe', reference: '5712/1A', listing_type: 'WTS', prices: [] },
  ];
  const row = buildPublicationReview(source, proposal(source, {
    candidates,
    bundle_status: 'BUNDLE_SPLIT_REQUIRED',
    review_disposition: 'HUMAN_REVIEW',
    review_reasons: ['BUNDLE_SPLIT_REQUIRED'],
  }));
  assert.equal(row.trading_floor_status, 'BUNDLE_REVIEW_ONLY');
  assert.equal(row.media.exact_source_lineage, true);
  assert.equal(row.review_children.length, 2);
  assert.ok(row.review_children.every(child => child.source_media_key === null && child.public_image_eligible === false));
});

test('fails closed when source identity or immutable hash does not match', () => {
  const source = sourceRecord({ id: 'lineage-1', type: 'sale', created_on: '2026-08-10 10:00:00', title: 'Rolex 116500LN' });
  const mismatched = proposal(source);
  mismatched.source_hash = '0'.repeat(64);
  assert.throws(() => buildPublicationReview(source, mismatched), /hash mismatch/);
});
