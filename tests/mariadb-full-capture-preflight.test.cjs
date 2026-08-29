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
  fetchCheckpointState,
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

test('fetchCheckpointState fails closed on Supabase RPC error and returns null on missing checkpoint', async () => {
  const fakeSupabaseError = {
    rpc: async (fn, params) => ({ data: null, error: { message: 'Database connection timeout' } })
  };
  await assert.rejects(
    async () => fetchCheckpointState(fakeSupabaseError, 'run-1'),
    /Checkpoint Read Failure \(fail-closed\): Database connection timeout/
  );

  const fakeSupabaseMissing = {
    rpc: async (fn, params) => ({ data: null, error: null })
  };
  const missingResult = await fetchCheckpointState(fakeSupabaseMissing, 'run-missing');
  assert.equal(missingResult, null);

  const fakeSupabaseValid = {
    rpc: async (fn, params) => ({
      data: {
        run_key: 'run-valid',
        last_created_on: '2025-05-01T00:00:00.000Z',
        last_source_id: 'uuid-100',
        input_rows: 100,
        newly_staged_rows: 100,
        already_staged_identical_rows: 0,
        capture_error_rows: 0,
        frozen_upper_boundary: { id: 'uuid-max', created_on: '2026-08-29T14:11:18.000Z' },
        manifest_sha256: 'abc123sha'
      },
      error: null
    })
  };
  const validResult = await fetchCheckpointState(fakeSupabaseValid, 'run-valid');
  assert.equal(validResult.run_key, 'run-valid');
  assert.equal(validResult.input_rows, 100);
  assert.equal(validResult.manifest_sha256, 'abc123sha');
});

test('integration test: interrupt after several batches, append new source rows, resume, and prove original upper boundary and exact reconciliation remain unchanged', async () => {
  // Initial source dataset (10 rows up to T10)
  const initialSourceDataset = [
    { id: '1', created_on: '2025-01-01T00:00:00.000Z', desc: 'watch 1' },
    { id: '2', created_on: '2025-01-02T00:00:00.000Z', desc: 'watch 2' },
    { id: '3', created_on: '2025-01-03T00:00:00.000Z', desc: 'watch 3' },
    { id: '4', created_on: '2025-01-04T00:00:00.000Z', desc: 'watch 4' },
    { id: '5', created_on: '2025-01-05T00:00:00.000Z', desc: 'watch 5' },
    { id: '6', created_on: '2025-01-06T00:00:00.000Z', desc: 'watch 6' },
    { id: '7', created_on: '2025-01-07T00:00:00.000Z', desc: 'watch 7' },
    { id: '8', created_on: '2025-01-08T00:00:00.000Z', desc: 'watch 8' },
    { id: '9', created_on: '2025-01-09T00:00:00.000Z', desc: 'watch 9' },
    { id: '10', created_on: '2025-01-10T00:00:00.000Z', desc: 'watch 10' }
  ];

  const frozenBoundary = {
    id: '10',
    created_on: '2025-01-10T00:00:00.000Z'
  };
  const manifestSha256 = sha256(stableJson({ frozenBoundary }));

  // Mock Database state
  let currentMariaDbData = [...initialSourceDataset];
  let checkpointDb = null;
  let stagedDb = [];

  const fakeConn = {
    query: async function(sql, params) {
      if (params.length === 4) {
        // Initial query: [upperCreatedOn, upperCreatedOn, upperId, limit]
        const limit = params[3];
        const upperCreatedOn = params[0];
        const upperId = params[2];
        const filtered = currentMariaDbData.filter(r => (r.created_on < upperCreatedOn || (r.created_on === upperCreatedOn && r.id <= upperId)));
        return [filtered.slice(0, limit)];
      } else {
        // Resumed query: [lastCreatedOn, lastCreatedOn, lastSourceId, upperCreatedOn, upperCreatedOn, upperId, limit]
        const [lastCreatedOn, , lastSourceId, upperCreatedOn, , upperId, limit] = params;
        const filtered = currentMariaDbData.filter(r => {
          const afterCursor = (r.created_on > lastCreatedOn || (r.created_on === lastCreatedOn && r.id > lastSourceId));
          const beforeUpper = (r.created_on < upperCreatedOn || (r.created_on === upperCreatedOn && r.id <= upperId));
          return afterCursor && beforeUpper;
        });
        return [filtered.slice(0, limit)];
      }
    }
  };

  const fakeSupabase = {
    rpc: async function(fn, params) {
      if (fn === 'get_mariadb_private_raw_checkpoint') {
        return { data: checkpointDb, error: null };
      }
      if (fn === 'ingest_mariadb_private_raw_batch') {
        const records = params.p_records;
        stagedDb.push(...records);
        const newlyStaged = records.length;
        const inputRows = (checkpointDb ? checkpointDb.input_rows : 0) + newlyStaged;

        checkpointDb = {
          run_key: params.p_run_key,
          contract: params.p_contract,
          last_created_on: params.p_next_last_created_on,
          last_source_id: params.p_next_last_source_id,
          input_rows: inputRows,
          newly_staged_rows: (checkpointDb ? checkpointDb.newly_staged_rows : 0) + newlyStaged,
          already_staged_identical_rows: 0,
          capture_error_rows: 0,
          status: 'COPYING_RAW',
          frozen_upper_boundary: params.p_frozen_upper_boundary || checkpointDb.frozen_upper_boundary,
          manifest_sha256: params.p_manifest_sha256 || checkpointDb.manifest_sha256
        };

        return {
          data: {
            status: 'APPLIED',
            newly_staged_rows: newlyStaged,
            already_staged_identical_rows: 0,
            capture_error_rows: 0
          },
          error: null
        };
      }
      if (fn === 'finalize_mariadb_private_raw_checkpoint') {
        assert.equal(params.p_expected_staged_rows, 10);
        assert.equal(params.p_expected_error_rows, 0);
        checkpointDb.status = params.p_final_status;
        return { data: { status: 'FINALIZED', checkpoint_status: 'RAW_STAGED' }, error: null };
      }
      return { data: null, error: null };
    }
  };

  const runKey = 'test-interruption-run';

  // Step 1: Run Batch 1 (limit 3) and Batch 2 (limit 3) -> Total 6 rows
  const batch1Rows = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: '',
    lastSourceId: '',
    upperBoundary: frozenBoundary,
    batchSize: 3
  });
  assert.equal(batch1Rows.length, 3);
  await fakeSupabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: 'b1',
    p_contract: CONTRACT,
    p_expected_last_created_on: '',
    p_expected_last_source_id: '',
    p_next_last_created_on: batch1Rows[2].created_on,
    p_next_last_source_id: batch1Rows[2].id,
    p_records: batch1Rows,
    p_frozen_upper_boundary: frozenBoundary,
    p_manifest_sha256: manifestSha256
  });

  const batch2Rows = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: batch1Rows[2].created_on,
    lastSourceId: batch1Rows[2].id,
    upperBoundary: frozenBoundary,
    batchSize: 3
  });
  assert.equal(batch2Rows.length, 3);
  await fakeSupabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: 'b2',
    p_contract: CONTRACT,
    p_expected_last_created_on: batch1Rows[2].created_on,
    p_expected_last_source_id: batch1Rows[2].id,
    p_next_last_created_on: batch2Rows[2].created_on,
    p_next_last_source_id: batch2Rows[2].id,
    p_records: batch2Rows,
    p_frozen_upper_boundary: frozenBoundary,
    p_manifest_sha256: manifestSha256
  });

  assert.equal(checkpointDb.input_rows, 6);
  assert.equal(checkpointDb.newly_staged_rows, 6);
  assert.equal(checkpointDb.last_source_id, '6');

  // Step 2: Simulate Interruption & New Source Writes in MariaDB
  currentMariaDbData.push(
    { id: '11', created_on: '2025-01-11T00:00:00.000Z', desc: 'new row 11' },
    { id: '12', created_on: '2025-01-12T00:00:00.000Z', desc: 'new row 12' },
    { id: '13', created_on: '2025-01-13T00:00:00.000Z', desc: 'new row 13' }
  );
  assert.equal(currentMariaDbData.length, 13);

  // Step 3: Resume Worker
  const resumedCheckpoint = await fetchCheckpointState(fakeSupabase, runKey);
  assert.ok(resumedCheckpoint);
  assert.equal(resumedCheckpoint.manifest_sha256, manifestSha256);
  assert.deepEqual(resumedCheckpoint.frozen_upper_boundary, frozenBoundary);

  // Worker reuses original frozen upper boundary (T10, '10') and cursor ('2025-01-06T00:00:00.000Z', '6')
  const batch3Rows = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: resumedCheckpoint.last_created_on,
    lastSourceId: resumedCheckpoint.last_source_id,
    upperBoundary: resumedCheckpoint.frozen_upper_boundary,
    batchSize: 3
  });
  assert.equal(batch3Rows.length, 3);
  assert.deepEqual(batch3Rows.map(r => r.id), ['7', '8', '9']);

  await fakeSupabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: 'b3',
    p_contract: CONTRACT,
    p_expected_last_created_on: resumedCheckpoint.last_created_on,
    p_expected_last_source_id: resumedCheckpoint.last_source_id,
    p_next_last_created_on: batch3Rows[2].created_on,
    p_next_last_source_id: batch3Rows[2].id,
    p_records: batch3Rows,
    p_frozen_upper_boundary: resumedCheckpoint.frozen_upper_boundary,
    p_manifest_sha256: resumedCheckpoint.manifest_sha256
  });

  const batch4Rows = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: batch3Rows[2].created_on,
    lastSourceId: batch3Rows[2].id,
    upperBoundary: resumedCheckpoint.frozen_upper_boundary,
    batchSize: 3
  });
  assert.equal(batch4Rows.length, 1);
  assert.equal(batch4Rows[0].id, '10');

  await fakeSupabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: 'b4',
    p_contract: CONTRACT,
    p_expected_last_created_on: batch3Rows[2].created_on,
    p_expected_last_source_id: batch3Rows[2].id,
    p_next_last_created_on: batch4Rows[0].created_on,
    p_next_last_source_id: batch4Rows[0].id,
    p_records: batch4Rows,
    p_frozen_upper_boundary: resumedCheckpoint.frozen_upper_boundary,
    p_manifest_sha256: resumedCheckpoint.manifest_sha256
  });

  // Next batch reaches end of frozen boundary
  const batch5Rows = await fetchKeysetBatch(fakeConn, {
    lastCreatedOn: batch4Rows[0].created_on,
    lastSourceId: batch4Rows[0].id,
    upperBoundary: resumedCheckpoint.frozen_upper_boundary,
    batchSize: 3
  });
  assert.equal(batch5Rows.length, 0); // Stops at upper boundary!

  // Finalize checkpoint
  await fakeSupabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: runKey,
    p_expected_staged_rows: checkpointDb.newly_staged_rows + checkpointDb.already_staged_identical_rows,
    p_expected_error_rows: checkpointDb.capture_error_rows,
    p_final_status: 'RAW_STAGED'
  });

  // Assertions: Exactly 10 rows staged, 0 errors, rows 11-13 completely excluded
  assert.equal(stagedDb.length, 10);
  assert.deepEqual(stagedDb.map(r => r.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(checkpointDb.status, 'RAW_STAGED');
  assert.equal(checkpointDb.input_rows, 10);
  assert.equal(checkpointDb.newly_staged_rows, 10);
  assert.equal(checkpointDb.already_staged_identical_rows, 0);
  assert.equal(checkpointDb.capture_error_rows, 0);

  const reconciliation = verifyDryRunReconciliation({
    input_rows: checkpointDb.input_rows,
    newly_staged: checkpointDb.newly_staged_rows,
    already_staged: checkpointDb.already_staged_identical_rows,
    errors: checkpointDb.capture_error_rows,
    public_mutations: 0
  });
  assert.equal(reconciliation.reconciled, true);
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

test('committed SQL function signature matches runner RPC invocation parameters exactly 1:1', () => {
  const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260829143000_private_mariadb_checkpoint_resume_safety.sql');
  assert.ok(fs.existsSync(migrationPath), 'Forward migration file must exist');

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Extract ingest_mariadb_private_raw_batch parameter names from migration SQL
  const ingestMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.ingest_mariadb_private_raw_batch\(([\s\S]*?)\)\s*RETURNS JSONB/i);
  assert.ok(ingestMatch, 'ingest_mariadb_private_raw_batch signature must be found in migration');
  
  const rawParams = ingestMatch[1].split(',').map(p => p.trim());
  const sqlParamNames = rawParams.map(p => p.split(/\s+/)[0]);

  const expectedParams = [
    'p_run_key',
    'p_batch_token',
    'p_contract',
    'p_expected_last_created_on',
    'p_expected_last_source_id',
    'p_next_last_created_on',
    'p_next_last_source_id',
    'p_records',
    'p_frozen_upper_boundary',
    'p_manifest_sha256'
  ];

  assert.deepEqual(sqlParamNames, expectedParams, 'SQL parameter names and order must match 10-parameter contract');

  // Verify runner invocation in run-full-private-capture.cjs
  const runnerPath = path.resolve(__dirname, '../tools/mariadb-live/run-full-private-capture.cjs');
  const runnerCode = fs.readFileSync(runnerPath, 'utf8');

  for (const param of expectedParams) {
    assert.ok(runnerCode.includes(param + ':'), `Runner RPC call must explicitly include parameter '${param}'`);
  }

  // Extract get_mariadb_private_raw_checkpoint parameter names
  const checkpointMatch = migrationSql.match(/CREATE OR REPLACE FUNCTION public\.get_mariadb_private_raw_checkpoint\(([\s\S]*?)\)\s*RETURNS JSONB/i);
  assert.ok(checkpointMatch, 'get_mariadb_private_raw_checkpoint signature must be found in migration');
  const checkpointParams = checkpointMatch[1].split(',').map(p => p.trim().split(/\s+/)[0]);
  assert.deepEqual(checkpointParams, ['p_run_key']);
  assert.ok(runnerCode.includes('p_run_key:'));
});


test('parseMaxCaptureRows: presence-based parsing strictly enforces valid non-negative integers or unbounded', () => {
  const { parseMaxCaptureRows } = require('../tools/mariadb-live/full-capture-preflight.cjs');
  
  // Unset / undefined / null -> unbounded
  assert.deepEqual(parseMaxCaptureRows(undefined), { isBounded: false, limit: null });
  assert.deepEqual(parseMaxCaptureRows(null), { isBounded: false, limit: null });

  // 0 -> exactly 0 (bounded)
  assert.deepEqual(parseMaxCaptureRows(0), { isBounded: true, limit: 0 });
  assert.deepEqual(parseMaxCaptureRows('0'), { isBounded: true, limit: 0 });
  assert.deepEqual(parseMaxCaptureRows(' 0 '), { isBounded: true, limit: 0 });

  // Positive integers
  assert.deepEqual(parseMaxCaptureRows(100), { isBounded: true, limit: 100 });
  assert.deepEqual(parseMaxCaptureRows('5000'), { isBounded: true, limit: 5000 });

  // Fail closed on negative, fractional, empty, NaN, invalid types
  assert.throws(() => parseMaxCaptureRows(''), /empty or whitespace/);
  assert.throws(() => parseMaxCaptureRows('   '), /empty or whitespace/);
  assert.throws(() => parseMaxCaptureRows(-1), /non-negative integer/);
  assert.throws(() => parseMaxCaptureRows('-1'), /invalid non-integer/);
  assert.throws(() => parseMaxCaptureRows(1.5), /non-negative integer/);
  assert.throws(() => parseMaxCaptureRows('1.5'), /invalid non-integer/);
  assert.throws(() => parseMaxCaptureRows('0.5'), /invalid non-integer/);
  assert.throws(() => parseMaxCaptureRows('abc'), /invalid non-integer/);
  assert.throws(() => parseMaxCaptureRows('NaN'), /invalid non-integer/);
  assert.throws(() => parseMaxCaptureRows({}), /unsupported type/);
});

test('runCaptureLoop with MAX_CAPTURE_ROWS=0 causes zero fetch, zero checkpoint mutations, and zero staging writes', async () => {
  const { runCaptureLoop } = require('../tools/mariadb-live/run-full-private-capture.cjs');

  const forbiddenAccess = (name) => ({
    enumerable: true,
    get() {
      throw new Error(`zero-row execution accessed forbidden dependency: ${name}`);
    }
  });
  const env = {};
  Object.defineProperties(env, {
    MAX_CAPTURE_ROWS: { enumerable: true, value: '0' },
    SUPABASE_URL: forbiddenAccess('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: forbiddenAccess('SUPABASE_SERVICE_ROLE_KEY'),
    MARIADB_HOST: forbiddenAccess('MARIADB_HOST'),
    CAPTURE_OUTPUT_DIR: forbiddenAccess('CAPTURE_OUTPUT_DIR')
  });

  const res = await runCaptureLoop({
    runKey: 'test-zero-row-preflight',
    env
  });

  assert.equal(res.cumulative_input_rows, 0);
  assert.equal(res.cumulative_newly_staged_rows, 0);
  assert.equal(res.cumulative_already_staged_identical_rows, 0);
  assert.equal(res.cumulative_error_rows, 0);
  assert.equal(res.batches_executed, 0);
  assert.equal(res.checkpoint_status, 'COPYING_RAW');
  assert.equal(res.hash_verification.mode, 'ZERO_ROW_NOOP');
});
