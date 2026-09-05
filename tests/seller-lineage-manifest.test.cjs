'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyParent, normalizeIntent, normalizePhone, parseTitleHash, sha1, wallClock,
} = require('../tools/dealer-lineage/seller-lineage.cjs');
const { stagingRow } = require('../tools/dealer-lineage/stage-seller-lineage-manifest.cjs');

test('parses the source title hash and validates phone identities', () => {
  const title = '5712/1A blue 2024 HKD 900k';
  const hash = sha1(title);
  assert.deepEqual(parseTitleHash(`${hash}:85260161840`), { titleSha1: hash, phone: '85260161840' });
  assert.equal(parseTitleHash('broken'), null);
  assert.equal(normalizePhone('+852 6016 1840'), '85260161840');
  assert.equal(normalizePhone('123'), null);
});

test('compares source timestamps by preserved wall-clock second', () => {
  assert.equal(wallClock('Wed Jan 08 2025 13:28:49 GMT-0500 (Eastern Standard Time)'), '2025-01-08T13:28:49');
  assert.equal(wallClock('2025-01-08T13:28:49+00:00'), '2025-01-08T13:28:49');
  assert.equal(wallClock('unknown'), null);
});

test('treats NTQ as buyer intent and never defaults unknown intent', () => {
  assert.equal(normalizeIntent('sale'), 'WTS');
  assert.equal(normalizeIntent('search'), 'WTB');
  assert.equal(normalizeIntent('NTQ'), 'WTB');
  assert.equal(normalizeIntent('trade'), null);
});

test('auto-stages only an exact unique identity with matching intent', () => {
  const parent = { intent: 'WTS' };
  const candidate = { sellerListingId: 'seller-1', phone: '85260161840', sourceIntent: 'WTS', observedName: 'Leo', frontImage: 'image.jpg' };
  assert.equal(classifyParent(parent, [candidate]).classification, 'A_AUTO_STAGE');
  assert.equal(classifyParent(parent, [{ ...candidate, sourceIntent: 'WTB' }]).classification, 'B_REVIEW_REQUIRED');
  assert.equal(classifyParent(parent, [candidate, { ...candidate, sellerListingId: 'seller-2', phone: '85299999999' }]).classification, 'B_REVIEW_REQUIRED');
  assert.equal(classifyParent(parent, [], 2).classification, 'C_UNMATCHED');
});

test('staging adapter enforces all deterministic release gates', () => {
  const row = {
    source_system: 'UNBUNDLED_RAW_MESSAGE', source_record_id: 'source-1', seller_listing_id: 'seller-1',
    seller_phone_normalized: '85260161840', observed_names: ['Leo'], origin: 'WhatsApp',
    source_listing_type: 'sale', source_posted_at: '2025-01-08T18:28:49.000Z',
    source_posted_at_raw: 'Wed Jan 08 2025 13:28:49 GMT-0500', title_sha1: 'a'.repeat(40),
    front_image: 'image.jpg', match_status: 'A_AUTO_STAGE',
    match_evidence: { exact_raw_message_sha1: true, exact_wall_clock_second: true, unique_phone_identity: true, intent_agreement: true },
  };
  assert.equal(stagingRow(row).match_status, 'MATCH_READY');
  assert.throws(() => stagingRow({ ...row, match_evidence: { ...row.match_evidence, intent_agreement: false } }), /Release gate failed/);
});
