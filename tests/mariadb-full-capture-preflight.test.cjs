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
      if (sql.includes('COUNT(*)')) return [[{ total: 1495680 }]];
      if (sql.includes('ORDER BY created_on ASC')) return [[{ id: 'min-1', created_on: new Date('2025-01-08T18:28:49.000Z'), updated_on: null }]];
      if (sql.includes('ORDER BY created_on DESC')) return [[{ id: 'max-1', created_on: new Date('2026-08-29T17:59:21.000Z'), updated_on: null }]];
      return [[]];
    }
  };

  const manifest = await createFrozenSourceBoundary(fakeConn);
  assert.equal(manifest.total_source_rows, 1495680);
  assert.equal(manifest.lower_boundary.id, 'min-1');
  assert.equal(manifest.upper_boundary.id, 'max-1');
  assert.ok(manifest.manifest_sha256);
  assert.ok(fakeConn.queryCalls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
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
