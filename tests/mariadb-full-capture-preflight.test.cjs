// tests/mariadb-full-capture-preflight.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONTRACT,
  CANONICAL_VERSION,
  HASH_ALGO,
  PINNED_MARIADB_SERVER_CERT_SHA256,
  PINNED_MARIADB_CA_CERT_SHA256,
  sha256,
  stableJson,
  canonicalizeRawPayload,
  checkPinnedServerIdentity,
  verifyTlsProof,
  createFrozenSourceBoundary,
  buildKeysetQuery,
  fetchKeysetBatch,
  verifyHashReadbackContract,
  verifyErrorLedgerContract,
  verifyDryRunReconciliation
} = require('../tools/mariadb-live/full-capture-preflight.cjs');

const { isPublicHost, resolveMariaDbTransport } = require('../tools/mariadb-live/run-full-private-capture.cjs');

test('isPublicHost correctly classifies RFC1918 private vs public hosts', () => {
  assert.equal(isPublicHost('localhost'), false);
  assert.equal(isPublicHost('127.0.0.1'), false);
  assert.equal(isPublicHost('10.0.0.1'), false);
  assert.equal(isPublicHost('172.16.0.5'), false);
  assert.equal(isPublicHost('192.168.1.100'), false);
  assert.equal(isPublicHost('mariadb.railway.internal'), false);
  assert.equal(isPublicHost('161.35.0.209'), true);
  assert.equal(isPublicHost('db.example.com'), true);
});

test('resolveMariaDbTransport rejects public-host private-tunnel assertions and requires verified CA with certificate pinning', () => {
  assert.throws(() => {
    resolveMariaDbTransport({
      MARIADB_HOST: '161.35.0.209',
      MARIADB_PRIVATE_TUNNEL_VERIFIED: 'true'
    }, { useDefaultCa: false });
  }, /Security Violation/);

  const caPath = path.resolve(__dirname, '../tools/mariadb-live/mariadb-server-ca.pem');
  if (fs.existsSync(caPath)) {
    const transport = resolveMariaDbTransport({
      MARIADB_HOST: '161.35.0.209',
      MARIADB_TLS_CA_FILE: caPath
    });
    assert.equal(transport.transport, 'TLS_CA_VERIFIED');
    assert.equal(transport.ssl.rejectUnauthorized, true);
    assert.equal(typeof transport.ssl.checkServerIdentity, 'function');
  }
});

test('checkPinnedServerIdentity validates pinned certificate fingerprint and rejects unknown certificates', () => {
  assert.throws(() => {
    checkPinnedServerIdentity('161.35.0.209', null);
  }, /TLS Peer Certificate Missing/);

  assert.throws(() => {
    checkPinnedServerIdentity('161.35.0.209', {
      fingerprint256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
    });
  }, /TLS Certificate Pinning Violation/);

  const validLeaf = checkPinnedServerIdentity('161.35.0.209', {
    fingerprint256: PINNED_MARIADB_SERVER_CERT_SHA256
  });
  assert.equal(validLeaf, undefined);

  const validCa = checkPinnedServerIdentity('161.35.0.209', {
    fingerprint256: PINNED_MARIADB_CA_CERT_SHA256
  });
  assert.equal(validCa, undefined);
});

test('verifyTlsProof strictly requires verified CA with rejectUnauthorized=true and rejects unverified transports', () => {
  const caFile = path.resolve(__dirname, '../tools/mariadb-live/mariadb-server-ca.pem');
  const proof = verifyTlsProof({
    MARIADB_HOST: '161.35.0.209',
    MARIADB_TLS_CA_FILE: caFile
  });
  assert.equal(proof.verified, true);
  assert.equal(proof.transport, 'TLS_CA_VERIFIED');
  assert.equal(proof.tls_reject_unauthorized, true);
  assert.ok(proof.ca_bytes > 0);
  assert.equal(proof.pinned_server_cert_sha256, PINNED_MARIADB_SERVER_CERT_SHA256);
});

test('createFrozenSourceBoundary establishes repeatable read consistent snapshot and signs manifest', async () => {
  const fakeConn = {
    queryCalls: [],
    query: async function(sql) {
      this.queryCalls.push(sql);
      if (sql.includes('COUNT(*)')) return [[{ total: 1495718 }]];
      if (sql.includes('ORDER BY created_on ASC')) return [[{ id: 'min-1', created_on: new Date('2025-01-08T13:28:49.000Z'), updated_on: null }]];
      if (sql.includes('ORDER BY created_on DESC')) return [[{ id: 'max-1', created_on: new Date('2026-08-29T14:11:18.000Z'), updated_on: null }]];
      return [[]];
    }
  };

  const manifest = await createFrozenSourceBoundary(fakeConn);
  assert.equal(manifest.total_source_rows, 1495718);
  assert.equal(manifest.lower_boundary.id, 'min-1');
  assert.equal(manifest.upper_boundary.id, 'max-1');
  assert.ok(manifest.manifest_sha256);
  assert.ok(fakeConn.queryCalls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
});

test('buildKeysetQuery constructs valid initial and resumed keyset boundary SQL', () => {
  const upperBoundary = { id: 'uuid-max', created_on: '2026-08-29T14:11:18.000Z' };

  // Initial query (no prior cursor)
  const initial = buildKeysetQuery({
    lastCreatedOn: '',
    lastSourceId: '',
    upperBoundary,
    batchSize: 250
  });
  assert.match(initial.sql, /WHERE \(created_on < \? OR \(created_on = \? AND id <= \?\)\)/);
  assert.match(initial.sql, /ORDER BY created_on ASC, id ASC LIMIT \?/);
  assert.deepEqual(initial.params, ['2026-08-29T14:11:18.000Z', '2026-08-29T14:11:18.000Z', 'uuid-max', 250]);

  // Resumed query (with prior cursor)
  const resumed = buildKeysetQuery({
    lastCreatedOn: '2025-06-01T00:00:00.000Z',
    lastSourceId: 'uuid-cursor',
    upperBoundary,
    batchSize: 250
  });
  assert.match(resumed.sql, /\(created_on > \? OR \(created_on = \? AND id > \?\)\)/);
  assert.match(resumed.sql, /\(created_on < \? OR \(created_on = \? AND id <= \?\)\)/);
  assert.deepEqual(resumed.params, [
    '2025-06-01T00:00:00.000Z',
    '2025-06-01T00:00:00.000Z',
    'uuid-cursor',
    '2026-08-29T14:11:18.000Z',
    '2026-08-29T14:11:18.000Z',
    'uuid-max',
    250
  ]);
});

test('keyset pagination and resume-after-interruption accurately advances cursor across batches', async () => {
  const sourceDataset = [
    { id: '1', created_on: '2025-01-01T00:00:00.000Z', val: 'a' },
    { id: '2', created_on: '2025-01-01T00:00:00.000Z', val: 'b' },
    { id: '3', created_on: '2025-01-02T00:00:00.000Z', val: 'c' },
    { id: '4', created_on: '2025-01-03T00:00:00.000Z', val: 'd' },
    { id: '5', created_on: '2025-01-04T00:00:00.000Z', val: 'e' }
  ];

  const upperBoundary = { id: '5', created_on: '2025-01-04T00:00:00.000Z' };

  const fakeConn = {
    query: async function(sql, params) {
      if (params.length === 4) {
        // Initial query: params = [upperCreatedOn, upperCreatedOn, upperId, limit]
        const limit = params[3];
        return [sourceDataset.slice(0, limit)];
      } else {
        // Resumed query: params = [lastCreatedOn, lastCreatedOn, lastSourceId, upperCreatedOn, upperCreatedOn, upperId, limit]
        const [lastCreatedOn, , lastSourceId, , , , limit] = params;
        const filtered = sourceDataset.filter(r => {
          if (r.created_on > lastCreatedOn) return true;
          if (r.created_on === lastCreatedOn && r.id > lastSourceId) return true;
          return false;
        });
        return [filtered.slice(0, limit)];
      }
    }
  };

  // Batch 1 (limit 2) -> fetches records 1, 2
  const batch1 = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: '',
    lastSourceId: '',
    upperBoundary,
    batchSize: 2
  });
  assert.equal(batch1.length, 2);
  assert.equal(batch1[0].id, '1');
  assert.equal(batch1[1].id, '2');

  // Interruption occurs after batch 1!
  // Resuming with checkpoint cursor (last_created_on: batch1[1].created_on, last_source_id: batch1[1].id)
  const cursorCreatedOn = batch1[1].created_on;
  const cursorSourceId = batch1[1].id;

  // Batch 2 (resumed, limit 2) -> fetches records 3, 4
  const batch2 = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: cursorCreatedOn,
    lastSourceId: cursorSourceId,
    upperBoundary,
    batchSize: 2
  });
  assert.equal(batch2.length, 2);
  assert.equal(batch2[0].id, '3');
  assert.equal(batch2[1].id, '4');

  // Batch 3 (resumed, limit 2) -> fetches record 5
  const batch3 = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: batch2[1].created_on,
    lastSourceId: batch2[1].id,
    upperBoundary,
    batchSize: 2
  });
  assert.equal(batch3.length, 1);
  assert.equal(batch3[0].id, '5');

  // Total collected equals exact source count
  const allCollected = [...batch1, ...batch2, ...batch3];
  assert.equal(allCollected.length, 5);
  assert.deepEqual(allCollected.map(r => r.id), ['1', '2', '3', '4', '5']);
});

test('verifyHashReadbackContract validates 100% cryptographic hashes and fails on tampering', () => {
  const rec1 = { id: 'uuid-1', val: 'test1' };
  const text1 = canonicalizeRawPayload(rec1);
  const hash1 = sha256(text1);

  const expected = [{
    source_id: 'uuid-1',
    source_hash: hash1,
    raw_payload_text: text1
  }];

  const stagedValid = [{
    source_id: 'uuid-1',
    source_hash: hash1,
    raw_payload_text: text1
  }];

  const result = verifyHashReadbackContract(stagedValid, expected);
  assert.equal(result.verified, true);
  assert.equal(result.total_verified, 1);

  const stagedTampered = [{
    source_id: 'uuid-1',
    source_hash: hash1,
    raw_payload_text: 'tampered text'
  }];

  assert.throws(() => {
    verifyHashReadbackContract(stagedTampered, expected);
  }, /Hash Readback Gate Failure/);
});

test('verifyErrorLedgerContract enforces exact error count match and fails on discrepancies', () => {
  const result = verifyErrorLedgerContract([], 0);
  assert.equal(result.verified, true);
  assert.equal(result.error_count, 0);

  assert.throws(() => {
    verifyErrorLedgerContract([{ id: 1 }], 0);
  }, /Error Ledger Contract Discrepancy/);
});

test('verifyDryRunReconciliation proves exact formula and enforces zero public mutations', () => {
  const valid = verifyDryRunReconciliation({
    input_rows: 1000,
    newly_staged: 1000,
    already_staged: 0,
    errors: 0,
    public_mutations: 0
  });
  assert.equal(valid.reconciled, true);

  assert.throws(() => {
    verifyDryRunReconciliation({
      input_rows: 1000,
      newly_staged: 900,
      already_staged: 0,
      errors: 0,
      public_mutations: 0
    });
  }, /Reconciliation Formula Discrepancy/);

  assert.throws(() => {
    verifyDryRunReconciliation({
      input_rows: 1000,
      newly_staged: 1000,
      already_staged: 0,
      errors: 0,
      public_mutations: 5
    });
  }, /Public Isolation Violation/);
});
