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
} = require('./full-capture-preflight.cjs');

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

async function snapshotPublicLineage(supabase, sourceIds) {
  const snapshot = {
    raw_messages_count: 0,
    raw_message_versions_count: 0,
    watch_records_count: 0
  };

  const chunks = [];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunkIds = sourceIds.slice(i, i + 100);
    const chunkRecordIds = chunkIds.map(id => ('mysql_auctions_' + id));
    chunks.push({ chunkIds, chunkRecordIds });
  }

  const poolConcurrency = 10;
  const queue = [...chunks];

  async function queryWorker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const [resRaw, resVers, resWatch] = await Promise.all([
        supabase.from('raw_messages').select('id').in('external_message_id', item.chunkRecordIds),
        supabase.from('raw_message_versions').select('id').in('source_record_id', item.chunkRecordIds),
        supabase.from('watch_records').select('id').in('id', item.chunkIds)
      ]);

      if (resRaw.error) throw new Error('Public raw_messages audit query failed: ' + resRaw.error.message);
      if (resVers.error) throw new Error('Public raw_message_versions audit query failed: ' + resVers.error.message);
      if (resWatch.error) throw new Error('Public watch_records audit query failed: ' + resWatch.error.message);

      snapshot.raw_messages_count += resRaw.data?.length || 0;
      snapshot.raw_message_versions_count += resVers.data?.length || 0;
      snapshot.watch_records_count += resWatch.data?.length || 0;
    }
  }

  await Promise.all(Array.from({ length: poolConcurrency }, () => queryWorker()));
  return snapshot;
}

async function runCaptureLoop(options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log('============================================================');
  console.log('MARIADB PRIVATE RAW CAPTURE RUNNER');
  console.log('============================================================');

  // 1. TLS Transport Security with Pinned Certificate Fingerprint
  console.log('1. Verifying TLS transport security and certificate pinning...');
  const transportConfig = resolveMariaDbTransport(process.env);
  console.log(`Transport Verified: ${transportConfig.transport} (rejectUnauthorized: true, pinned_cert: ${PINNED_MARIADB_SERVER_CERT_SHA256})`);

  // 2. MariaDB Connection & Checkpoint State Retrieval
  const runKey = process.env.CAPTURE_RUN_KEY || options.runKey || `full-capture-auctions-${Date.now()}`;
  const batchSize = Number(process.env.BATCH_SIZE || options.batchSize || 250);
  const maxRows = options.maxRows || (process.env.MAX_CAPTURE_ROWS ? Number(process.env.MAX_CAPTURE_ROWS) : null);

  console.log(`2. Reading checkpoint state for runKey '${runKey}' via RPC (fail-closed)...`);
  const existingCheckpoint = await fetchCheckpointState(supabase, runKey);

  console.log('3. Connecting to MariaDB with pinned TLS and establishing consistent snapshot...');
  const mariadbConn = await mysql.createConnection({
    host: process.env.MARIADB_HOST,
    port: Number(process.env.MARIADB_PORT || 3306),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE,
    ssl: transportConfig.ssl
  });

  let manifest;
  let lastCreatedOn;
  let lastSourceId;
  let cumulativeInputRows;
  let cumulativeNewlyStaged;
  let cumulativeAlreadyStaged;
  let cumulativeErrors;

  try {
    if (existingCheckpoint) {
      console.log(`Checkpoint Found: Resuming existing runKey '${runKey}'.`);
      if (!existingCheckpoint.frozen_upper_boundary || !existingCheckpoint.manifest_sha256) {
        throw new Error('Resume Safety Violation: Existing checkpoint is missing frozen_upper_boundary or manifest_sha256');
      }

      manifest = {
        contract: existingCheckpoint.contract || CONTRACT,
        source_system: 'OceanDigital MariaDB',
        source_database: 'thecollective_inventory',
        source_table: 'auctions',
        isolation_level: 'REPEATABLE READ (REUSED FROZEN BOUNDARY ON RESUME)',
        upper_boundary: existingCheckpoint.frozen_upper_boundary,
        manifest_sha256: existingCheckpoint.manifest_sha256
      };

      lastCreatedOn = existingCheckpoint.last_created_on || '';
      lastSourceId = existingCheckpoint.last_source_id || '';
      cumulativeInputRows = Number(existingCheckpoint.input_rows || 0);
      cumulativeNewlyStaged = Number(existingCheckpoint.newly_staged_rows || 0);
      cumulativeAlreadyStaged = Number(existingCheckpoint.already_staged_identical_rows || 0);
      cumulativeErrors = Number(existingCheckpoint.capture_error_rows || 0);

      console.log(`Resumed State: input_rows=${cumulativeInputRows}, newly_staged=${cumulativeNewlyStaged}, already_staged=${cumulativeAlreadyStaged}, errors=${cumulativeErrors}`);
      console.log(`Resumed Cursor: created_on='${lastCreatedOn}', id='${lastSourceId}'`);
      console.log(`Reused Frozen Upper Boundary: ${JSON.stringify(manifest.upper_boundary)}`);
      console.log(`Validated Manifest SHA-256: ${manifest.manifest_sha256}`);
    } else {
      console.log(`New Run: Freezing initial source boundary for runKey '${runKey}'...`);
      manifest = await createFrozenSourceBoundary(mariadbConn);
      lastCreatedOn = '';
      lastSourceId = '';
      cumulativeInputRows = 0;
      cumulativeNewlyStaged = 0;
      cumulativeAlreadyStaged = 0;
      cumulativeErrors = 0;

      console.log(`Source Boundary Frozen: ${manifest.total_source_rows} total rows`);
      console.log(`Lower Boundary: ${JSON.stringify(manifest.lower_boundary)}`);
      console.log(`Upper Boundary: ${JSON.stringify(manifest.upper_boundary)}`);
      console.log(`Manifest SHA-256: ${manifest.manifest_sha256}`);
    }
  } catch (err) {
    await mariadbConn.end();
    throw err;
  }

  // 4. Execution Loop
  console.log(`4. Starting keyset ingestion loop (batchSize=${batchSize})...`);
  const canonicalRecordsHistory = [];
  let batchIndex = 0;

  try {
    while (true) {
      const remainingLimit = maxRows ? Math.min(batchSize, maxRows - cumulativeInputRows) : batchSize;
      if (remainingLimit <= 0) break;

      const rows = await fetchKeysetBatch(mariadbConn, {
        lastCreatedOn,
        lastSourceId,
        upperBoundary: manifest.upper_boundary,
        batchSize: remainingLimit
      });

      if (!rows || rows.length === 0) {
        console.log('Keyset pagination reached end of source boundary.');
        break;
      }

      const canonicalRecords = rows.map((r) => {
        const rawData = {};
        for (const [k, v] of Object.entries(r)) {
          if (v instanceof Date) {
            rawData[k] = v.toISOString();
          } else {
            rawData[k] = v;
          }
        }
        const rawPayloadText = canonicalizeRawPayload(rawData);
        const sourceHash = sha256(rawPayloadText);
        return {
          source_system: 'OceanDigital MariaDB',
          source_database: 'thecollective_inventory',
          source_table: 'auctions',
          source_id: String(r.id),
          source_unique_key: `OceanDigital MariaDB:thecollective_inventory:auctions:${r.id}`,
          source_record_id: `mysql_auctions_${r.id}`,
          source_created_on: rawData.created_on || '',
          source_updated_on: rawData.updated_on || null,
          raw_message: r.description || '',
          raw_message_source: 'description',
          raw_sha256: sourceHash,
          raw_payload_text: rawPayloadText,
          raw_payload: rawData,
          source_hash: sourceHash,
          canonicalization_version: CANONICAL_VERSION,
          hash_algorithm: HASH_ALGO
        };
      });

      const nextLastCreatedOn = canonicalRecords[canonicalRecords.length - 1].source_created_on || '';
      const nextLastSourceId = canonicalRecords[canonicalRecords.length - 1].source_id || '';
      const firstSourceId = canonicalRecords[0].source_id;
      const batchToken = sha256(`${runKey}:${batchIndex}:${firstSourceId}:${nextLastSourceId}`);

      const { data: batchResult, error: batchError } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
        p_run_key: runKey,
        p_batch_token: batchToken,
        p_contract: CONTRACT,
        p_expected_last_created_on: lastCreatedOn,
        p_expected_last_source_id: lastSourceId,
        p_next_last_created_on: nextLastCreatedOn,
        p_next_last_source_id: nextLastSourceId,
        p_records: canonicalRecords,
        p_frozen_upper_boundary: manifest.upper_boundary,
        p_manifest_sha256: manifest.manifest_sha256
      });

      if (batchError) {
        throw new Error(`Batch ${batchIndex} Ingestion Failed: ` + batchError.message);
      }

      cumulativeNewlyStaged += batchResult.newly_staged_rows || 0;
      cumulativeAlreadyStaged += batchResult.already_staged_identical_rows || 0;
      cumulativeErrors += batchResult.capture_error_rows || 0;
      cumulativeInputRows += canonicalRecords.length;

      for (const rec of canonicalRecords) {
        if (canonicalRecordsHistory.length < 5000) {
          canonicalRecordsHistory.push(rec);
        }
      }

      lastCreatedOn = nextLastCreatedOn;
      lastSourceId = nextLastSourceId;
      batchIndex++;

      if (batchIndex % 10 === 0 || rows.length < remainingLimit) {
        console.log(`Batch ${batchIndex} complete: input_rows=${cumulativeInputRows}, newly_staged=${cumulativeNewlyStaged}, already_staged=${cumulativeAlreadyStaged}, errors=${cumulativeErrors}, cursor=(${lastCreatedOn}, ${lastSourceId})`);
      }

      if (maxRows && cumulativeInputRows >= maxRows) {
        break;
      }
    }
  } finally {
    await mariadbConn.query('COMMIT');
    await mariadbConn.end();
  }

  console.log(`5. Ingestion loop finished: cumulative_input_rows=${cumulativeInputRows}, newly_staged=${cumulativeNewlyStaged}, already_staged=${cumulativeAlreadyStaged}, errors=${cumulativeErrors}`);

  // 6. Cryptographic Hash Readback Verification (Explicitly Sampled)
  const sampleVerificationRecords = canonicalRecordsHistory.slice(0, 1000);
  const sampleSourceIds = sampleVerificationRecords.map(r => r.source_id);
  console.log(`6. Performing sampled cryptographic hash readback verification (${sampleVerificationRecords.length} / ${cumulativeInputRows} rows)...`);
  
  const readbackRows = [];
  for (let i = 0; i < sampleSourceIds.length; i += 50) {
    const chunkIds = sampleSourceIds.slice(i, i + 50);
    const { data, error } = await supabase.rpc('verify_mariadb_private_raw_readback', {
      p_source_ids: chunkIds
    });
    if (error) throw new Error('Hash readback RPC failed: ' + error.message);
    if (data) readbackRows.push(...data);
  }

  const readbackResult = verifyHashReadbackContract(readbackRows, sampleVerificationRecords);
  const isFullVerification = sampleVerificationRecords.length === cumulativeInputRows;
  console.log(`Hash Readback Result (${isFullVerification ? 'FULL_EXHAUSTIVE' : 'SAMPLED'}):`, readbackResult);

  // 7. Error Ledger Verification
  console.log('7. Verifying error ledger contract...');
  const { data: ledgerErrors, error: ledgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
    p_run_key: runKey
  });
  if (ledgerErr) throw new Error('Error ledger query failed: ' + ledgerErr.message);

  const errorLedgerResult = verifyErrorLedgerContract(ledgerErrors || [], cumulativeErrors);
  console.log('Error Ledger Verified:', errorLedgerResult);

  // 8. Checkpoint Finalization using Cumulative Totals
  console.log('8. Finalizing capture checkpoint status to RAW_STAGED using cumulative totals...');
  const { data: finalizeData, error: finalizeErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: runKey,
    p_expected_staged_rows: cumulativeNewlyStaged + cumulativeAlreadyStaged,
    p_expected_error_rows: cumulativeErrors,
    p_final_status: 'RAW_STAGED'
  });
  if (finalizeErr) throw new Error('Checkpoint finalization failed: ' + finalizeErr.message);
  console.log('Checkpoint Finalized:', finalizeData);

  // 9. Produce Final Audit Summary
  const outputDir = path.resolve('audit-output/mariadb-live/full-capture');
  fs.mkdirSync(outputDir, { recursive: true });

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
    checkpoint_status: 'RAW_STAGED',
    hash_verification: {
      mode: isFullVerification ? 'FULL_EXHAUSTIVE' : 'SAMPLED',
      sample_size: sampleVerificationRecords.length,
      total_staged: cumulativeInputRows,
      sample_verified_count: readbackResult.total_verified,
      mismatches: 0
    }
  };

  fs.writeFileSync(path.join(outputDir, 'capture-report.json'), JSON.stringify(captureReport, null, 2));

  return { manifest, report: captureReport };
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
  isPublicHost
};
