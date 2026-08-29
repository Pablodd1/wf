'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../api/reviewed-market-inventory.js');
const linkage = require('../tools/dealer-lineage/reconcile-reviewed-workbook-dealer-links.cjs');

const HMAC_KEY = 'unit-test-only-reviewed-link-evidence-key';
const VERIFIED_DEALER = '11111111-1111-4111-8111-111111111111';
const OTHER_DEALER = '22222222-2222-4222-8222-222222222222';

function candidate(overrides = {}) {
  return {
    reviewed_listing_id: 'admission_abc',
    seller_source_id: '+1 (305) 555-0100',
    source_file_sha256: 'a'.repeat(64),
    source_row_number: 2,
    source_record_id_sha256: 'b'.repeat(64),
    ...overrides,
  };
}

test('only an exact unique verified phone/WhatsApp identity links a verified dealer', () => {
  const index = linkage.buildVerifiedIdentityIndex([
    {
      dealer_id: VERIFIED_DEALER,
      source_identity: '+1 305 555 0100',
      identity_type: 'WHATSAPP',
      verification_status: 'VERIFIED',
    },
  ], new Set([VERIFIED_DEALER]));
  const result = linkage.reconcileCandidates([candidate()], index, { hmacKey: HMAC_KEY });
  assert.equal(result.matched.length, 1);
  assert.equal(result.held.length, 0);
  assert.equal(result.matched[0].dealer_id, VERIFIED_DEALER);
  assert.equal(result.matched[0].link_method, 'EXACT_VERIFIED_PHONE');
  assert.equal(result.matched[0].evidence.verification_basis,
    'UNIQUE_VERIFIED_PHONE_OR_WHATSAPP_TO_VERIFIED_DEALER');
  assert.ok(!Object.keys(result.matched[0].evidence).some(key => /phone|whatsapp|source_identity$/i.test(key)));
  assert.notEqual(result.matched[0].evidence.source_identity_hmac_sha256, candidate().seller_source_id);
});

test('duplicate verified matches conflict and are held', () => {
  const index = linkage.buildVerifiedIdentityIndex([
    { dealer_id: VERIFIED_DEALER, source_identity: '13055550100', identity_type: 'PHONE', verification_status: 'VERIFIED' },
    { dealer_id: OTHER_DEALER, source_identity: '+1 305 555 0100', identity_type: 'WHATSAPP', verification_status: 'VERIFIED' },
  ], new Set([VERIFIED_DEALER, OTHER_DEALER]));
  const result = linkage.reconcileCandidates([candidate()], index, { hmacKey: HMAC_KEY });
  assert.equal(result.matched.length, 0);
  assert.equal(result.held[0].reason, 'CONFLICTING_VERIFIED_IDENTITY_MATCHES');
  assert.deepEqual(result.held[0].candidate_dealer_ids, [VERIFIED_DEALER, OTHER_DEALER]);
});

test('unmatched and invalid source identities are held', () => {
  const result = linkage.reconcileCandidates([
    candidate(),
    candidate({ reviewed_listing_id: 'admission_bad', seller_source_id: 'unknown' }),
  ], new Map(), { hmacKey: HMAC_KEY });
  assert.deepEqual(result.held.map(row => row.reason), [
    'NO_UNIQUE_VERIFIED_IDENTITY_MATCH',
    'INVALID_OR_MISSING_SOURCE_IDENTITY',
  ]);
});

test('unverified identities and identities belonging to unverified dealers never enter the index', () => {
  const index = linkage.buildVerifiedIdentityIndex([
    { dealer_id: VERIFIED_DEALER, source_identity: '13055550100', identity_type: 'PHONE', verification_status: 'OBSERVED' },
    { dealer_id: OTHER_DEALER, source_identity: '13055550101', identity_type: 'WHATSAPP', verification_status: 'VERIFIED' },
  ], new Set([VERIFIED_DEALER]));
  assert.equal(index.size, 0);
});

function mockDirectoryClient({ sidecar = [], dealers = [], sidecarError = null } = {}) {
  return {
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() {
          if (table === 'reviewed_workbook_dealer_links') {
            return Promise.resolve({ data: sidecar, error: sidecarError });
          }
          if (table === 'dealer_listing_links') return Promise.resolve({ data: [], error: null });
          if (table === 'dealers') return Promise.resolve({ data: dealers, error: null });
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return builder;
    },
  };
}

test('reviewed text listing IDs receive feedback/group evidence without inventing a rating or phone', async () => {
  const record = {
    id: 'admission_abc',
    seller_name: 'Source poster',
    seller_phone: '+1 305 555 0100',
    contact_publication_approved: false,
  };
  const client = mockDirectoryClient({
    sidecar: [{
      reviewed_listing_id: record.id,
      dealer_id: VERIFIED_DEALER,
      link_method: 'EXACT_VERIFIED_PHONE',
    }],
    dealers: [{
      id: VERIFIED_DEALER,
      display_name: 'Verified Dealer',
      company_name: 'Dealer Co',
      country_code: 'US',
      city: 'Miami',
      rating: null,
      review_count: 9,
      whatsapp_group_count: 3,
      status: 'VERIFIED',
    }],
  });
  const [enriched] = await api.enrichRecordsWithDealerDirectory(client, [record]);
  assert.equal(enriched.dealer_id, VERIFIED_DEALER);
  assert.equal(enriched.seller_name, 'Verified Dealer');
  assert.equal(enriched.seller_rating, null);
  assert.equal(enriched.seller_review_count, 9);
  assert.equal(enriched.seller_rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
  assert.equal(enriched.seller_group_count, 3);
  assert.equal(enriched.seller_phone, null);
  assert.equal(enriched.phone_number, null);
  assert.equal(enriched.dealer_profile_path, `/reference-check/${VERIFIED_DEALER}`);
});

test('group count is independent of feedback count and sidecar failure is fail-closed', async () => {
  const [unlinked] = await api.enrichRecordsWithDealerDirectory(
    mockDirectoryClient({ sidecarError: new Error('table unavailable') }),
    [{ id: 'admission_held', seller_name: 'Poster', seller_phone: '13055550100', contact_publication_approved: false }],
  );
  assert.equal(unlinked.dealer_id, undefined);
  assert.equal(unlinked.seller_phone, null);

  const [linked] = await api.enrichRecordsWithDealerDirectory(mockDirectoryClient({
    sidecar: [{ reviewed_listing_id: 'admission_zero_group', dealer_id: VERIFIED_DEALER, link_method: 'EXACT_VERIFIED_PHONE' }],
    dealers: [{
      id: VERIFIED_DEALER, display_name: 'Dealer', company_name: null,
      country_code: null, city: null, rating: null, review_count: 4,
      whatsapp_group_count: 0, status: 'VERIFIED',
    }],
  }), [{ id: 'admission_zero_group', contact_publication_approved: false }]);
  assert.equal(linked.seller_review_count, 4);
  assert.equal(linked.seller_group_count, 0);
});

test('sidecar migration is service-only and contains no contact column', () => {
  const migration = fs.readFileSync(path.join(
    __dirname,
    '../supabase/migrations/20260817020000_reviewed_workbook_dealer_links.sql',
  ), 'utf8');
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /^\s*(?:phone|phone_number|whatsapp|source_identity)\s+text/im);
  assert.match(migration, /reviewed_listing_id text PRIMARY KEY/);
});
