'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { directSubmissionToMarketRow } = require('../api/price-research.js');

function approvedSubmission(overrides = {}) {
  return {
    id: 'submission-1',
    dealer_id: 'dealer-1',
    intent: 'WTS',
    category: 'WATCH',
    raw_message: 'WTS Rolex Daytona 116500LN White USD 30000',
    claimed_fields: {
      brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
      price_amount: 30000, currency: 'USD', catalog_confirmed: true,
      poster_name: 'Registered Dealer', poster_phone: '+13055550101',
    },
    image_urls: ['https://example.com/watch.jpg'],
    review_status: 'APPROVED', publication_status: 'PUBLISHED',
    created_at: '2026-08-14T12:00:00Z',
    ...overrides,
  };
}

test('approved registered WTS becomes source-backed Price Research evidence', () => {
  const row = directSubmissionToMarketRow(approvedSubmission());
  assert.equal(row.id, 'direct:submission-1');
  assert.equal(row.listing_type, 'WTS');
  assert.equal(row.price_usd, 30000);
  assert.equal(row.analytics_currency_status, 'VERIFIED');
  assert.equal(row.owner_reviewed_identity, true);
  assert.equal(row.raw_message, 'WTS Rolex Daytona 116500LN White USD 30000');
  assert.equal(row.seller_phone, null);
  assert.equal(row.contact_publication_approved, false);
});

test('registered dealer phone is returned only with explicit contact publication consent', () => {
  const source = approvedSubmission();
  const row = directSubmissionToMarketRow(approvedSubmission({
    claimed_fields: { ...source.claimed_fields, contact_publication_approved: true },
  }));
  assert.equal(row.seller_phone, '+13055550101');
  assert.equal(row.contact_publication_approved, true);
});

test('unapproved, unconfirmed, bundled, and non-USD WTS evidence fails closed', () => {
  assert.equal(directSubmissionToMarketRow(approvedSubmission({ review_status: 'PENDING_REVIEW' })), null);
  assert.equal(directSubmissionToMarketRow(approvedSubmission({
    claimed_fields: { ...approvedSubmission().claimed_fields, catalog_confirmed: false },
  })), null);

  const bundle = directSubmissionToMarketRow(approvedSubmission({
    claimed_fields: { ...approvedSubmission().claimed_fields, is_bundle: true },
  }));
  assert.deepEqual(bundle.flags, ['BUNDLE_SPLIT_REQUIRED']);
  assert.equal(bundle.has_images, false);

  const hkd = directSubmissionToMarketRow(approvedSubmission({
    claimed_fields: { ...approvedSubmission().claimed_fields, currency: 'HKD', price_amount: 234000 },
  }));
  assert.equal(hkd.price_usd, null);
  assert.equal(hkd.analytics_currency_status, 'UNVERIFIED');
});

test('approved WTB stays demand evidence and never becomes a sale price', () => {
  const row = directSubmissionToMarketRow(approvedSubmission({ intent: 'WTB' }));
  assert.equal(row.listing_type, 'WTB');
  assert.equal(row.price_usd, null);
});
