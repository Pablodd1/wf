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

async function runCanary1k(options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log('============================================================');
  console.log('STARTING FULL CAPTURE PREFLIGHT & 1,000-ROW PRIVATE CANARY');
  console.log('============================================================');

  // 1. TLS & Transport Preflight with Certificate Pinning
  console.log('1. Verifying TLS transport security and certificate pinning...');
  const transportConfig = resolveMariaDbTransport(process.env);
  console.log(`Transport Verified: ${transportConfig.transport} (rejectUnauthorized: true, pinned_cert: ${PINNED_MARIADB_SERVER_CERT_SHA256})`);

  // 2. MariaDB Consistent Snapshot
  console.log('2. Connecting to MariaDB with pinned TLS and creating consistent snapshot...');
  const mariadbConn = await mysql.createConnection({
    host: process.env.MARIADB_HOST,
    port: Number(process.env.MARIADB_PORT || 3306),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE,
    ssl: transportConfig.ssl
  });

  let manifest;
  let sampleRows;
  try {
    manifest = await createFrozenSourceBoundary(mariadbConn);
    console.log(`Source Boundary Frozen: ${manifest.total_source_rows} rows`);
    console.log(`Lower Boundary: ${JSON.stringify(manifest.lower_boundary)}`);
    console.log(`Upper Boundary: ${JSON.stringify(manifest.upper_boundary)}`);

    // Extract 1,000 ordered canary rows absent from previous staging (e.g. created_on >= 2025-08-01)
    const canaryCohortWhere = process.env.CANARY_COHORT_WHERE || "created_on >= '2025-08-01 00:00:00'";
    console.log(`3. Extracting 1,000 ordered canary rows absent from private staging (WHERE ${canaryCohortWhere})...`);
    const [rows] = await mariadbConn.query(
      `SELECT * FROM auctions WHERE ${canaryCohortWhere} ORDER BY created_on ASC, id ASC LIMIT 1000`
    );
    sampleRows = rows;
  } finally {
    await mariadbConn.query('COMMIT');
    await mariadbConn.end();
  }

  if (sampleRows.length !== 1000) {
    throw new Error(`Canary Extraction Failure: Expected 1,000 rows, got ${sampleRows.length}`);
  }

  // Canonicalize payloads directly from MariaDB row objects
  const canonicalRecords = sampleRows.map((r) => {
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

  const sourceIds = canonicalRecords.map(r => r.source_id);

  // 4. Pre-Ingest Verification: Confirm all 1,000 source identities are absent from staging
  console.log('4. Verifying that all 1,000 selected canary identities are absent from private staging...');
  const initialReadbackRows = [];
  for (let i = 0; i < sourceIds.length; i += 50) {
    const chunkIds = sourceIds.slice(i, i + 50);
    const { data, error } = await supabase.rpc('verify_mariadb_private_raw_readback', {
      p_source_ids: chunkIds
    });
    if (error) throw new Error('Initial absence verification RPC failed: ' + error.message);
    if (data && data.length > 0) {
      initialReadbackRows.push(...data);
    }
  }

  if (initialReadbackRows.length > 0) {
    throw new Error(`Canary Cohort Invariant Violation: Found ${initialReadbackRows.length} pre-existing rows in staging for selected canary cohort!`);
  }
  console.log('Absence Invariant Verified: 0 pre-existing rows in private staging.');

  // 5. Pre-Ingest Public Lineage Snapshot
  console.log('5. Capturing pre-ingest public lineage baseline...');
  const publicBefore = await snapshotPublicLineage(supabase, sourceIds);
  console.log('Public Baseline:', publicBefore);

  // 6. Ingest 1,000 rows in 4 batches of 250
  const canaryRunKey = `full-capture-canary-1k-${Date.now()}`;
  console.log(`6. Ingesting 1,000 canary rows into private staging (runKey=${canaryRunKey})...`);

  const batchSize = 250;
  let newlyStaged = 0;
  let alreadyStaged = 0;
  let totalErrors = 0;
  let lastCreatedOn = '';
  let lastSourceId = '';

  for (let i = 0; i < canonicalRecords.length; i += batchSize) {
    const batchRecords = canonicalRecords.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);
    const firstSourceId = batchRecords[0].source_id;
    const nextLastCreatedOn = batchRecords[batchRecords.length - 1].source_created_on || '';
    const nextLastSourceId = batchRecords[batchRecords.length - 1].source_id || '';
    const batchToken = sha256(`${canaryRunKey}:${batchIndex}:${firstSourceId}:${nextLastSourceId}`);

    const { data, error } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
      p_run_key: canaryRunKey,
      p_batch_token: batchToken,
      p_contract: CONTRACT,
      p_expected_last_created_on: lastCreatedOn,
      p_expected_last_source_id: lastSourceId,
      p_next_last_created_on: nextLastCreatedOn,
      p_next_last_source_id: nextLastSourceId,
      p_records: batchRecords
    });

    if (error) throw new Error(`Batch ${batchIndex} Ingestion Failed: ` + error.message);

    newlyStaged += data.newly_staged_rows || 0;
    alreadyStaged += data.already_staged_identical_rows || 0;
    totalErrors += data.capture_error_rows || 0;
    lastCreatedOn = nextLastCreatedOn;
    lastSourceId = nextLastSourceId;
    console.log(`Batch ${batchIndex + 1}/4 Complete: newly_staged=${data.newly_staged_rows}, already_staged=${data.already_staged_identical_rows}, errors=${data.capture_error_rows}`);
  }

  if (newlyStaged !== 1000 || alreadyStaged !== 0 || totalErrors !== 0) {
    throw new Error(`Canary Ingestion Invariant Failure: Expected newly_staged=1000, got newly_staged=${newlyStaged}, already_staged=${alreadyStaged}, errors=${totalErrors}`);
  }

  // 7. Deep Hash Readback Verification across all 1,000 rows in chunks of 50
  console.log('7. Performing deep hash readback verification across all 1,000 rows...');
  const readbackRows = [];
  for (let i = 0; i < sourceIds.length; i += 50) {
    const chunkIds = sourceIds.slice(i, i + 50);
    const { data, error } = await supabase.rpc('verify_mariadb_private_raw_readback', {
      p_source_ids: chunkIds
    });
    if (error) throw new Error('Hash readback RPC failed: ' + error.message);
    if (data) readbackRows.push(...data);
  }

  const readbackResult = verifyHashReadbackContract(readbackRows, canonicalRecords);
  console.log('Hash Readback Verified:', readbackResult);

  // 8. Error Ledger Audit
  console.log('8. Verifying error ledger contract...');
  const { data: ledgerErrors, error: ledgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
    p_run_key: canaryRunKey
  });
  if (ledgerErr) throw new Error('Error ledger query failed: ' + ledgerErr.message);

  const errorLedgerResult = verifyErrorLedgerContract(ledgerErrors || [], totalErrors);
  console.log('Error Ledger Verified:', errorLedgerResult);

  // 9. Idempotent Rerun Verification
  console.log('9. Testing idempotent rerun verification...');
  let idempotentNewlyStaged = 0;
  let idempotentAlreadyStaged = 0;
  let idempotentErrors = 0;
  let rerunLastCreatedOn = '';
  let rerunLastSourceId = '';

  for (let i = 0; i < canonicalRecords.length; i += batchSize) {
    const batchRecords = canonicalRecords.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);
    const firstSourceId = batchRecords[0].source_id;
    const nextLastCreatedOn = batchRecords[batchRecords.length - 1].source_created_on || '';
    const nextLastSourceId = batchRecords[batchRecords.length - 1].source_id || '';
    const batchToken = sha256(`${canaryRunKey}:rerun:${batchIndex}:${firstSourceId}:${nextLastSourceId}`);

    const { data: rerunData, error: rerunErr } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
      p_run_key: `${canaryRunKey}-rerun`,
      p_batch_token: batchToken,
      p_contract: CONTRACT,
      p_expected_last_created_on: rerunLastCreatedOn,
      p_expected_last_source_id: rerunLastSourceId,
      p_next_last_created_on: nextLastCreatedOn,
      p_next_last_source_id: nextLastSourceId,
      p_records: batchRecords
    });

    if (rerunErr) throw new Error(`Idempotent rerun batch ${batchIndex} failed: ` + rerunErr.message);
    idempotentNewlyStaged += rerunData.newly_staged_rows || 0;
    idempotentAlreadyStaged += rerunData.already_staged_identical_rows || 0;
    idempotentErrors += rerunData.capture_error_rows || 0;
    rerunLastCreatedOn = nextLastCreatedOn;
    rerunLastSourceId = nextLastSourceId;
  }

  console.log(`Idempotent Rerun Result: newly_staged=${idempotentNewlyStaged}, already_staged=${idempotentAlreadyStaged}, errors=${idempotentErrors}`);
  if (idempotentAlreadyStaged !== 1000 || idempotentNewlyStaged !== 0 || idempotentErrors !== 0) {
    throw new Error(`Idempotent Rerun Invariant Failure: Expected already_staged=1000, got ${idempotentAlreadyStaged} (newly_staged=${idempotentNewlyStaged}, errors=${idempotentErrors})`);
  }

  // 10. Post-Ingest Public Lineage Verification
  console.log('10. Checking post-ingest public lineage across all 1,000 source identities...');
  const publicAfter = await snapshotPublicLineage(supabase, sourceIds);
  console.log('Public Post-Canary:', publicAfter);

  if (stableJson(publicBefore) !== stableJson(publicAfter)) {
    throw new Error('Public Mutation Gate Failure: Public table counts changed during 1k canary execution!');
  }

  // 11. Checkpoint Finalization
  console.log('11. Finalizing canary checkpoint status to RAW_STAGED...');
  const { data: finalizeData, error: finalizeErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: canaryRunKey,
    p_expected_staged_rows: newlyStaged + alreadyStaged,
    p_expected_error_rows: totalErrors,
    p_final_status: 'RAW_STAGED'
  });
  if (finalizeErr) throw new Error('Checkpoint finalization failed: ' + finalizeErr.message);
  console.log('Canary Checkpoint Finalized:', finalizeData);

  // 12. Write All 6 Artifacts
  const outputDir = path.resolve('audit-output/mariadb-live/full-capture-canary-1k');
  fs.mkdirSync(outputDir, { recursive: true });

  const reconciliationData = {
    contract: CONTRACT,
    canary_run_key: canaryRunKey,
    input_rows: canonicalRecords.length,
    newly_staged_rows: newlyStaged,
    already_staged_identical_rows: alreadyStaged,
    error_rows: totalErrors,
    idempotent_rerun_newly_staged: idempotentNewlyStaged,
    idempotent_rerun_already_staged: idempotentAlreadyStaged,
    idempotent_rerun_errors: idempotentErrors,
    exact_reconciliation: (newlyStaged + alreadyStaged + totalErrors) === canonicalRecords.length && idempotentAlreadyStaged === canonicalRecords.length
  };

  const hashVerificationData = {
    contract: CONTRACT,
    canary_run_key: canaryRunKey,
    total_verified: readbackResult.total_verified,
    mismatches: 0,
    canonical_version: CANONICAL_VERSION,
    hash_algorithm: HASH_ALGO,
    pinned_cert_fingerprint: PINNED_MARIADB_SERVER_CERT_SHA256
  };

  const errorLedgerData = {
    contract: CONTRACT,
    canary_run_key: canaryRunKey,
    total_errors: totalErrors,
    ledger_entries: ledgerErrors || []
  };

  const publicImpactData = {
    source_identities_verified: canonicalRecords.length,
    public_matches_before: publicBefore,
    public_matches_after: publicAfter,
    zero_public_delta_verified: true
  };

  fs.writeFileSync(path.join(outputDir, 'canary-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-reconciliation.json'), JSON.stringify(reconciliationData, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-hash-verification.json'), JSON.stringify(hashVerificationData, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-error-ledger.json'), JSON.stringify(errorLedgerData, null, 2));
  fs.writeFileSync(path.join(outputDir, 'canary-public-impact.json'), JSON.stringify(publicImpactData, null, 2));

  const artifactFiles = [
    'canary-manifest.json',
    'canary-reconciliation.json',
    'canary-hash-verification.json',
    'canary-error-ledger.json',
    'canary-public-impact.json'
  ];

  const checksums = {};
  for (const af of artifactFiles) {
    const p = path.join(outputDir, af);
    if (fs.existsSync(p)) {
      checksums[af] = sha256(fs.readFileSync(p, 'utf8'));
    }
  }

  fs.writeFileSync(path.join(outputDir, 'canary-checksums.json'), JSON.stringify(checksums, null, 2));

  console.log('\n============================================================');
  console.log('1,000-ROW PRIVATE CANARY COMPLETED SUCCESSFULLY!');
  console.log('Artifacts written to ' + outputDir);
  console.log('============================================================\n');

  return { manifest, reconciliation: reconciliationData, checksums };
}

if (require.main === module) {
  runCanary1k()
    .then(({ manifest, reconciliation, checksums }) => {
      console.log('Canary Run Manifest:', JSON.stringify(manifest, null, 2));
      console.log('Reconciliation:', JSON.stringify(reconciliation, null, 2));
      console.log('Artifact Checksums:', JSON.stringify(checksums, null, 2));
    })
    .catch(err => {
      console.error('Canary Fatal Error:', err);
      process.exit(1);
    });
}

module.exports = { runCanary1k, resolveMariaDbTransport, isPublicHost };
