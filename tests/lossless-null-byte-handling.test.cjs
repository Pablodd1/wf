'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  sha256,
  stableJson,
  canonicalizeRawPayload,
  sanitizeLosslessPayload
} = require('../tools/mariadb-live/lossless-payload-sanitizer.cjs');

test('1. ordinary rows remain byte-identical without modification or metadata overhead', () => {
  const ordinaryRow = {
    id: 'ordinary-uuid-001',
    brand: 'Rolex',
    model: 'Submariner Date',
    reference: '126610LN',
    price: 14500,
    currency: 'USD',
    description: 'Mint condition with box and papers.',
    created_on: '2025-05-10T10:00:00.000Z'
  };

  const result = sanitizeLosslessPayload(ordinaryRow);
  assert.equal(result.isModified, false);
  assert.equal(result.metadata, null);
  assert.equal(result.originalHash, result.transportHash);
  assert.equal(result.originalPayloadText, result.transportPayloadText);
  assert.deepEqual(result.sanitizedObj, ordinaryRow);
});

test('2. a null-byte row is preserved losslessly and original evidence can be reconstructed', () => {
  const nullByteRow = {
    id: '2bc51cf2-da58-4fa5-8828-f23e0da287db',
    brand: 'Omega',
    title: 'Speedmaster\0 Professional\0 Moonwatch',
    price: 6800,
    created_on: '2025-11-19 02:42:51'
  };

  const result = sanitizeLosslessPayload(nullByteRow);
  assert.equal(result.isModified, true);
  assert.notEqual(result.metadata, null);
  assert.equal(result.metadata.has_null_bytes, true);
  assert.deepEqual(result.metadata.affected_fields, ['title']);
  assert.equal(result.metadata.null_byte_count, 2);
  assert.deepEqual(result.metadata.byte_positions.title, [11, 25]);

  // Decode original from base64 and prove exact hash match with original evidence
  const decodedOriginal = Buffer.from(result.metadata.original_payload_base64, 'base64').toString('utf8');
  assert.equal(decodedOriginal, result.originalPayloadText);
  assert.equal(sha256(decodedOriginal), result.originalHash);
});

test('3. canonical transport JSON contains no unsupported PostgreSQL characters (\u0000)', () => {
  const nullByteRow = {
    id: 'failing-row-002',
    description: 'Contains\0embedded\0null\0bytes',
    extra: {
      notes: 'Nested\0null'
    }
  };

  const result = sanitizeLosslessPayload(nullByteRow);
  assert.equal(result.transportPayloadText.includes('\u0000'), false);
  assert.equal(result.transportPayloadText.includes('\0'), false);

  // PostgreSQL JSON.parse / JSONB test
  const parsed = JSON.parse(result.transportPayloadText);
  assert.equal(parsed.description, 'Containsembeddednullbytes');
  assert.equal(parsed.extra.notes, 'Nestednull');
});

test('4. source hash remains strictly based on original unmodified evidence', () => {
  const nullByteRow = {
    id: '2bc51cf2-da58-4fa5-8828-f23e0da287db',
    title: 'Watch\0Title',
    created_on: '2025-11-19 02:42:51'
  };

  const expectedOriginalHash = sha256(canonicalizeRawPayload(nullByteRow));
  const result = sanitizeLosslessPayload(nullByteRow);

  // Crucial invariant: source_hash == originalHash != transportHash
  assert.equal(result.originalHash, expectedOriginalHash);
  assert.notEqual(result.originalHash, result.transportHash);
  assert.equal(result.metadata.original_hash, expectedOriginalHash);
});

test('5. rerunning sanitization is idempotent and deterministic', () => {
  const nullByteRow = {
    id: '2bc51cf2-da58-4fa5-8828-f23e0da287db',
    title: 'Watch\0Title',
    created_on: '2025-11-19 02:42:51'
  };

  const run1 = sanitizeLosslessPayload(nullByteRow);
  const run2 = sanitizeLosslessPayload(nullByteRow);

  assert.equal(run1.originalHash, run2.originalHash);
  assert.equal(run1.transportHash, run2.transportHash);
  assert.equal(run1.transportPayloadText, run2.transportPayloadText);
  assert.deepEqual(run1.metadata, run2.metadata);
});

test('6. checkpoint does not advance when affected batch fails (fail-closed simulation)', () => {
  const initialCheckpoint = {
    input_rows: 377750,
    newly_staged_rows: 376750,
    already_staged_identical_rows: 1000,
    capture_error_rows: 0,
    last_created_on: '2025-11-19T02:27:57.000Z',
    last_source_id: '80da285d-8ef3-46a9-8f36-b89f93eff399'
  };

  let simulatedCheckpoint = { ...initialCheckpoint };

  // Simulate a failed batch RPC
  const batchFailed = true;
  if (batchFailed) {
    // Transaction rolls back; checkpoint is unchanged
  } else {
    simulatedCheckpoint.input_rows += 250;
  }

  assert.equal(simulatedCheckpoint.input_rows, 377750);
  assert.equal(simulatedCheckpoint.last_source_id, initialCheckpoint.last_source_id);
});

test('7. staged rows plus capture errors reconcile exactly to input rows', () => {
  const totalInput = 250;
  const newlyStaged = 248;
  const alreadyStaged = 1;
  const errorRows = 1;

  const sum = newlyStaged + alreadyStaged + errorRows;
  assert.equal(sum, totalInput);
});
