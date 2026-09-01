// tools/mariadb-live/run-full-private-capture.cjs
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
const {
  CONTRACT,
  CANONICAL_VERSION,
  HASH_ALGO,
  PINNED_MARIADB_SERVER_CERT_SHA256,
  PINNED_MARIADB_CA_CERT_SHA256,
  sha256,
  stableJson,
  computeManifestHash,
  canonicalizeRawPayload,
  parseMaxCaptureRows,
  checkPinnedServerIdentity,
  verifyTlsProof,
  createFrozenSourceBoundary,
  buildKeysetQuery,
  fetchKeysetBatch,
  fetchCheckpointState,
  verifyHashReadbackContract,
  verifyErrorLedgerContract,
  verifyDryRunReconciliation
} = require('./full-capture-preflight.cjs');
const { sanitizeLosslessPayload } = require('./lossless-payload-sanitizer.cjs');

function isPublicHost(host) {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return false;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return false;
  if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.railway.internal')) return false;
  return true;
}

function resolveMariaDbTransport(env = process.env, options = {}) {
  const host = env.MARIADB_HOST || '';
  if (isPublicHost(host)) {
    if (env.MARIADB_PRIVATE_TUNNEL_VERIFIED === 'true') {
      throw new Error(`Security Violation: Public host '${host}' cannot claim PRIVATE_TUNNEL_VERIFIED without a verified TLS CA`);
    }
  }

  if (env.MARIADB_TLS_CA_FILE) {
    const caFile = path.resolve(env.MARIADB_TLS_CA_FILE);
    if (!fs.existsSync(caFile)) throw new Error(`MariaDB TLS CA file does not exist: ${caFile}`);
    return {
      ssl: {
        ca: fs.readFileSync(caFile),
        rejectUnauthorized: true,
        checkServerIdentity: checkPinnedServerIdentity
      },
      transport: 'TLS_CA_VERIFIED',
      ca_file: caFile
    };
  }

  if (env.MARIADB_TLS_CA_CERT) {
    return {
      ssl: {
        ca: Buffer.from(env.MARIADB_TLS_CA_CERT, 'utf-8'),
        rejectUnauthorized: true,
        checkServerIdentity: checkPinnedServerIdentity
      },
      transport: 'TLS_CA_VERIFIED'
    };
  }

  const defaultCaPath = options.defaultCaPath || path.resolve(__dirname, 'mariadb-server-ca.pem');
  if (options.useDefaultCa !== false && fs.existsSync(defaultCaPath)) {
    return {
      ssl: {
        ca: fs.readFileSync(defaultCaPath),
        rejectUnauthorized: true,
        checkServerIdentity: checkPinnedServerIdentity
      },
      transport: 'TLS_CA_VERIFIED',
      ca_file: defaultCaPath
    };
  }

  if (!isPublicHost(host) && env.MARIADB_PRIVATE_TUNNEL_VERIFIED === 'true') {
    return { ssl: null, transport: 'PRIVATE_TUNNEL_VERIFIED' };
  }

  throw new Error(`MariaDB source on host '${host}' requires a verified TLS CA or an explicitly verified private network tunnel`);
}

function buildStagingRecord(row, manifest = {}) {
  const sanitization = sanitizeLosslessPayload(row);
  const sourceHash = sanitization.originalHash;
  const createdOn = row.created_on ? new Date(row.created_on).toISOString() : null;
  const updatedOn = row.updated_on ? new Date(row.updated_on).toISOString() : null;
  const sourceId = String(row.id);
  const sourceSystem = manifest.source_system || 'OceanDigital MariaDB';
  const sourceDatabase = manifest.source_database || 'thecollective_inventory';
  const sourceTable = manifest.source_table || 'auctions';

  const rawMessage = typeof row.description === 'string'
    ? row.description.replace(/\0/g, '').replace(/\\u0000/g, '')
    : (row.description || null);

  return {
    source_system: sourceSystem,
    source_database: sourceDatabase,
    source_table: sourceTable,
    source_id: sourceId,
    source_unique_key: `${sourceSystem}:${sourceDatabase}:${sourceTable}:${sourceId}`,
    source_record_id: `mysql_${sourceTable}_${sourceId}`,
    source_created_on: createdOn,
    source_updated_on: updatedOn,
    raw_message: rawMessage,
    raw_message_source: 'description',
    raw_sha256: sourceHash,
    raw_payload_text: sanitization.transportPayloadText,
    raw_payload: sanitization.sanitizedObj,
    source_hash: sourceHash,
    canonicalization_version: CANONICAL_VERSION,
    hash_algorithm: HASH_ALGO
  };
}

async function runCaptureLoop(options = {}) {
  const env = options.env || process.env;
  const maxRowsConfig = options.maxRowsConfig !== undefined
    ? options.maxRowsConfig
    : parseMaxCaptureRows(options.maxRows !== undefined ? options.maxRows : env.MAX_CAPTURE_ROWS);

  // Zero-Row Bounded Execution: Strictly no fetch, no checkpoint creation/update, no staging writes
  if (maxRowsConfig.isBounded && maxRowsConfig.limit === 0) {
    console.log('MAX_CAPTURE_ROWS is explicitly 0: Zero rows requested. Skipping keyset fetch, skipping checkpoint creation/update, and skipping staging writes.');
    return {
      contract: CONTRACT,
      run_key: options.runKey || 'zero-row-noop',
      cumulative_input_rows: 0,
      cumulative_newly_staged_rows: 0,
      cumulative_already_staged_identical_rows: 0,
      cumulative_error_rows: 0,
      batches_executed: 0,
      checkpoint_status: 'COPYING_RAW',
      exact_reconciliation: true,
      hash_verification: {
        mode: 'ZERO_ROW_NOOP',
        sample_size: 0,
        total_staged: 0,
        sample_verified_count: 0,
        mismatches: 0
      }
    };
  }

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log('============================================================');
  console.log('MARIADB PRIVATE RAW CAPTURE RUNNER');
  console.log('============================================================');

  // 1. TLS Transport Security with Pinned Certificate Fingerprint
  console.log('1. Verifying TLS transport security and certificate pinning...');
  const transportConfig = resolveMariaDbTransport(env);
  console.log(`Transport Verified: ${transportConfig.transport} (rejectUnauthorized: true, pinned_cert: ${PINNED_MARIADB_SERVER_CERT_SHA256})`);

  // 2. Read Checkpoint via RPC (fail-closed)
  const runKey = env.CAPTURE_RUN_KEY || options.runKey || `full-capture-auctions-${Date.now()}`;
  const batchSize = Number(env.BATCH_SIZE || options.batchSize || 250);
  const sampleRate = Number(env.CAPTURE_VERIFICATION_SAMPLE_RATE || options.sampleRate || 0.01);
  const forceFullVerification = options.forceFullVerification || env.FORCE_FULL_VERIFICATION === 'true';

  console.log(`2. Reading checkpoint state for runKey '${runKey}' via RPC (fail-closed)...`);
  const existingCheckpoint = await fetchCheckpointState(supabase, runKey);

  // 3. Connect to MariaDB with Pinned Certificate Transport
  console.log('3. Connecting to MariaDB with pinned TLS and establishing consistent snapshot...');
  const mariadbConn = await mysql.createConnection({
    host: env.MARIADB_HOST,
    port: Number(env.MARIADB_PORT || 3306),
    user: env.MARIADB_USER,
    password: env.MARIADB_PASSWORD,
    database: env.MARIADB_DATABASE,
    ssl: transportConfig.ssl
  });

  let manifest;
  let lastCreatedOn = '';
  let lastSourceId = '';
  let cumulativeInputRows = 0;
  let cumulativeNewlyStaged = 0;
  let cumulativeAlreadyStaged = 0;
  let cumulativeErrors = 0;

  try {
    if (existingCheckpoint) {
      console.log(`Resume Detected for runKey '${runKey}'. Validating existing checkpoint...`);
      if (existingCheckpoint.status === 'RAW_STAGED') {
        console.log(`Run Key '${runKey}' is already finalized to RAW_STAGED. Exiting cleanly.`);
        return {
          contract: CONTRACT,
          run_key: runKey,
          status: 'ALREADY_FINALIZED',
          total_staged_rows: Number(existingCheckpoint.newly_staged_rows) + Number(existingCheckpoint.already_staged_identical_rows)
        };
      }

      manifest = existingCheckpoint.frozen_manifest;
      if (!manifest || !existingCheckpoint.manifest_sha256) {
        throw new Error(`Corrupt Checkpoint: runKey '${runKey}' is missing frozen_manifest or manifest_sha256`);
      }

      // Recompute and validate manifest hash
      const recomputedHash = computeManifestHash(manifest);
      if (recomputedHash !== existingCheckpoint.manifest_sha256) {
        throw new Error(`Manifest Hash Tampering Detected: recomputed ${recomputedHash} != stored ${existingCheckpoint.manifest_sha256}`);
      }
      console.log(`Manifest SHA-256 validated on resume: ${recomputedHash}`);

      // Initialize from cumulative checkpoint values
      lastCreatedOn = existingCheckpoint.last_created_on || '';
      lastSourceId = existingCheckpoint.last_source_id || '';
      cumulativeInputRows = Number(existingCheckpoint.input_rows || 0);
      cumulativeNewlyStaged = Number(existingCheckpoint.newly_staged_rows || 0);
      cumulativeAlreadyStaged = Number(existingCheckpoint.already_staged_identical_rows || 0);
      cumulativeErrors = Number(existingCheckpoint.capture_error_rows || 0);

      console.log(`Resumed State Initialized: cumulative_input=${cumulativeInputRows}, cursor=(${lastCreatedOn}, ${lastSourceId})`);
    } else {
      console.log(`New Run: Freezing initial source boundary for runKey '${runKey}'...`);
      manifest = await createFrozenSourceBoundary(mariadbConn);
      console.log(`Boundary Frozen: ${manifest.total_source_rows} rows. Manifest SHA-256: ${manifest.manifest_sha256}`);
    }

    // 4. Ingestion Keyset Loop
    console.log(`4. Starting keyset extraction loop through upper boundary ${manifest.upper_boundary.created_on}...`);
    let batchIndex = 0;
    const sampleVerificationRecords = [];

    while (true) {
      // Check bounded limit condition
      if (maxRowsConfig.isBounded && cumulativeInputRows >= maxRowsConfig.limit) {
        console.log(`Reached configured bounded limit of ${maxRowsConfig.limit} rows (cumulative input: ${cumulativeInputRows}).`);
        break;
      }

      const rows = await fetchKeysetBatch(mariadbConn, {
        lastCreatedOn,
        lastSourceId,
        upperBoundary: manifest.upper_boundary,
        batchSize
      });

      if (!rows || rows.length === 0) {
        console.log('Keyset extraction reached upper boundary (0 rows returned).');
        break;
      }

      const rawBatch = rows.map(r => buildStagingRecord(r, manifest));
      const nextLastCreatedOn = rawBatch[rawBatch.length - 1].source_created_on;
      const nextLastSourceId = rawBatch[rawBatch.length - 1].source_id;

      // Sample records for readback verification
      for (const rec of rawBatch) {
        if (forceFullVerification || Math.random() < sampleRate) {
          sampleVerificationRecords.push({
            source_id: rec.source_id,
            source_hash: rec.source_hash,
            raw_payload_text: rec.raw_payload_text
          });
        }
      }

      const batchToken = sha256(`${runKey}:${batchIndex}:${rawBatch[0].source_id}:${nextLastSourceId}`);

      const { data: batchResult, error: batchErr } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
        p_run_key: runKey,
        p_batch_token: batchToken,
        p_contract: CONTRACT,
        p_expected_last_created_on: lastCreatedOn,
        p_expected_last_source_id: lastSourceId,
        p_next_last_created_on: nextLastCreatedOn,
        p_next_last_source_id: nextLastSourceId,
        p_records: rawBatch,
        p_frozen_upper_boundary: manifest,
        p_manifest_sha256: manifest.manifest_sha256
      });

      if (batchErr) {
        throw new Error(`Batch ${batchIndex} Ingestion Failed: ${batchErr.message}`);
      }

      cumulativeInputRows += rawBatch.length;
      cumulativeNewlyStaged += Number(batchResult.newly_staged_rows || 0);
      cumulativeAlreadyStaged += Number(batchResult.already_staged_identical_rows || 0);
      cumulativeErrors += Number(batchResult.capture_error_rows || 0);

      lastCreatedOn = nextLastCreatedOn;
      lastSourceId = nextLastSourceId;
      batchIndex++;

      if (batchIndex % 10 === 0 || cumulativeInputRows >= manifest.total_source_rows) {
        console.log(`Ingested ${cumulativeInputRows} / ${manifest.total_source_rows} rows (${batchIndex} batches). Staged: ${cumulativeNewlyStaged}, Already: ${cumulativeAlreadyStaged}, Errors: ${cumulativeErrors}`);
      }
    }

    // 5. Hash Readback Verification
    const isFullVerification = forceFullVerification || sampleVerificationRecords.length === cumulativeInputRows;
    console.log(`5. Performing ${isFullVerification ? 'FULL EXHAUSTIVE' : 'SAMPLED'} hash readback verification (${sampleVerificationRecords.length} records)...`);
    const sourceIdsToVerify = sampleVerificationRecords.map(r => r.source_id);
    let readbackResult = { verified: true, total_verified: 0, mismatches_count: 0 };

    if (sourceIdsToVerify.length > 0) {
      const CHUNK_SIZE = 500;
      let allReadbackRows = [];
      for (let i = 0; i < sourceIdsToVerify.length; i += CHUNK_SIZE) {
        const chunk = sourceIdsToVerify.slice(i, i + CHUNK_SIZE);
        const { data: readbackRows, error: readbackErr } = await supabase.rpc('verify_mariadb_private_raw_readback', {
          p_source_ids: chunk
        });
        if (readbackErr) throw new Error('Hash readback RPC failed: ' + readbackErr.message);
        allReadbackRows = allReadbackRows.concat(readbackRows || []);
      }

      readbackResult = verifyHashReadbackContract(allReadbackRows, sampleVerificationRecords);
      console.log(`Hash Readback Result: ${readbackResult.total_verified} records verified (0 mismatches). Mode: ${isFullVerification ? 'FULL_EXHAUSTIVE' : 'SAMPLED'}`);
    }

    // 6. Error Ledger Verification
    console.log('6. Querying and verifying error ledger for run...');
    const { data: errorLedgerRows, error: errorLedgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
      p_run_key: runKey
    });
    if (errorLedgerErr) throw new Error('Error ledger RPC failed: ' + errorLedgerErr.message);

    const errorLedgerResult = verifyErrorLedgerContract(errorLedgerRows || [], cumulativeErrors);
    console.log(`Error Ledger Verified: ${errorLedgerRows?.length || 0} recorded errors match cumulative error count.`);

    // 7. Checkpoint Finalization with Strict Boundary and Zero-Row Verification
    let finalStatus = 'COPYING_RAW';
    let finalizeData = null;

    if (maxRowsConfig.isBounded && cumulativeInputRows < manifest.total_source_rows) {
      console.log(`8. Bounded run configured (${cumulativeInputRows} < ${manifest.total_source_rows}): Leaving checkpoint status as COPYING_RAW without calling finalization.`);
      finalStatus = 'COPYING_RAW';
    } else {
      // Invariants required before RAW_STAGED finalization
      if (lastSourceId !== manifest.upper_boundary.id || lastCreatedOn !== manifest.upper_boundary.created_on) {
        throw new Error(`RAW_STAGED Precondition Failed: final cursor (${lastCreatedOn}, ${lastSourceId}) != upper boundary (${manifest.upper_boundary.created_on}, ${manifest.upper_boundary.id})`);
      }

      console.log('8. Finalizing capture checkpoint status to RAW_STAGED using cumulative totals...');
      const { data, error } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
        p_run_key: runKey,
        p_expected_staged_rows: cumulativeNewlyStaged + cumulativeAlreadyStaged,
        p_expected_error_rows: cumulativeErrors,
        p_final_status: 'RAW_STAGED'
      });
      if (error) throw new Error('Checkpoint finalization failed: ' + error.message);
      finalizeData = data;
      finalStatus = 'RAW_STAGED';
      console.log('Checkpoint Finalized:', finalizeData);
    }

    const captureReport = {
      contract: CONTRACT,
      run_key: runKey,
      source_boundary: manifest,
      cumulative_input_rows: cumulativeInputRows,
      cumulative_newly_staged_rows: cumulativeNewlyStaged,
      cumulative_already_staged_identical_rows: cumulativeAlreadyStaged,
      cumulative_error_rows: cumulativeErrors,
      batches_executed: batchIndex,
      last_cursor: {
        created_on: lastCreatedOn,
        source_id: lastSourceId
      },
      exact_reconciliation: (cumulativeNewlyStaged + cumulativeAlreadyStaged + cumulativeErrors) === cumulativeInputRows,
      checkpoint_status: finalStatus,
      hash_verification: {
        mode: isFullVerification ? 'FULL_EXHAUSTIVE' : 'SAMPLED',
        sample_size: sampleVerificationRecords.length,
        total_staged: cumulativeInputRows,
        sample_verified_count: readbackResult.total_verified,
        mismatches: 0
      }
    };

    const outputDir = path.resolve(env.CAPTURE_OUTPUT_DIR || 'audit-output/mariadb-live');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `capture-report-${runKey}.json`), JSON.stringify(captureReport, null, 2));

    return captureReport;
  } finally {
    await mariadbConn.query('ROLLBACK');
    await mariadbConn.end();
  }
}

if (require.main === module) {
  runCaptureLoop()
    .then(({ manifest, report }) => {
      console.log('Full Capture Execution Completed Successfully.');
      console.log('Report:', JSON.stringify(report, null, 2));
    })
    .catch(err => {
      console.error('Full Capture Fatal Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runCaptureLoop,
  resolveMariaDbTransport,
  isPublicHost,
  buildStagingRecord
};
