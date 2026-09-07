'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySourceContent } = require('../tools/mariadb-live/content-provenance.cjs');
const { sanitizeLosslessPayload } = require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');
const { normalizeAuthoritativeRow, computeProposalHash, computeParentHash, computeChildProposalHash } = require('../tools/mariadb-live/authoritative-evidence-normalizer.cjs');

function fixture(payload = { id: '1', description: 'WTS Rolex 124060 USD 11000' }) {
  const capture = sanitizeLosslessPayload(structuredClone(payload));
  return { source_id: '1', source_hash: capture.originalHash, source_system: 'synthetic',
    source_database: 'fixture', source_table: 'auctions', source_record_id: 'fixture-1',
    canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256',
    raw_payload: capture.sanitizedObj, raw_message: capture.sanitizedObj.description ?? null };
}

test('verified capture normalizes without mutating raw evidence', () => {
  const row = fixture();
  const before = structuredClone(row);
  assert.equal(verifySourceContent(row).verified, true);
  assert.equal(normalizeAuthoritativeRow(row).price_usd, 11000);
  assert.deepEqual(row, before);
});

test('changed source text with the old hash cannot normalize', () => {
  const row = fixture();
  row.raw_payload.description = 'WTS Rolex 124060 USD 21000';
  row.raw_message = row.raw_payload.description;
  assert.throws(() => normalizeAuthoritativeRow(row), { code: 'PROVENANCE_CONTENT_MISMATCH' });
});

test('separate raw text and identity must agree with the captured payload', () => {
  assert.throws(() => verifySourceContent({ ...fixture(), raw_message: 'different' }), { code: 'PROVENANCE_TEXT_MISMATCH' });
  assert.throws(() => verifySourceContent({ ...fixture(), source_id: '2' }), { code: 'PROVENANCE_ID_MISMATCH' });
  assert.throws(() => verifySourceContent({ ...fixture(), canonicalization_version: 'unknown' }), { code: 'PROVENANCE_UNSUPPORTED_CANONICALIZATION' });
});

test('lossless null-byte envelope verifies original and transported content', () => {
  const row = fixture({ id: '1', description: 'WTS Rolex\u0000 124060 USD 11000', nested: { proof: ['a\u0000b'] } });
  const before = structuredClone(row);
  assert.deepEqual(verifySourceContent(row), { verified: true, lossless: true });
  assert.deepEqual(row, before);
  row.raw_payload.nested.proof[0] = 'changed';
  assert.throws(() => verifySourceContent(row), { code: 'PROVENANCE_TRANSPORT_MISMATCH' });
});

test('tampered lossless metadata and original bytes fail without disclosing evidence', () => {
  const row = fixture({ id: '1', description: 'private\u0000evidence' });
  row.raw_payload._lossless_raw_evidence.original_payload_base64 = Buffer.from('{"secret":"do not log"}').toString('base64');
  assert.throws(() => verifySourceContent(row), error => !error.message.includes('private') && !error.message.includes('secret') && error.code.startsWith('PROVENANCE_'));
});

test('all proposal hashes bind nested evidence and are stable across key order', () => {
  for (const hash of [computeProposalHash, computeParentHash, computeChildProposalHash]) {
    const a = { currency_evidence: { token: 'USD', span: [1, 4] }, seller_review_evidence: { count: 2 }, review_flags: [{ code: 'A', evidence: { line: 1 } }] };
    const b = structuredClone(a);
    b.review_flags[0].evidence.line = 2;
    assert.notEqual(hash(a), hash(b));
    const reordered = { ...a, review_flags: [{ evidence: { line: 1 }, code: 'A' }] };
    assert.equal(hash(a), hash(reordered));
  }
});
