'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  overlapCounts,
  phoneOverlapCounts,
  reviewCandidates,
} = require('../tools/dealer-lineage/audit-directory-source-overlap.cjs');

test('counts only exact immutable source IDs', () => {
  assert.deepEqual(
    overlapCounts(
      [{ source_id: 'a' }, { source_id: 'b' }],
      [{ source_id: 'b' }, { source_id: 'c' }, { source_id: 'c' }]
    ),
    { source_candidates: 2, directory_candidates: 2, exact_source_id_matches: 1 }
  );
});

test('review manifest omits contact and never auto-verifies', () => {
  assert.deepEqual(
    reviewCandidates(
      [{ source_identity: '+15551112222', source_record_id: 'record-1', seller_listing_id: 'listing-1' }],
      [{ source_id: 'profile-1', phone_normalized: '+1 555 111 2222' }]
    ),
    [{
      directory_source_id: 'profile-1',
      source_record_id: 'record-1',
      seller_listing_id: 'listing-1',
      evidence: 'EXACT_NORMALIZED_PHONE_SUPPORT',
      auto_verified: false,
      contact_consent: false,
    }]
  );
});

test('counts phone overlap as supporting evidence without inferring dealers', () => {
  assert.deepEqual(
    phoneOverlapCounts(
      [{ source_identity: '+1 (555) 111-2222' }, { source_identity: '15551112222' }, { source_identity: '999' }],
      [{ phone_normalized: '+1 555 111 2222' }]
    ),
    {
      seller_lineage_rows: 3,
      directory_phone_identities: 1,
      phone_supported_listing_rows: 2,
      phone_supported_unique_identities: 1,
    }
  );
});
