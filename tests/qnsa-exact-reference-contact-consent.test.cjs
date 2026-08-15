'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(path.join(
  __dirname,
  '../supabase/migrations/20260815183000_qnsa_exact_reference_contact_consent.sql',
), 'utf8');
const inventory = require('../api/reviewed-market-inventory.js');

test('exact-reference RPC preserves rows while withholding unconsented phone evidence', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.qnsa_trading_floor_reference_rows/);
  assert.match(migration, /CASE WHEN COALESCE\(l\.contact_consent, false\) THEN/);
  assert.match(migration, /COALESCE\(l\.contact_consent, false\) AS contact_publication_approved/);
  assert.doesNotMatch(migration, /true AS contact_publication_approved/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM|TRUNCATE|UPDATE\s+staging\.listings/i);
});

test('exact-reference RPC is server-only and retains raw source timestamp text without guessing', () => {
  assert.match(migration, /l\.source_posted_at_text/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role, postgres/);
  assert.doesNotMatch(migration, /source_posted_at_text::timestamptz/i);
});

test('direct-submission evidence coverage mirrors the stored consent snapshot', () => {
  const unconsented = inventory.mapDealerSubmission({
    id: 'unconsented', intent: 'WTS', category: 'WATCH',
    raw_message: 'WTS Rolex Daytona 116500LN Black',
    claimed_fields: {
      brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'Black',
      poster_name: 'Source Dealer', poster_phone: '+13055550101',
      contact_publication_approved: false,
    },
    image_urls: [], review_status: 'APPROVED', publication_status: 'PUBLISHED',
    created_at: '2026-08-15T12:00:00Z',
  });
  assert.equal(unconsented.seller_phone, null);
  assert.equal(unconsented.contact_publication_approved, false);
  assert.equal(unconsented.evidence_coverage.contact.publication_approved, false);

  const consented = inventory.mapDealerSubmission({
    id: 'consented', intent: 'WTS', category: 'WATCH',
    raw_message: 'WTS Rolex Daytona 116500LN Black',
    claimed_fields: {
      brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'Black',
      poster_name: 'Source Dealer', poster_phone: '+13055550101',
      contact_publication_approved: true,
    },
    image_urls: [], review_status: 'APPROVED', publication_status: 'PUBLISHED',
    created_at: '2026-08-15T12:00:00Z',
  });
  assert.equal(consented.seller_phone, '+13055550101');
  assert.equal(consented.contact_publication_approved, true);
  assert.equal(consented.evidence_coverage.contact.publication_approved, true);
});

test('reviewed exact-reference rows expose original timestamp text without changing display chronology', () => {
  const record = inventory.mapReviewedRecord({
    id: 'source-date', supplied_brand: 'Rolex', model: 'Daytona',
    normalized_reference: '116500LN', raw_reference: '116500LN', dial_color: 'Black',
    listing_type: 'WTS', raw_message: 'WTS Rolex 116500LN Black',
    posting_date: '2026-08-15T12:00:00Z', source_posted_at_text: 'legacy source date value',
    contact_publication_approved: false, has_exact_source_image: false,
  });
  assert.equal(record.listing_date, '2026-08-15T12:00:00Z');
  assert.equal(record.source_posted_at_text, 'legacy source date value');
});
