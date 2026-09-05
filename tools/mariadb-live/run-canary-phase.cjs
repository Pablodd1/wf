// tools/mariadb-live/run-canary-phase.cjs
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  CONTRACT,
  CANONICAL_VERSION,
  HASH_ALGO,
  sha256,
  stableJson,
  computeManifestHash,
  canonicalizeRawPayload,
  verifyHashReadbackContract,
  verifyErrorLedgerContract
} = require('./full-capture-preflight.cjs');

function generateCanaryDataset(baseTime) {
  const canaryRows = [];
  for (let i = 1; i <= 10; i++) {
    const id = 'canary-two-deploy-' + baseTime + '-' + String(i).padStart(3, '0');
    const createdOn = new Date(baseTime + i * 1000).toISOString();
    const rawData = {
      id,
      brand: 'Patek Philippe',
      model: 'Nautilus',
      reference: '5711/1A-CANARY-' + i,
      price: 110000 + i * 500,
      currency: 'USD',
      created_on: createdOn,
      description: 'Two-deployment resume canary auction record #' + i
    };
    const rawPayloadText = canonicalizeRawPayload(rawData);
    const sourceHash = sha256(rawPayloadText);

    canaryRows.push({
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions_canary', // Explicit canary partition
      source_id: id,
      source_unique_key: 'OceanDigital MariaDB:thecollective_inventory:auctions_canary:' + id,
      source_record_id: 'mysql_auctions_canary_' + id,
      source_created_on: createdOn,
      source_updated_on: null,
      raw_message: rawData.description,
      raw_message_source: 'description',
      raw_sha256: sourceHash,
      raw_payload_text: rawPayloadText,
      raw_payload: rawData,
      source_hash: sourceHash,
      canonicalization_version: CANONICAL_VERSION,
      hash_algorithm: HASH_ALGO
    });
  }

  const manifest = {
    contract: CONTRACT,
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions_canary',
    isolation_level: 'REPEATABLE READ (CONSISTENT SNAPSHOT, READ ONLY)',
    total_source_rows: 10,
    lower_boundary: {
      id: canaryRows[0].source_id,
      created_on: canaryRows[0].source_created_on,
      updated_on: null
    },
    upper_boundary: {
      id: canaryRows[9].source_id,
      created_on: canaryRows[9].source_created_on,
      updated_on: null
    },
    snapshot_timestamp: new Date(baseTime).toISOString()
  };
  manifest.manifest_sha256 = computeManifestHash(manifest);

  return { canaryRows, manifest };
}

async function runDeploymentA(baseTime) {
  console.log('============================================================');
  console.log('DEPLOYMENT A: INITIAL INGESTION (BATCH 1: ROWS 1 TO 5)');
  console.log('============================================================');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { canaryRows, manifest } = generateCanaryDataset(baseTime);
  const runKey = 'two-deploy-canary-' + baseTime;

  console.log('Run Key: ' + runKey);
  console.log('Manifest SHA-256: ' + manifest.manifest_sha256);
  console.log('Source Table: auctions_canary');

  // Pre-canary public baseline audit
  const sourceIds = canaryRows.map(r => r.source_id);
  const recordIds = canaryRows.map(r => r.source_record_id);

  const [resPreRaw, resPreVers, resPreWatch] = await Promise.all([
    supabase.from('raw_messages').select('id').in('external_message_id', recordIds),
    supabase.from('raw_message_versions').select('id').in('source_record_id', recordIds),
    supabase.from('watch_records').select('id').in('id', sourceIds)
  ]);
  const prePublicMatches = (resPreRaw.data?.length || 0) + (resPreVers.data?.length || 0) + (resPreWatch.data?.length || 0);
  if (prePublicMatches !== 0) {
    throw new Error('Pre-canary public pollution detected: ' + prePublicMatches + ' matching records');
  }
  console.log('Public Baseline Verified: 0 pre-existing public records.');

  // Ingest Batch 1 (Rows 1 to 5)
  const batch1 = canaryRows.slice(0, 5);
  const batch1Token = sha256(runKey + ':0:' + batch1[0].source_id + ':' + batch1[4].source_id);

  const { data: b1Result, error: b1Err } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: batch1Token,
    p_contract: CONTRACT,
    p_expected_last_created_on: '',
    p_expected_last_source_id: '',
    p_next_last_created_on: batch1[4].source_created_on,
    p_next_last_source_id: batch1[4].source_id,
    p_records: batch1,
    p_frozen_upper_boundary: manifest,
    p_manifest_sha256: manifest.manifest_sha256
  });

  if (b1Err) throw new Error('Deployment A Batch 1 Ingestion Failed: ' + b1Err.message);
  console.log('Deployment A Batch 1 Ingested:', b1Result);

  // Checkpoint validation
  const { data: checkpointA, error: cpErr } = await supabase.rpc('get_mariadb_private_raw_checkpoint', {
    p_run_key: runKey
  });
  if (cpErr) throw new Error('Deployment A Checkpoint Retrieval Failed: ' + cpErr.message);
  console.log('Deployment A Checkpoint Persisted:', checkpointA);

  console.log('DEPLOYMENT A FINISHED WITH STATUS COPYING_RAW (EXIT CODE 0).');
  return { runKey, baseTime, checkpointA };
}

async function runDeploymentB(baseTime) {
  console.log('============================================================');
  console.log('DEPLOYMENT B: RESUME EXECUTION (BATCH 2: ROWS 6 TO 10)');
  console.log('============================================================');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { canaryRows, manifest } = generateCanaryDataset(baseTime);
  const runKey = 'two-deploy-canary-' + baseTime;

  console.log('Deployment B Connecting for Run Key: ' + runKey + '...');

  // 1. Checkpoint Retrieval & Manifest Verification
  const { data: checkpoint, error: cpErr } = await supabase.rpc('get_mariadb_private_raw_checkpoint', {
    p_run_key: runKey
  });
  if (cpErr) throw new Error('Deployment B Checkpoint Retrieval Failed (fail-closed): ' + cpErr.message);
  if (!checkpoint) throw new Error('Deployment B Checkpoint Not Found on Resume');

  console.log('Deployment B Checkpoint Found:', checkpoint);

  const recomputedHash = computeManifestHash(checkpoint.frozen_manifest);
  console.log('Recomputed Manifest Hash: ' + recomputedHash);
  console.log('Stored Manifest Hash:     ' + checkpoint.manifest_sha256);

  if (recomputedHash !== checkpoint.manifest_sha256) {
    throw new Error('Deployment B Manifest Hash Verification Failure');
  }
  console.log('Deployment B: Manifest Hash Recomputed & Cryptographically Validated.');

  // 2. Ingest Batch 2 (Rows 6 to 10) from Resumed Cursor
  const batch2 = canaryRows.slice(5, 10);
  const batch2Token = sha256(runKey + ':1:' + batch2[0].source_id + ':' + batch2[4].source_id);

  const { data: b2Result, error: b2Err } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
    p_run_key: runKey,
    p_batch_token: batch2Token,
    p_contract: CONTRACT,
    p_expected_last_created_on: checkpoint.last_created_on,
    p_expected_last_source_id: checkpoint.last_source_id,
    p_next_last_created_on: batch2[4].source_created_on,
    p_next_last_source_id: batch2[4].source_id,
    p_records: batch2,
    p_frozen_upper_boundary: checkpoint.frozen_manifest,
    p_manifest_sha256: checkpoint.manifest_sha256
  });

  if (b2Err) throw new Error('Deployment B Batch 2 Ingestion Failed: ' + b2Err.message);
  console.log('Deployment B Batch 2 Ingested:', b2Result);

  // 3. Verify Final Checkpoint
  const { data: finalCheckpoint, error: finalCpErr } = await supabase.rpc('get_mariadb_private_raw_checkpoint', {
    p_run_key: runKey
  });
  if (finalCpErr) throw new Error('Deployment B Final Checkpoint Read Failed: ' + finalCpErr.message);
  console.log('Deployment B Cumulative Checkpoint:', finalCheckpoint);

  // 4. Exhaustive Cryptographic Hash Readback Verification (10 / 10 rows)
  const sourceIds = canaryRows.map(r => r.source_id);
  const { data: readbackData, error: rbErr } = await supabase.rpc('verify_mariadb_private_raw_readback', {
    p_source_ids: sourceIds
  });
  if (rbErr) throw new Error('Hash Readback RPC Failed: ' + rbErr.message);

  const readbackResult = verifyHashReadbackContract(readbackData, canaryRows);
  console.log('Deployment B Hash Readback Verified (10/10 EXHAUSTIVE):', readbackResult);

  // 5. Error Ledger Verification
  const { data: ledgerErrors, error: ledgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
    p_run_key: runKey
  });
  if (ledgerErr) throw new Error('Error Ledger RPC Failed: ' + ledgerErr.message);

  const errorLedgerResult = verifyErrorLedgerContract(ledgerErrors || [], 0);
  console.log('Deployment B Error Ledger Verified:', errorLedgerResult);

  // 6. Checkpoint Finalization
  const { data: finalizeData, error: finalizeErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: runKey,
    p_expected_staged_rows: 10,
    p_expected_error_rows: 0,
    p_final_status: 'RAW_STAGED'
  });
  if (finalizeErr) throw new Error('Deployment B Finalization Failed: ' + finalizeErr.message);
  console.log('Deployment B Checkpoint Finalized to RAW_STAGED:', finalizeData);

  // 7. Zero Public Delta Verification
  const recordIds = canaryRows.map(r => r.source_record_id);
  const [resPostRaw, resPostVers, resPostWatch] = await Promise.all([
    supabase.from('raw_messages').select('id').in('external_message_id', recordIds),
    supabase.from('raw_message_versions').select('id').in('source_record_id', recordIds),
    supabase.from('watch_records').select('id').in('id', sourceIds)
  ]);
  const postPublicMatches = (resPostRaw.data?.length || 0) + (resPostVers.data?.length || 0) + (resPostWatch.data?.length || 0);
  if (postPublicMatches !== 0) {
    throw new Error('Zero-public invariant violated: found ' + postPublicMatches + ' public rows matching canary');
  }
  console.log('Zero Public Delta Verified: raw_messages=0, raw_message_versions=0, watch_records=0.');

  console.log('============================================================');
  console.log('TWO-DEPLOYMENT RESUME CANARY COMPLETED WITH 100% RECONCILIATION');
  console.log('============================================================');

  const report = {
    runKey,
    source_table: 'auctions_canary',
    manifest,
    finalCheckpoint,
    readbackResult: {
      mode: 'FULL_EXHAUSTIVE',
      total_verified: 10,
      mismatches: 0
    },
    errorLedgerResult,
    finalizeData,
    publicDelta: 0
  };

  const outputDir = path.resolve('audit-output/mariadb-live/two-deployment-canary');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'two-deployment-canary-report.json'), JSON.stringify(report, null, 2));

  return report;
}

if (require.main === module) {
  const phase = process.argv[2];
  const baseTimeArg = process.argv[3] ? Number(process.argv[3]) : Date.now();

  if (phase === 'deploy-a') {
    runDeploymentA(baseTimeArg)
      .then(res => {
        console.log('DEPLOY_A_SUCCESS_BASE_TIME:' + res.baseTime);
        process.exit(0);
      })
      .catch(err => {
        console.error('DEPLOY_A_ERROR:', err);
        process.exit(1);
      });
  } else if (phase === 'deploy-b') {
    runDeploymentB(baseTimeArg)
      .then(res => {
        console.log('DEPLOY_B_SUCCESS:', JSON.stringify(res, null, 2));
        process.exit(0);
      })
      .catch(err => {
        console.error('DEPLOY_B_ERROR:', err);
        process.exit(1);
      });
  } else {
    const bt = Date.now();
    runDeploymentA(bt)
      .then(() => runDeploymentB(bt))
      .then(res => {
        console.log('TWO_DEPLOYMENT_CANARY_SUCCESS:', JSON.stringify(res, null, 2));
        process.exit(0);
      })
      .catch(err => {
        console.error('CANARY_ERROR:', err);
        process.exit(1);
      });
  }
}

module.exports = { runDeploymentA, runDeploymentB };
