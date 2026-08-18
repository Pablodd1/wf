'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const builder = require('../tools/intake/build-legacy-ledger-price-drift-manifest.cjs');

const hashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];

test('builds sorted PII-free exact correction rows from strict importer drift', () => {
  const candidates = [{
    id: 'z', source_payload_sha256: hashes[0], brand: 'Brand Z',
    price_evidence_status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE', workbook_price_usd: 1200,
  }, {
    id: 'a', source_payload_sha256: hashes[1], brand: 'Brand A',
    price_evidence_status: 'PRICE_NOT_SUPPLIED', workbook_price_usd: null,
  }, {
    id: 'same', source_payload_sha256: hashes[2], brand: 'Brand A',
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: 9000,
  }];
  const currentRows = candidates.map(row => ({
    id: row.id, source_payload_sha256: row.source_payload_sha256,
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: 9000,
  }));
  const result = builder.buildManifestRows(candidates, currentRows);
  assert.deepEqual(result.missingIds, []);
  assert.deepEqual(result.payloadMismatches, []);
  assert.deepEqual(result.manifestRows.map(row => row.listing_id), ['a', 'z']);
  assert.equal(result.manifestRows[0].null_price, true);
  assert.equal(result.manifestRows[1].null_price, false);
  const csv = builder.manifestCsv(result.manifestRows);
  assert.doesNotMatch(csv, /phone|raw_message|seller|posted_by/i);
  assert.equal(crypto.createHash('sha256').update(csv).digest('hex').length, 64);
});

test('reports exact ID and payload guard failures without leaking source fields', () => {
  const candidates = [{
    id: 'missing', source_payload_sha256: hashes[0], brand: 'Brand',
    price_evidence_status: 'PRICE_NOT_SUPPLIED', workbook_price_usd: null,
  }, {
    id: 'mismatch', source_payload_sha256: hashes[1], brand: 'Brand',
    price_evidence_status: 'PRICE_NOT_SUPPLIED', workbook_price_usd: null,
  }];
  const result = builder.buildManifestRows(candidates, [{
    id: 'mismatch', source_payload_sha256: hashes[2],
    price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: 500,
  }]);
  assert.deepEqual(result.missingIds, ['missing']);
  assert.deepEqual(result.payloadMismatches, ['mismatch']);
  assert.deepEqual(result.manifestRows, []);
});
