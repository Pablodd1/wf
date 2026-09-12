'use strict';

const { stableJson, sha256, sanitizeLosslessPayload } = require('./lossless-payload-sanitizer.cjs');

function refuse(code) {
  // Never put evidence, identifiers or supplied hashes in operational errors.
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') refuse('PROVENANCE_INVALID_JSON');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) refuse('PROVENANCE_INVALID_JSON');
  for (const item of Object.values(value)) assertJson(item);
}

/** Private ingestion boundary. Verification never repairs or rewrites evidence. */
function verifySourceContent(row) {
  if (!row || row.canonicalization_version !== 'v1-json-keys-sorted-compact'
      || row.hash_algorithm !== 'sha256') refuse('PROVENANCE_UNSUPPORTED_CANONICALIZATION');
  if (typeof row.source_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.source_hash)) {
    refuse('PROVENANCE_HASH_MALFORMED');
  }
  const payload = row.raw_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) refuse('PROVENANCE_PAYLOAD_MISSING');
  assertJson(payload);
  let original = payload;
  const envelope = payload._lossless_raw_evidence;
  if (envelope !== undefined) {
    const encoded = envelope?.original_payload_base64;
    if (typeof encoded !== 'string' || !encoded.length) refuse('PROVENANCE_LOSSLESS_ENVELOPE_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) refuse('PROVENANCE_LOSSLESS_ENVELOPE_INVALID');
    try { original = JSON.parse(bytes.toString('utf8')); }
    catch { refuse('PROVENANCE_LOSSLESS_ENVELOPE_INVALID'); }
    assertJson(original);
    if (stableJson(original) !== bytes.toString('utf8')) refuse('PROVENANCE_CANONICAL_BYTES_MISMATCH');
    const reconstructed = sanitizeLosslessPayload(JSON.parse(JSON.stringify(original)));
    if (!reconstructed.isModified || stableJson(reconstructed.sanitizedObj) !== stableJson(payload)) {
      refuse('PROVENANCE_TRANSPORT_MISMATCH');
    }
  }
  if (sha256(stableJson(original)) !== row.source_hash) refuse('PROVENANCE_CONTENT_MISMATCH');
  if (original.id !== undefined && String(original.id) !== String(row.source_id)) refuse('PROVENANCE_ID_MISMATCH');
  if (row.raw_sha256 !== undefined && row.raw_sha256 !== row.source_hash) refuse('PROVENANCE_HASH_MISMATCH');
  if (row.raw_message !== undefined) {
    const field = row.raw_message_source || 'description';
    if (!['description', 'title', 'comments'].includes(field)) refuse('PROVENANCE_TEXT_SOURCE_INVALID');
    const expected = payload[field] ?? null;
    if (row.raw_message !== expected) refuse('PROVENANCE_TEXT_MISMATCH');
  }
  return { verified: true, lossless: envelope !== undefined };
}

module.exports = { verifySourceContent, assertJson };
