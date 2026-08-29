'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { captureSnapshot, parseArgs } = require('../tools/intake/snapshot-reviewed-workbook-integrity.cjs');

test('recovery snapshot requires exact count and source hashes without PII fields', async () => {
  const plan = [
    { id: 'a', source_payload_sha256: '1'.repeat(64) },
    { id: 'b', source_payload_sha256: '2'.repeat(64) },
  ];
  const rows = [
    { id: 'b', source_payload_sha256: '2'.repeat(64), verification_status: 'APPROVED_SINGLE_CANDIDATE', price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH', workbook_price_usd: 100, updated_at: 'x' },
    { id: 'a', source_payload_sha256: '1'.repeat(64), verification_status: 'APPROVED_SINGLE_CANDIDATE', price_evidence_status: 'PRICE_NOT_SUPPLIED', workbook_price_usd: null, updated_at: 'y' },
  ];
  const client = { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) };
  const snapshot = await captureSnapshot(client, plan);
  assert.deepEqual(snapshot.map(row => row.id), ['a', 'b']);
  assert.equal(Object.hasOwn(snapshot[0], 'raw_message'), false);
  assert.equal(Object.hasOwn(snapshot[0], 'phone'), false);
});

test('recovery snapshot rejects missing and hash-mismatched rows', async () => {
  const plan = [{ id: 'a', source_payload_sha256: '1'.repeat(64) }];
  const missing = { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) };
  await assert.rejects(() => captureSnapshot(missing, plan), /count mismatch/);
  const wrong = { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 'a', source_payload_sha256: '2'.repeat(64) }], error: null }) }) }) };
  await assert.rejects(() => captureSnapshot(wrong, plan), /hash mismatch/);
});

test('snapshot CLI arguments are explicit pairs', () => {
  const parsed = parseArgs(['--output-dir', 'out', '--confirm-project', 'qnsafosakvonzgfcsphh', '--run-sha', 'a'.repeat(40)]);
  assert.equal(parsed.outputDir, 'out');
  assert.equal(parsed.confirmProject, 'qnsafosakvonzgfcsphh');
});
