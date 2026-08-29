// tests/mariadb-full-capture-preflight.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  verifyTlsProof,
  createFrozenSourceBoundary,
  verifyHashReadbackContract,
  verifyErrorLedgerContract,
  verifyDryRunReconciliation,
  sha256,
  canonicalizeRawPayload
} = require('../tools/mariadb-live/full-capture-preflight.cjs');

test('verifyTlsProof strictly requires verified CA with rejectUnauthorized=true and rejects unverified transports', () => {
  // 1. Missing transport fails closed
  assert.throws(() => verifyTlsProof({}), /verified TLS CA or an explicitly verified private tunnel/);

  // 2. Verified private tunnel succeeds
  const tunnelResult = verifyTlsProof({ MARIADB_PRIVATE_TUNNEL_VERIFIED: 'true' });
  assert.equal(tunnelResult.verified, true);
  assert.equal(tunnelResult.transport, 'PRIVATE_TUNNEL_VERIFIED');

  // 3. CA File with rejectUnauthorized=true succeeds
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-test-'));
  const caPath = path.join(tmpDir, 'ca.pem');
  fs.writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nMOCK_CA_CERT\n-----END CERTIFICATE-----');

  try {
    const caResult = verifyTlsProof({ MARIADB_TLS_CA_FILE: caPath });
    assert.equal(caResult.verified, true);
    assert.equal(caResult.transport, 'TLS_CA_VERIFIED');
    assert.equal(caResult.tls_reject_unauthorized, true);
    assert.ok(caResult.ca_bytes > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createFrozenSourceBoundary establishes repeatable read consistent snapshot and signs manifest', async () => {
  const queries = [];
  const mockDb = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('COUNT(*)')) return [[{ total: 1495561 }]];
      if (sql.includes('ORDER BY created_on ASC')) {
        return [[{ id: 'min-123', created_on: '2025-01-08 18:28:49', updated_on: null }]];
      }
      if (sql.includes('ORDER BY created_on DESC')) {
        return [[{ id: 'max-456', created_on: '2026-08-29 17:17:05', updated_on: '2026-08-29 17:17:05' }]];
      }
      return [[]];
    }
  };

  const manifest = await createFrozenSourceBoundary(mockDb);

  assert.equal(manifest.total_source_rows, 1495561);
  assert.equal(manifest.lower_boundary.id, 'min-123');
  assert.equal(manifest.upper_boundary.id, 'max-456');
  assert.equal(manifest.isolation_level, 'REPEATABLE READ (CONSISTENT SNAPSHOT, READ ONLY)');
  assert.match(manifest.manifest_sha256, /^[a-f0-9]{64}$/);

  // Assert required transaction statements were executed
  assert.ok(queries.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
  assert.ok(queries.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
});

test('verifyHashReadbackContract validates 100% cryptographic hashes and fails on tampering', () => {
  const records = [
    { source_id: '1', source_hash: sha256('{"a":1}'), raw_payload_text: '{"a":1}' },
    { source_id: '2', source_hash: sha256('{"b":2}'), raw_payload_text: '{"b":2}' }
  ];

  // 1. Valid readback succeeds
  const result = verifyHashReadbackContract(records, records);
  assert.equal(result.verified, true);
  assert.equal(result.total_verified, 2);
  assert.equal(result.mismatches_count, 0);

  // 2. Tampered hash triggers fail-closed error
  const tampered = [
    { source_id: '1', source_hash: sha256('{"a":1}'), raw_payload_text: '{"a":1}' },
    { source_id: '2', source_hash: sha256('{"b":2}'), raw_payload_text: '{"b":999_TAMPERED}' }
  ];

  assert.throws(() => {
    verifyHashReadbackContract(tampered, records);
  }, /Hash Readback Gate Failure/);
});

test('verifyErrorLedgerContract enforces exact error count match and fails on discrepancies', () => {
  // 1. Exact match succeeds
  const ledger = [{ id: 'err-1' }, { id: 'err-2' }];
  const res = verifyErrorLedgerContract(ledger, 2);
  assert.equal(res.verified, true);
  assert.equal(res.error_count, 2);

  // 2. Discrepancy throws fail-closed error
  assert.throws(() => {
    verifyErrorLedgerContract(ledger, 1);
  }, /Error Ledger Contract Discrepancy/);
});

test('verifyDryRunReconciliation proves exact formula and enforces zero public mutations', () => {
  // 1. Exact reconciliation with zero public writes succeeds
  const accounting = {
    input_rows: 1000,
    newly_staged: 1000,
    already_staged: 0,
    errors: 0,
    public_mutations: 0
  };
  const res = verifyDryRunReconciliation(accounting);
  assert.equal(res.reconciled, true);

  // 2. Accounting discrepancy throws
  assert.throws(() => {
    verifyDryRunReconciliation({ ...accounting, newly_staged: 999 });
  }, /Reconciliation Formula Discrepancy/);

  // 3. Public mutation throws
  assert.throws(() => {
    verifyDryRunReconciliation({ ...accounting, public_mutations: 1 });
  }, /Public Isolation Violation/);
});
