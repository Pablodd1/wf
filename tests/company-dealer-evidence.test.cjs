'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { stableJson, sha256 } = require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const { prepareCompanyDealerEvidence } = require('../tools/mariadb-live/company-dealer-evidence.cjs');

const company = { id: 1, name: 'Synthetic Dealer', phone: '+1 202 555 0101', status: 'verified', is_verified: 1, is_active: 1, is_banned: 0, is_suspended: 0, stars: 5 };
function reviewer(companies = [company]) {
  const bytes = Buffer.from(stableJson({ contract: 'WF_SOURCE_COMPANY_IDENTITY_FIELD_SNAPSHOT_V1', source_database: 'thecollective', source_table: 'companies', observed_at: '2026-09-07T00:00:00Z', companies }));
  return prepareCompanyDealerEvidence(bytes, sha256(bytes));
}
function listing(overrides = {}) {
  const raw = { id: 'SYNTHETIC-COMPANY-LISTING', company_id: 1, from_number: '12025550101', description: 'WTS synthetic listing', ...overrides };
  return { source_id: raw.id, source_hash: sha256(stableJson(raw)), raw_payload: raw, source_system: 'OceanDigital MariaDB', source_database: 'thecollective_inventory', source_table: 'auctions', canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' };
}
test('exact verified company and poster evidence never manufacture review scores or consent', () => {
  const result = reviewer()(listing());
  assert.equal(result.outcome, 'VERIFIED_SOURCE_IDENTITY_CANDIDATE');
  assert.equal(result.seller_rating, null); assert.equal(result.seller_review_count, null);
  assert.equal(result.contact_publication_approved, false); assert.equal(result.publication_performed, false);
});
test('company ID alone cannot attribute a mismatching or ambiguous poster', () => {
  assert.equal(reviewer()(listing({ from_number: '12025550102' })).outcome, 'COMPANY_POSTER_PHONE_MISMATCH');
  assert.equal(reviewer([company, { ...company, id: 2 }])(listing()).outcome, 'PHONE_SHARED_BETWEEN_COMPANIES');
  assert.equal(reviewer()(listing({ from_number: '00000000000' })).outcome, 'NO_VALID_POSTER_PHONE');
  assert.equal(reviewer()(listing({ company_id: 99 })).outcome, 'NO_SOURCE_COMPANY');
});
test('conflicting source verification and restricted companies remain held', () => {
  assert.equal(reviewer([{ ...company, status: 'unverified' }])(listing()).outcome, 'SOURCE_VERIFICATION_UNRESOLVED');
  assert.equal(reviewer([{ ...company, is_banned: 1 }])(listing()).outcome, 'SOURCE_COMPANY_INACTIVE_OR_RESTRICTED');
  assert.equal(reviewer([{ ...company, is_banned: null }])(listing()).outcome, 'SOURCE_COMPANY_INACTIVE_OR_RESTRICTED');
  assert.equal(reviewer([{ ...company, name: null }])(listing()).outcome, 'SOURCE_COMPANY_NAME_MISSING');
});
test('tampered source bytes, duplicate companies and wrong evidence scope fail closed', () => {
  assert.throws(() => prepareCompanyDealerEvidence(Buffer.from('{}'), '0'.repeat(64)), /SNAPSHOT_HASH_MISMATCH/);
  assert.throws(() => reviewer([company, company]), /SNAPSHOT_ID_INVALID/);
  const row = listing(); row.raw_payload.company_id = 2;
  assert.throws(() => reviewer()(row), /PROVENANCE_CONTENT_MISMATCH/);
  assert.throws(() => reviewer()({ ...listing(), source_table: 'auctions_bench' }), /SOURCE_UNSUPPORTED/);
});
