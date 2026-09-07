'use strict';
const { sha256, stableJson } = require('../../tools/mariadb-live/lossless-payload-sanitizer.cjs');

// Extraction tests create a new synthetic capture for each input. Tampering
// tests deliberately use the unwrapped production functions instead.
function capturedFixture(row) {
  if (!row?.raw_payload || !row.source_hash) return row;
  const payload = { ...row.raw_payload };
  if (payload.id !== undefined) payload.id = row.source_id;
  return { ...row, raw_payload: payload, raw_message: payload.description ?? null,
    source_hash: sha256(stableJson(payload)),
    canonicalization_version: 'v1-json-keys-sorted-compact', hash_algorithm: 'sha256' };
}
module.exports = { capturedFixture };
