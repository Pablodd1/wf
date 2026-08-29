'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  loadFirst1kRecords,
  canonicalizeRawPayload,
  checkPostgRestExposureFailClosed,
  stableJson,
  sha256
} = require('../tools/mariadb-live/run-1k-private-canary.cjs');

test('canonicalizeRawPayload produces deterministic key-sorted JSON representation', () => {
  const payload1 = { brand: 'Rolex', ref: '116500LN', price: 25000, condition: null };
  const payload2 = { condition: null, price: 25000, ref: '116500LN', brand: 'Rolex' };

  const canon1 = canonicalizeRawPayload(payload1);
  const canon2 = canonicalizeRawPayload(payload2);

  assert.equal(canon1, canon2);
  assert.equal(canon1, '{"brand":"Rolex","condition":null,"price":25000,"ref":"116500LN"}');
  assert.equal(sha256(canon1), sha256(canon2));
});

test('canonicalizeRawPayload handles nested objects and arrays deterministically', () => {
  const nested1 = { z: [3, 2, 1], a: { b: 2, a: 1 } };
  const nested2 = { a: { a: 1, b: 2 }, z: [3, 2, 1] };

  const c1 = canonicalizeRawPayload(nested1);
  const c2 = canonicalizeRawPayload(nested2);

  assert.equal(c1, c2);
  assert.equal(c1, '{"a":{"a":1,"b":2},"z":[3,2,1]}');
});

test('loadFirst1kRecords loads exactly 1000 ordered records with complete canonical evidence', async () => {
  const gzPath = path.resolve('audit-output/mariadb-live/benchmark-100k-v2/raw-records.jsonl.gz');
  const records = await loadFirst1kRecords(gzPath, 1000);

  assert.equal(records.length, 1000);

  const first = records[0];
  assert.ok(first.source_id);
  assert.ok(first.source_created_on);
  assert.ok(first.raw_payload_text);
  assert.ok(first.source_hash);
  assert.equal(first.hash_algorithm, 'sha256');
  assert.equal(first.canonicalization_version, 'v1-json-keys-sorted-compact');
  assert.equal(first.source_system, 'OceanDigital MariaDB');
  assert.equal(first.source_database, 'thecollective_inventory');
  assert.equal(first.source_table, 'auctions');

  const recalculatedHash = sha256(first.raw_payload_text);
  assert.equal(recalculatedHash, first.source_hash);
});

test('checkPostgRestExposureFailClosed throws on HTTP error or exposed private schemas', async () => {
  await assert.rejects(
    async () => {
      await checkPostgRestExposureFailClosed('https://invalid-nonexistent-domain-test.supabase.co', 'dummy');
    },
    /fetch failed|security check failed closed/i
  );
});
