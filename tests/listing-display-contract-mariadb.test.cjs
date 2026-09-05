// tests/listing-display-contract-mariadb.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildListingDisplayContract } = require('../tools/mariadb-live/listing-display-contract.cjs');

test('1. provenance requirement - throws if source_id or source_hash missing', () => {
  assert.throws(() => {
    buildListingDisplayContract({});
  }, /Provenance assertion failed/);
});

test('2. DigitalOcean spaces image key resolution and PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD for bundles', () => {
  const single = buildListingDisplayContract({
    source_id: 'img-1',
    source_hash: '1'.repeat(64),
    raw_payload: { front_image: 'dial_front.jpg', is_bundle: 0 }
  });
  assert.equal(single.image_evidence_type, 'SOURCE_LINKED_IMAGE');
  assert.equal(single.image_url, 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/dial_front.jpg');

  const bundle = buildListingDisplayContract({
    source_id: 'bundle-img',
    source_hash: '2'.repeat(64),
    raw_payload: { is_bundle: 1, front_image: 'bundle.jpg' }
  });
  assert.equal(bundle.image_evidence_type, 'PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD');
});


test('3. USDT is never treated as USD parity and held for FX', () => {
  const row = buildListingDisplayContract({
    source_id: 'usdt-1',
    source_hash: '3'.repeat(64),
    raw_payload: {
      type: 'sale',
      brand: 'Rolex',
      model: 'Submariner',
      reference: '126610LN',
      price: '14500',
      currency: 'USDT'
    }
  });
  assert.equal(row.currency_status, 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX');
  assert.equal(row.price_usd, null);
  assert.equal(row.price_research_eligible, false);
});

test('4. seller phone is kept strictly private unless contact_publication_approved === true', () => {
  const unapproved = buildListingDisplayContract({
    source_id: 'seller-1',
    source_hash: '4'.repeat(64),
    raw_payload: { from_number: '+1 555 1234', contact_publication_approved: false }
  });
  assert.equal(unapproved.seller_contact, null);

  const approved = buildListingDisplayContract({
    source_id: 'seller-2',
    source_hash: '5'.repeat(64),
    raw_payload: { from_number: '+1 555 1234', contact_publication_approved: true }
  });
  assert.equal(approved.seller_contact, '+1 555 1234');
});

test('5. null/ambiguous intent is strictly excluded from Price Research', () => {
  const noIntent = buildListingDisplayContract({
    source_id: 'intent-1',
    source_hash: '6'.repeat(64),
    raw_payload: {
      brand: 'Rolex',
      model: 'Submariner',
      reference: '126610LN',
      price: '14500',
      currency: 'USD'
    }
  });
  assert.equal(noIntent.intent, null);
  assert.equal(noIntent.price_research_eligible, false);

  const wts = buildListingDisplayContract({
    source_id: 'intent-2',
    source_hash: '7'.repeat(64),
    raw_payload: {
      type: 'sale',
      brand: 'Rolex',
      model: 'Submariner',
      reference: '126610LN',
      price: '14500',
      currency: 'USD'
    }
  });
  assert.equal(wts.intent, 'WTS');
  assert.equal(wts.price_research_eligible, true);
});
