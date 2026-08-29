// run-1k-private-canary.cjs
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { createClient } = require('@supabase/supabase-js');

const CANONICAL_VERSION = 'v1-json-keys-sorted-compact';
const HASH_ALGO = 'sha256';
const CONTRACT = 'wf-mariadb-private-raw-staging-v1';

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function stableJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableJson(obj[k]));
  return '{' + pairs.join(',') + '}';
}

function canonicalizeRawPayload(rawData) {
  return stableJson(rawData || {});
}

function resolveBenchmarkGzPath(overridePath) {
  if (overridePath && fs.existsSync(overridePath)) return overridePath;
  const candidates = [
    overridePath,
    path.resolve('audit-output/mariadb-live/benchmark-100k-v2/raw-records.jsonl.gz'),
    path.resolve('../wf-source-only-census/audit-output/mariadb-live/benchmark-100k-v2/raw-records.jsonl.gz'),
    'C:\\\\Users\\\\jasme\\\\Documents\\\\Codex\\\\2026-08-29\\\\wf-source-only-census\\\\audit-output\\\\mariadb-live\\\\benchmark-100k-v2\\\\raw-records.jsonl.gz'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return path.resolve(c);
  }
  throw new Error('Input artifact does not exist in any candidate location: ' + candidates.join(', '));
}

async function loadFirst1kRecords(gzPath, limit = 1000) {
  const resolvedPath = resolveBenchmarkGzPath(gzPath);

  const records = [];
  const fileStream = fs.createReadStream(resolvedPath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({
    input: fileStream.pipe(gunzip),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    const item = JSON.parse(line);
    const rawData = item.raw_data || {};
    const rawPayloadText = canonicalizeRawPayload(rawData);
    const sourceHash = sha256(rawPayloadText);

    records.push({
      source_system: item.source_system || 'OceanDigital MariaDB',
      source_database: item.source_database || 'thecollective_inventory',
      source_table: item.source_table || 'auctions',
      source_id: item.source_id,
      source_unique_key: item.source_unique_key || null,
      source_record_id: item.source_record_id || ('mysql_auctions_' + item.source_id),
      source_created_on: item.source_created_on || null,
      source_updated_on: rawData.updated_on || null,
      captured_at: item.captured_at || new Date().toISOString(),
      raw_message: item.raw_message || null,
      raw_message_source: item.raw_message_source || null,
      raw_sha256: item.raw_sha256 || null,
      raw_payload_text: rawPayloadText,
      raw_payload: rawData,
      source_hash: sourceHash,
      hash_algorithm: HASH_ALGO,
      canonicalization_version: CANONICAL_VERSION
    });

    if (records.length >= limit) {
      break;
    }
  }

  if (records.length !== limit) {
    throw new Error('Canary loader invariant failed: expected exactly ' + limit + ' records, loaded ' + records.length);
  }

  return records;
}

async function checkPostgRestExposureFailClosed(supabaseUrl, serviceKey, customFetch) {
  const fetchFn = customFetch || fetch;
  const cleanUrl = supabaseUrl.replace(/\/$/, '');

  // 1. Standard OpenAPI schema probe
  const res = await fetchFn(cleanUrl + '/rest/v1/', {
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey
    }
  });
  if (!res.ok) {
    throw new Error('PostgREST OpenAPI security check failed closed: HTTP ' + res.status);
  }
  const spec = await res.json();
  const paths = Object.keys(spec.paths || {});
  const stagingExposed = paths.filter(p => p.includes('mariadb_raw_source_rows') || p.includes('wf_canonical_staging.'));
  if (stagingExposed.length > 0) {
    throw new Error('Security Violation: Private staging table is exposed in PostgREST paths: ' + stagingExposed.join(', '));
  }

  // 2. Explicit Accept-Profile probe for wf_canonical_staging (Must be rejected with HTTP 406 or PGRST106)
  const profileProbe = await fetchFn(cleanUrl + '/rest/v1/mariadb_raw_source_rows', {
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Accept-Profile': 'wf_canonical_staging'
    }
  });

  let errorBody = {};
  try {
    errorBody = await profileProbe.json();
  } catch (e) {
    // Body might not be JSON
  }

  if (profileProbe.ok) {
    throw new Error('Security Violation: PostgREST accepted Accept-Profile: wf_canonical_staging with HTTP ' + profileProbe.status);
  }

  if (errorBody.code !== 'PGRST106') {
    throw new Error('Security Violation: PostgREST Accept-Profile: wf_canonical_staging returned code ' + (errorBody.code || 'UNKNOWN') + ' (expected PGRST106)');
  }

  return {
    exposed: false,
    exposed_paths: [],
    total_paths: paths.length,
    accept_profile_rejected: true,
    accept_profile_status: profileProbe.status,
    accept_profile_rejection_code: errorBody.code || ('HTTP_' + profileProbe.status),
    postgrest_schema: spec.info?.title || 'standard public schema'
  };
}

function validateSecurityPrivilegeMatrix(privReport) {
  if (!privReport || typeof privReport !== 'object') {
    throw new Error('Security Audit Failure: Missing privilege report object');
  }

  const sp = privReport.schema_privileges || {};
  const tp = privReport.table_privileges || {};
  const fp = privReport.function_privileges || {};

  // 1. Validate Schema Usage
  if (typeof sp.anon_usage !== 'boolean' || sp.anon_usage !== false) {
    throw new Error('Security Audit Failure: anon_usage must exist and equal false (was ' + sp.anon_usage + ')');
  }
  if (typeof sp.authenticated_usage !== 'boolean' || sp.authenticated_usage !== false) {
    throw new Error('Security Audit Failure: authenticated_usage must exist and equal false (was ' + sp.authenticated_usage + ')');
  }
  if (typeof sp.service_role_usage !== 'boolean' || sp.service_role_usage !== true) {
    throw new Error('Security Audit Failure: service_role_usage must exist and equal true (was ' + sp.service_role_usage + ')');
  }

  // 2. Validate All 84 Table Privileges (4 tables * 3 roles * 7 actions must strictly exist and equal false)
  const tables = [
    'mariadb_raw_source_rows',
    'mariadb_raw_import_checkpoints',
    'mariadb_raw_import_batches',
    'mariadb_raw_import_errors'
  ];
  const roles = ['anon', 'authenticated', 'service_role'];
  const actions = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

  for (const tbl of tables) {
    if (!tp[tbl] || typeof tp[tbl] !== 'object') {
      throw new Error('Security Audit Failure: Missing table_privileges object for ' + tbl);
    }
    for (const r of roles) {
      for (const act of actions) {
        const prop = r + '_' + act;
        const val = tp[tbl][prop];
        if (typeof val !== 'boolean') {
          throw new Error('Security Audit Failure: Missing required boolean property ' + prop + ' on ' + tbl);
        }
        if (val !== false) {
          throw new Error('Security Audit Failure: ' + r + ' has ' + act.toUpperCase() + ' = ' + val + ' on ' + tbl + ' (must strictly be false)');
        }
      }
    }
  }

  // 3. Validate Function Privileges across all 5 RPCs
  const functions = ['ingest_batch', 'verify_readback', 'get_errors', 'finalize_checkpoint', 'audit_security'];
  for (const fn of functions) {
    if (!fp[fn] || typeof fp[fn] !== 'object') {
      throw new Error('Security Audit Failure: Missing function_privileges object for ' + fn);
    }
    if (typeof fp[fn].anon_execute !== 'boolean' || fp[fn].anon_execute !== false) {
      throw new Error('Security Audit Failure: anon_execute must exist and equal false on ' + fn + ' (was ' + fp[fn]?.anon_execute + ')');
    }
    if (typeof fp[fn].authenticated_execute !== 'boolean' || fp[fn].authenticated_execute !== false) {
      throw new Error('Security Audit Failure: authenticated_execute must exist and equal false on ' + fn + ' (was ' + fp[fn]?.authenticated_execute + ')');
    }
    if (typeof fp[fn].service_role_execute !== 'boolean' || fp[fn].service_role_execute !== true) {
      throw new Error('Security Audit Failure: service_role_execute must exist and equal true on ' + fn + ' (was ' + fp[fn]?.service_role_execute + ')');
    }
  }

  return true;
}

async function run1kPrivateCanary(options = {}) {
  const startTime = Date.now();
  const startIso = new Date().toISOString();
  const gzPath = options.gzPath;
  const outputDir = options.outputDir || path.resolve('audit-output/mariadb-live/canary-1k');
  const batchSize = options.batchSize || 250;
  const runKey = options.runKey || ('canary-1k-' + Date.now());

  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL;
  const supabaseKey = options.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabase = options.supabase;
  if (!supabase) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }

  fs.mkdirSync(outputDir, { recursive: true });

  console.log('[Canary] 1. Loading first 1,000 records from benchmark artifact...');
  const records = await loadFirst1kRecords(gzPath, 1000);
  console.log('[Canary] Loaded exactly ' + records.length + ' records.');

  console.log('[Canary] 2. Verifying PostgREST schema privacy & Accept-Profile rejection (fail-closed)...');
  const securityCheck = await checkPostgRestExposureFailClosed(supabaseUrl || 'https://mock.supabase.co', supabaseKey || 'mock-key', options.fetch);
  console.log('[Canary] PostgREST schema verified private: ' + securityCheck.postgrest_schema + ' (Accept-Profile rejected: HTTP ' + securityCheck.accept_profile_status + ')');

  console.log('[Canary] 2b. Performing Live PostgreSQL Security & Privilege Audit...');
  const { data: dbPrivileges, error: privErr } = await supabase.rpc('audit_mariadb_private_raw_security');
  if (privErr) {
    throw new Error('PostgreSQL security audit query failed: ' + privErr.message);
  }
  validateSecurityPrivilegeMatrix(dbPrivileges);
  console.log('[Canary] PostgreSQL security privilege matrix verified: 100% conformant with least-privilege immutable spec.');

  console.log('[Canary] 3. Ingesting ' + records.length + ' records in batches of ' + batchSize + '...');
  let totalInput = 0;
  let totalNewlyStaged = 0;
  let totalAlreadyStaged = 0;
  let totalErrors = 0;
  const batchResults = [];

  let lastCreatedOn = '';
  let lastSourceId = '';

  for (let i = 0; i < records.length; i += batchSize) {
    const batchRecords = records.slice(i, i + batchSize);
    const expectedLastCreatedOn = lastCreatedOn;
    const expectedLastSourceId = lastSourceId;

    const nextLastCreatedOn = batchRecords[batchRecords.length - 1].source_created_on || '';
    const nextLastSourceId = batchRecords[batchRecords.length - 1].source_id || '';

    const batchToken = sha256(runKey + ':' + i + ':' + batchRecords[0].source_id + ':' + nextLastSourceId);

    const { data, error } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
      p_run_key: runKey,
      p_batch_token: batchToken,
      p_contract: CONTRACT,
      p_expected_last_created_on: expectedLastCreatedOn,
      p_expected_last_source_id: expectedLastSourceId,
      p_next_last_created_on: nextLastCreatedOn,
      p_next_last_source_id: nextLastSourceId,
      p_records: batchRecords
    });

    if (error) {
      console.error('[Canary] Batch ' + (i / batchSize + 1) + ' RPC error:', error);
      throw new Error('RPC batch failed: ' + error.message);
    }

    lastCreatedOn = nextLastCreatedOn;
    lastSourceId = nextLastSourceId;

    totalInput += data.source_rows || batchRecords.length;
    totalNewlyStaged += data.newly_staged_rows || 0;
    totalAlreadyStaged += data.already_staged_identical_rows || 0;
    totalErrors += data.capture_error_rows || 0;
    batchResults.push(data);

    console.log('[Canary] Batch ' + batchResults.length + ': Staged=' + data.newly_staged_rows + ', Existing=' + data.already_staged_identical_rows + ', Errors=' + data.capture_error_rows);
  }

  // Hard Invariant Gate 1: Exactly 1,000 input rows accounted for
  if (totalInput !== 1000 || (totalNewlyStaged + totalAlreadyStaged + totalErrors !== 1000)) {
    throw new Error('Reconciliation Gate 1 Failure: Input=' + totalInput + ', Staged=' + totalNewlyStaged + ', Existing=' + totalAlreadyStaged + ', Errors=' + totalErrors);
  }

  console.log('[Canary] 4. Performing Deep Hash Readback via Service-Role Verification RPC...');
  const sourceIds = records.map(r => r.source_id);
  const expectedHashMap = new Map(records.map(r => [r.source_id, r.source_hash]));

  let recomputedCount = 0;
  let mismatchCount = 0;
  const hashMismatches = [];

  for (let i = 0; i < sourceIds.length; i += 250) {
    const chunkIds = sourceIds.slice(i, i + 250);
    const { data: stagedRows, error: readErr } = await supabase.rpc('verify_mariadb_private_raw_readback', {
      p_source_ids: chunkIds
    });

    if (readErr) {
      throw new Error('Verification RPC readback failed: ' + readErr.message);
    }

    if (!Array.isArray(stagedRows)) {
      throw new Error('Verification RPC returned non-array result');
    }

    for (const row of stagedRows) {
      recomputedCount += 1;
      const expectedHash = expectedHashMap.get(row.source_id);
      const recalculatedHash = sha256(row.raw_payload_text);

      if (recalculatedHash !== expectedHash || recalculatedHash !== row.source_hash) {
        mismatchCount += 1;
        hashMismatches.push({
          source_id: row.source_id,
          expected_hash: expectedHash,
          stored_hash: row.source_hash,
          recalculated_hash: recalculatedHash
        });
      }
    }
  }

  // Hard Invariant Gate 2: Exactly 1,000 hashes recomputed, 0 mismatches
  if (recomputedCount !== 1000 || mismatchCount !== 0) {
    throw new Error('Hash Verification Gate Failure: Recomputed=' + recomputedCount + ' (expected 1000), Mismatches=' + mismatchCount + ' (expected 0)');
  }

  console.log('[Canary] 5. Verifying Zero Public Publication by Source Identity (All 1,000 IDs)...');
  let publicMatchCount = 0;

  for (let i = 0; i < sourceIds.length; i += 200) {
    const chunkIds = sourceIds.slice(i, i + 200);
    const chunkRecordIds = chunkIds.map(id => ('mysql_auctions_' + id));

    // Check public.raw_messages
    const { data: pubRaw, error: rawErr } = await supabase
      .from('raw_messages')
      .select('id, external_message_id')
      .in('external_message_id', chunkIds);
    if (rawErr) throw new Error('Public raw_messages audit query failed: ' + rawErr.message);
    publicMatchCount += pubRaw?.length || 0;

    // Check public.raw_message_versions
    const { data: pubVers, error: versErr } = await supabase
      .from('raw_message_versions')
      .select('id, source_record_id')
      .in('source_record_id', chunkRecordIds);
    if (versErr) throw new Error('Public raw_message_versions audit query failed: ' + versErr.message);
    publicMatchCount += pubVers?.length || 0;

    // Check public.watch_records
    const { data: pubWatch, error: watchErr } = await supabase
      .from('watch_records')
      .select('id, source_id')
      .in('source_id', chunkIds);
    if (watchErr) throw new Error('Public watch_records audit query failed: ' + watchErr.message);
    publicMatchCount += pubWatch?.length || 0;
  }

  // Hard Invariant Gate 3: Zero public pollution
  if (publicMatchCount !== 0) {
    throw new Error('Public Publication Gate Failure: Detected ' + publicMatchCount + ' canary rows in public production tables');
  }

  console.log('[Canary] 6. Testing Idempotent Rerun (BEFORE finalization of primary checkpoint)...');
  const rerunRunKey = runKey + '-rerun';
  let rerunNewlyStaged = 0;
  let rerunAlreadyStaged = 0;
  let rerunErrors = 0;
  let rerunLastCreatedOn = '';
  let rerunLastSourceId = '';

  for (let i = 0; i < records.length; i += batchSize) {
    const batchRecords = records.slice(i, i + batchSize);
    const expectedLastCreatedOn = rerunLastCreatedOn;
    const expectedLastSourceId = rerunLastSourceId;
    const nextLastCreatedOn = batchRecords[batchRecords.length - 1].source_created_on || '';
    const nextLastSourceId = batchRecords[batchRecords.length - 1].source_id || '';
    const batchToken = sha256(rerunRunKey + ':' + i + ':' + batchRecords[0].source_id + ':' + nextLastSourceId);

    const { data: rerunData, error: rerunErr } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
      p_run_key: rerunRunKey,
      p_batch_token: batchToken,
      p_contract: CONTRACT,
      p_expected_last_created_on: expectedLastCreatedOn,
      p_expected_last_source_id: expectedLastSourceId,
      p_next_last_created_on: nextLastCreatedOn,
      p_next_last_source_id: nextLastSourceId,
      p_records: batchRecords
    });

    if (rerunErr) {
      throw new Error('Idempotent rerun failed: ' + rerunErr.message);
    }

    rerunLastCreatedOn = nextLastCreatedOn;
    rerunLastSourceId = nextLastSourceId;
    rerunNewlyStaged += rerunData.newly_staged_rows || 0;
    rerunAlreadyStaged += rerunData.already_staged_identical_rows || 0;
    rerunErrors += rerunData.capture_error_rows || 0;
  }

  // Hard Invariant Gate 4: Idempotent rerun creates 0 new rows
  if (rerunNewlyStaged !== 0 || rerunAlreadyStaged !== 1000 || rerunErrors !== 0) {
    throw new Error('Idempotent Rerun Gate Failure: NewlyStaged=' + rerunNewlyStaged + ' (expected 0), AlreadyStaged=' + rerunAlreadyStaged + ' (expected 1000)');
  }

  // Finalize rerun checkpoint to VERIFICATION_COMPLETE
  const { error: rerunFinalErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: rerunRunKey,
    p_expected_staged_rows: (rerunNewlyStaged + rerunAlreadyStaged),
    p_expected_error_rows: rerunErrors,
    p_final_status: 'VERIFICATION_COMPLETE'
  });
  if (rerunFinalErr) {
    throw new Error('Rerun checkpoint finalization failed: ' + rerunFinalErr.message);
  }

  console.log('[Canary] 7. Querying Real Error Ledger Rows...');
  const { data: errorRows, error: errLedgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
    p_run_key: runKey
  });
  if (errLedgerErr) {
    throw new Error('Failed to query error ledger: ' + errLedgerErr.message);
  }

  // Hard Invariant Gate 5: Assert errorRows.length === totalErrors
  if (!Array.isArray(errorRows) || errorRows.length !== totalErrors) {
    throw new Error('Error Ledger Discrepancy: Retrieved ' + (errorRows?.length || 0) + ' error rows, expected ' + totalErrors);
  }

  console.log('[Canary] 8. Finalizing Primary Checkpoint Status to RAW_STAGED (Last DB Action)...');
  const { data: finalization, error: finalErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: runKey,
    p_expected_staged_rows: (totalNewlyStaged + totalAlreadyStaged),
    p_expected_error_rows: totalErrors,
    p_final_status: 'RAW_STAGED'
  });
  if (finalErr) {
    throw new Error('Primary checkpoint finalization failed: ' + finalErr.message);
  }

  const totalDurationMs = Date.now() - startTime;
  const memUsage = process.memoryUsage();

  // 9. Generate and Write the 7 Required Genuine Artifacts
  const runManifest = {
    contract: CONTRACT,
    canary_version: 'v1.2-private-staging-canary-hardened',
    run_key: runKey,
    started_at: startIso,
    ended_at: new Date().toISOString(),
    duration_ms: totalDurationMs,
    input_file: resolveBenchmarkGzPath(gzPath),
    input_records: records.length,
    batch_size: batchSize,
    batches_processed: batchResults.length,
    canonicalization_version: CANONICAL_VERSION,
    hash_algorithm: HASH_ALGO
  };

  const reconciliation = {
    contract: CONTRACT,
    canary_input_rows: records.length,
    newly_staged_rows: totalNewlyStaged,
    already_staged_identical_rows: totalAlreadyStaged,
    immutable_error_ledger_rows: totalErrors,
    exact_reconciliation_verified: true,
    formula: 'canary_input_rows = newly_staged_rows + already_staged_identical_rows + immutable_error_ledger_rows',
    batches: batchResults
  };

  const hashVerification = {
    contract: CONTRACT,
    total_recomputed: recomputedCount,
    total_mismatches: mismatchCount,
    hash_algorithm: HASH_ALGO,
    canonicalization_version: CANONICAL_VERSION,
    all_hashes_verified: true,
    mismatches: hashMismatches
  };

  const errorsArtifact = {
    contract: CONTRACT,
    run_key: runKey,
    total_errors: totalErrors,
    error_records: errorRows || []
  };

  const securityVerification = {
    contract: CONTRACT,
    schema: 'wf_canonical_staging',
    postgrest_exposed: securityCheck.exposed,
    postgrest_paths: securityCheck.exposed_paths,
    accept_profile_rejected: securityCheck.accept_profile_rejected,
    accept_profile_status: securityCheck.accept_profile_status,
    database_privilege_audit: dbPrivileges
  };

  const publicImpactVerification = {
    contract: CONTRACT,
    canary_source_ids_tested: 1000,
    public_raw_messages_matches: 0,
    public_raw_message_versions_matches: 0,
    public_watch_records_matches: 0,
    zero_public_pollution_verified: true
  };

  const benchmarkArtifact = {
    contract: CONTRACT,
    total_records: records.length,
    runtime_seconds: Number((totalDurationMs / 1000).toFixed(3)),
    rows_per_second: Number((records.length / (totalDurationMs / 1000)).toFixed(2)),
    peak_rss_mb: Number((memUsage.rss / (1024 * 1024)).toFixed(2)),
    heap_used_mb: Number((memUsage.heapUsed / (1024 * 1024)).toFixed(2)),
    idempotent_rerun_result: {
      newly_staged_rows: rerunNewlyStaged,
      already_staged_identical_rows: rerunAlreadyStaged,
      capture_error_rows: rerunErrors,
      idempotency_verified: true,
      checkpoint_status: 'VERIFICATION_COMPLETE'
    }
  };

  fs.writeFileSync(path.join(outputDir, 'canary-run-manifest.json'), JSON.stringify(runManifest, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-reconciliation.json'), JSON.stringify(reconciliation, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-hash-verification.json'), JSON.stringify(hashVerification, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-errors.json'), JSON.stringify(errorsArtifact, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-security-verification.json'), JSON.stringify(securityVerification, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-public-impact-verification.json'), JSON.stringify(publicImpactVerification, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-benchmark.json'), JSON.stringify(benchmarkArtifact, null, 2));

  console.log('[Canary] All 7 genuine artifacts successfully written to ' + outputDir);
  return {
    runManifest,
    reconciliation,
    hashVerification,
    errorsArtifact,
    securityVerification,
    publicImpactVerification,
    benchmarkArtifact
  };
}

module.exports = {
  run1kPrivateCanary,
  loadFirst1kRecords,
  canonicalizeRawPayload,
  checkPostgRestExposureFailClosed,
  validateSecurityPrivilegeMatrix,
  stableJson,
  sha256
};

if (require.main === module) {
  run1kPrivateCanary().then(() => {
    console.log('[Canary] Execution finished successfully.');
  }).catch(err => {
    console.error('[Canary] Fatal error:', err);
    process.exit(1);
  });
}
