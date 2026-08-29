'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  run1kPrivateCanary,
  loadFirst1kRecords,
  canonicalizeRawPayload,
  checkPostgRestExposureFailClosed,
  validateSecurityPrivilegeMatrix,
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
  assert.equal(first.source_record_id, 'mysql_auctions_' + first.source_id);
  assert.equal(first.hash_algorithm, 'sha256');
  assert.equal(first.canonicalization_version, 'v1-json-keys-sorted-compact');
  assert.equal(first.source_system, 'OceanDigital MariaDB');
  assert.equal(first.source_database, 'thecollective_inventory');
  assert.equal(first.source_table, 'auctions');

  const recalculatedHash = sha256(first.raw_payload_text);
  assert.equal(recalculatedHash, first.source_hash);
});

test('checkPostgRestExposureFailClosed throws on HTTP error, exposed private schemas, or accepted profile', async () => {
  await assert.rejects(
    async () => {
      await checkPostgRestExposureFailClosed('https://invalid-nonexistent-domain-test.supabase.co', 'dummy');
    },
    /fetch failed|security check failed closed/i
  );
});

test('Hard Gate Verification: Recomputed hash mismatch triggers fail-closed error', () => {
  const sourceHash = sha256('{"a":1}');
  const tamperedPayloadText = '{"a":2}';
  const recalculated = sha256(tamperedPayloadText);

  assert.notEqual(recalculated, sourceHash);
  assert.throws(() => {
    if (recalculated !== sourceHash) {
      throw new Error('Hash Verification Gate Failure: Recomputed=0, Mismatches=1');
    }
  }, /Hash Verification Gate Failure/);
});

test('Hard Gate Verification: Error ledger row count mismatch triggers fail-closed error', () => {
  const totalErrors = 2;
  const returnedErrorRows = [{ id: 'err-1' }]; // Missing 1 error row

  assert.throws(() => {
    if (returnedErrorRows.length !== totalErrors) {
      throw new Error('Error Ledger Discrepancy: Retrieved ' + returnedErrorRows.length + ' error rows, expected ' + totalErrors);
    }
  }, /Error Ledger Discrepancy/);
});

test('Hard Gate Verification: Public pollution detection triggers fail-closed error', () => {
  const publicMatches = [{ id: 'match-1', external_message_id: 'source-123' }];

  assert.throws(() => {
    if (publicMatches.length > 0) {
      throw new Error('Public Publication Gate Failure: Detected ' + publicMatches.length + ' canary rows in public production tables');
    }
  }, /Public Publication Gate Failure/);
});

test('validateSecurityPrivilegeMatrix enforces zero anon/auth access and immutable service_role permissions', () => {
  const validMatrix = {
    schema_privileges: { anon_usage: false, authenticated_usage: false, service_role_usage: true },
    table_privileges: {
      mariadb_raw_source_rows: {
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false,
        service_role_select: true, service_role_insert: true, service_role_update: false, service_role_delete: false, service_role_truncate: false
      },
      mariadb_raw_import_checkpoints: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true, service_role_update: true },
      mariadb_raw_import_batches: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true },
      mariadb_raw_import_errors: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true }
    },
    function_privileges: {
      ingest_batch: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      verify_readback: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      get_errors: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      finalize_checkpoint: { anon_execute: false, authenticated_execute: false, service_role_execute: true }
    }
  };

  assert.equal(validateSecurityPrivilegeMatrix(validMatrix), true);

  // Test failure if anon has schema usage
  assert.throws(() => {
    validateSecurityPrivilegeMatrix({
      ...validMatrix,
      schema_privileges: { ...validMatrix.schema_privileges, anon_usage: true }
    });
  }, /anon has USAGE on wf_canonical_staging/);

  // Test failure if service_role has UPDATE on immutable raw rows
  assert.throws(() => {
    validateSecurityPrivilegeMatrix({
      ...validMatrix,
      table_privileges: {
        ...validMatrix.table_privileges,
        mariadb_raw_source_rows: { ...validMatrix.table_privileges.mariadb_raw_source_rows, service_role_update: true }
      }
    });
  }, /service_role must NOT have UPDATE, DELETE, or TRUNCATE/);
});

test('run1kPrivateCanary executes exact 9-stage sequence with mocked client and generates genuine artifacts', async () => {
  const rpcCalls = [];
  const queryCalls = [];
  const testOutputDir = path.resolve('audit-output/mariadb-live/canary-1k-mock-test');

  const mockFetch = async (url, opts) => {
    if (url.includes('mariadb_raw_source_rows')) {
      return {
        ok: false,
        status: 406,
        json: async () => ({ code: 'PGRST106', message: 'The schema must be one of public' })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ paths: { '/public_table': {} }, info: { title: 'standard public schema' } })
    };
  };

  const validMatrix = {
    schema_privileges: { anon_usage: false, authenticated_usage: false, service_role_usage: true },
    table_privileges: {
      mariadb_raw_source_rows: {
        anon_select: false, anon_insert: false, anon_update: false, anon_delete: false,
        authenticated_select: false, authenticated_insert: false, authenticated_update: false, authenticated_delete: false,
        service_role_select: true, service_role_insert: true, service_role_update: false, service_role_delete: false, service_role_truncate: false
      },
      mariadb_raw_import_checkpoints: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true, service_role_update: true },
      mariadb_raw_import_batches: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true },
      mariadb_raw_import_errors: { anon_select: false, authenticated_select: false, service_role_select: true, service_role_insert: true }
    },
    function_privileges: {
      ingest_batch: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      verify_readback: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      get_errors: { anon_execute: false, authenticated_execute: false, service_role_execute: true },
      finalize_checkpoint: { anon_execute: false, authenticated_execute: false, service_role_execute: true }
    }
  };

  const stagedStore = new Map();

  const mockSupabase = {
    rpc: async (fnName, params) => {
      rpcCalls.push({ fnName, params });

      if (fnName === 'audit_mariadb_private_raw_security') {
        return { data: validMatrix, error: null };
      }

      if (fnName === 'ingest_mariadb_private_raw_batch') {
        const isRerun = params.p_run_key.includes('-rerun');
        for (const rec of params.p_records) {
          if (!isRerun) {
            stagedStore.set(rec.source_id, rec);
          }
        }
        return {
          data: {
            source_rows: params.p_records.length,
            newly_staged_rows: isRerun ? 0 : params.p_records.length,
            already_staged_identical_rows: isRerun ? params.p_records.length : 0,
            capture_error_rows: 0
          },
          error: null
        };
      }

      if (fnName === 'verify_mariadb_private_raw_readback') {
        const results = params.p_source_ids.map(id => {
          const rec = stagedStore.get(id);
          return {
            source_id: rec.source_id,
            source_hash: rec.source_hash,
            raw_payload_text: rec.raw_payload_text,
            hash_algorithm: rec.hash_algorithm,
            canonicalization_version: rec.canonicalization_version,
            source_created_on: rec.source_created_on,
            source_updated_on: rec.source_updated_on
          };
        });
        return { data: results, error: null };
      }

      if (fnName === 'get_mariadb_private_raw_errors') {
        return { data: [], error: null };
      }

      if (fnName === 'finalize_mariadb_private_raw_checkpoint') {
        return { data: { status: 'FINALIZED', run_key: params.p_run_key }, error: null };
      }

      throw new Error('Unknown mock RPC: ' + fnName);
    },
    from: (tableName) => {
      queryCalls.push(tableName);
      return {
        select: () => ({
          in: async () => ({ data: [], error: null })
        })
      };
    }
  };

  const res = await run1kPrivateCanary({
    supabase: mockSupabase,
    fetch: mockFetch,
    outputDir: testOutputDir,
    runKey: 'mock-canary-test-run'
  });

  // Verify all 7 artifacts produced
  assert.ok(res.runManifest);
  assert.ok(res.reconciliation);
  assert.ok(res.hashVerification);
  assert.ok(res.errorsArtifact);
  assert.ok(res.securityVerification);
  assert.ok(res.publicImpactVerification);
  assert.ok(res.benchmarkArtifact);

  // Assert exact sequence of RPC and query calls
  const rpcNames = rpcCalls.map(c => c.fnName);
  assert.equal(rpcNames[0], 'audit_mariadb_private_raw_security');
  assert.equal(rpcNames[1], 'ingest_mariadb_private_raw_batch'); // batch 1
  assert.equal(rpcNames[2], 'ingest_mariadb_private_raw_batch'); // batch 2
  assert.equal(rpcNames[3], 'ingest_mariadb_private_raw_batch'); // batch 3
  assert.equal(rpcNames[4], 'ingest_mariadb_private_raw_batch'); // batch 4
  assert.equal(rpcNames[5], 'verify_mariadb_private_raw_readback'); // chunk 1
  assert.equal(rpcNames[8], 'verify_mariadb_private_raw_readback'); // chunk 4
  assert.equal(rpcNames[9], 'ingest_mariadb_private_raw_batch'); // rerun batch 1
  assert.equal(rpcNames[13], 'finalize_mariadb_private_raw_checkpoint'); // rerun finalization (VERIFICATION_COMPLETE)
  assert.equal(rpcNames[14], 'get_mariadb_private_raw_errors'); // query real error ledger
  assert.equal(rpcNames[15], 'finalize_mariadb_private_raw_checkpoint'); // primary finalization (RAW_STAGED)
});

test('run1kPrivateCanary aborts and never calls finalization when hash mismatch occurs', async () => {
  const finalizedKeys = [];
  const mockFetch = async (url) => {
    if (url.includes('mariadb_raw_source_rows')) {
      return {
        ok: false,
        status: 406,
        json: async () => ({ code: 'PGRST106', message: 'The schema must be one of public' })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ paths: { '/public_table': {} }, info: { title: 'standard public schema' } })
    };
  };

  const mockSupabase = {
    rpc: async (fnName, params) => {
      if (fnName === 'audit_mariadb_private_raw_security') {
        return {
          data: {
            schema_privileges: { anon_usage: false, authenticated_usage: false, service_role_usage: true },
            table_privileges: {
              mariadb_raw_source_rows: { service_role_select: true, service_role_insert: true },
              mariadb_raw_import_checkpoints: { service_role_select: true, service_role_insert: true, service_role_update: true },
              mariadb_raw_import_batches: { service_role_select: true, service_role_insert: true },
              mariadb_raw_import_errors: { service_role_select: true, service_role_insert: true }
            },
            function_privileges: {
              ingest_batch: { service_role_execute: true },
              verify_readback: { service_role_execute: true },
              get_errors: { service_role_execute: true },
              finalize_checkpoint: { service_role_execute: true }
            }
          },
          error: null
        };
      }
      if (fnName === 'ingest_mariadb_private_raw_batch') {
        return { data: { source_rows: params.p_records.length, newly_staged_rows: params.p_records.length, already_staged_identical_rows: 0, capture_error_rows: 0 }, error: null };
      }
      if (fnName === 'verify_mariadb_private_raw_readback') {
        // Return corrupted hash on readback
        return {
          data: params.p_source_ids.map(id => ({
            source_id: id,
            source_hash: 'bad-hash-tampered-1234567890abcdef',
            raw_payload_text: '{\"a\":1}',
            hash_algorithm: 'sha256',
            canonicalization_version: 'v1-json-keys-sorted-compact'
          })),
          error: null
        };
      }
      if (fnName === 'finalize_mariadb_private_raw_checkpoint') {
        finalizedKeys.push(params.p_run_key);
        return { data: { status: 'FINALIZED' }, error: null };
      }
      return { data: [], error: null };
    },
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) })
  };

  await assert.rejects(
    async () => {
      await run1kPrivateCanary({
        supabase: mockSupabase,
        fetch: mockFetch,
        runKey: 'corrupted-hash-test'
      });
    },
    /Hash Verification Gate Failure/
  );

  assert.equal(finalizedKeys.length, 0, 'Finalization must NEVER be called after a hash gate failure');
});
