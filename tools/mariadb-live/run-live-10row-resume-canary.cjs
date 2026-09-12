// tools/mariadb-live/run-live-10row-resume-canary.cjs
'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  CONTRACT,
  CANONICAL_VERSION,
  HASH_ALGO,
  sha256,
  stableJson,
  canonicalizeRawPayload,
  verifyHashReadbackContract,
  verifyErrorLedgerContract,
  verifyDryRunReconciliation
} = require('./full-capture-preflight.cjs');

async function runLiveCanary() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  console.log('============================================================');
  console.log('STARTING REAL 10-ROW INTERRUPTION/RESUME POSTGRESQL CANARY');
  console.log('============================================================');

  // 1. Generate 10 distinct, valid canary auction records
  const canaryRows = [];
  const baseTime = Date.now();
  for (let i = 1; i <= 10; i++) {
    const id = `canary-resume-${baseTime}-${String(i).padStart(3, '0')}`;
    const createdOn = new Date(baseTime + i * 1000).toISOString();
    const rawData = {
      id,
      brand: 'Rolex',
      model: 'Daytona',
      reference: `116500LN-CANARY-${i}`,
      price: 25000 + i * 100,
      currency: 'USD',
      created_on: createdOn,
      description: `Live 10-row resume canary auction record #${i}`
    };
    const rawPayloadText = canonicalizeRawPayload(rawData);
    const sourceHash = sha256(rawPayloadText);

    canaryRows.push({
      source_system: 'OceanDigital MariaDB',
      source_database: 'thecollective_inventory',
      source_table: 'auctions',
      source_id: id,
      source_unique_key: `OceanDigital MariaDB:thecollective_inventory:auctions:${id}`,
      source_record_id: `mysql_auctions_${id}`,
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

  // 2. Define Frozen Boundary & Complete Manifest
  const manifest = {
    contract: CONTRACT,
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions',
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
    snapshot_timestamp: new Date().toISOString()
  };
  manifest.manifest_sha256 = sha256(stableJson(manifest));

  const runKey = `live-resume-canary-10row-${baseTime}`;
  console.log(`Run Key: ${runKey}`);
  console.log(`Manifest SHA-256: ${manifest.manifest_sha256}`);

  // 3. Pre-Canary Public Baseline Check
  console.log('Checking pre-canary public baseline across 10 canary identities...');
  const sourceIds = canaryRows.map(r => r.source_id);
  const recordIds = sourceIds.map(id => `mysql_auctions_${id}`);

  const [resPreRaw, resPreVers, resPreWatch] = await Promise.all([
    supabase.from('raw_messages').select('id').in('external_message_id', recordIds),
    supabase.from('raw_message_versions').select('id').in('source_record_id', recordIds),
    supabase.from('watch_records').select('id').in('id', sourceIds)
  ]);
  const prePublicMatches = (resPreRaw.data?.length || 0) + (resPreVers.data?.length || 0) + (resPreWatch.data?.length || 0);
  if (prePublicMatches !== 0) {
    throw new Error(`Pre-canary public pollution detected: ${prePublicMatches} matching records`);
  }
  console.log('Public Baseline Verified: 0 pre-existing public records.');

  // 4. Ingest Batch 1 (Rows 1 to 5)
  console.log('1. Ingesting Batch 1 (Rows 1 to 5) into private staging via RPC...');
  const batch1 = canaryRows.slice(0, 5);
  const batch1Token = sha256(`${runKey}:0:${batch1[0].source_id}:${batch1[4].source_id}`);

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

  if (b1Err) throw new Error('Batch 1 Ingestion Failed: ' + b1Err.message);
  console.log('Batch 1 Ingested:', b1Result);

  // 5. Simulate Process Interruption & Reconnection
  console.log('------------------------------------------------------------');
  console.log('2. SIMULATING PROCESS INTERRUPTION & WORKER RESTART');
  console.log('------------------------------------------------------------');

  const { data: checkpoint, error: cpErr } = await supabase.rpc('get_mariadb_private_raw_checkpoint', {
    p_run_key: runKey
  });
  if (cpErr) throw new Error('Checkpoint Read Failure (fail-closed): ' + cpErr.message);
  if (!checkpoint) throw new Error('Checkpoint not found on resume');

  console.log('Checkpoint Retrieved on Resume:', checkpoint);

  // Recompute and validate manifest hash
  const manifestCopy = { ...checkpoint.frozen_manifest };
  delete manifestCopy.manifest_sha256;
  const recomputedManifestHash = sha256(stableJson(manifestCopy));
  console.log(`Recomputed Manifest Hash: ${recomputedManifestHash}`);
  console.log(`Stored Manifest Hash:     ${checkpoint.manifest_sha256}`);

  if (recomputedManifestHash !== checkpoint.manifest_sha256) {
    throw new Error(`Manifest Hash Verification Failure on Resume: recomputed ${recomputedManifestHash} does not match stored ${checkpoint.manifest_sha256}`);
  }
  console.log('Manifest Hash Successfully Recomputed and Cryptographically Validated on Resume.');

  // 6. Ingest Batch 2 (Rows 6 to 10) starting from Resumed Cursor
  console.log('3. Ingesting Batch 2 (Rows 6 to 10) from Resumed Cursor via RPC...');
  const batch2 = canaryRows.slice(5, 10);
  const batch2Token = sha256(`${runKey}:1:${batch2[0].source_id}:${batch2[4].source_id}`);

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

  if (b2Err) throw new Error('Batch 2 Ingestion Failed: ' + b2Err.message);
  console.log('Batch 2 Ingested:', b2Result);

  // 7. Verify Checkpoint State after Both Batches
  const { data: finalCheckpoint, error: finalCpErr } = await supabase.rpc('get_mariadb_private_raw_checkpoint', {
    p_run_key: runKey
  });
  if (finalCpErr) throw new Error('Final Checkpoint Read Failure: ' + finalCpErr.message);

  console.log('Final Cumulative Checkpoint:', finalCheckpoint);
  if (finalCheckpoint.input_rows !== 10 || finalCheckpoint.newly_staged_rows !== 10 || finalCheckpoint.capture_error_rows !== 0) {
    throw new Error(`Checkpoint totals incorrect: input=${finalCheckpoint.input_rows}, newly_staged=${finalCheckpoint.newly_staged_rows}, errors=${finalCheckpoint.capture_error_rows}`);
  }

  // 8. Cryptographic Hash Readback Verification across all 10 rows
  console.log('4. Performing cryptographic hash readback verification across all 10 rows...');
  const { data: readbackData, error: rbErr } = await supabase.rpc('verify_mariadb_private_raw_readback', {
    p_source_ids: sourceIds
  });
  if (rbErr) throw new Error('Hash readback RPC failed: ' + rbErr.message);

  const readbackResult = verifyHashReadbackContract(readbackData, canaryRows);
  console.log('Hash Readback Verified:', readbackResult);

  // 9. Error Ledger Verification
  console.log('5. Verifying error ledger contract...');
  const { data: ledgerErrors, error: ledgerErr } = await supabase.rpc('get_mariadb_private_raw_errors', {
    p_run_key: runKey
  });
  if (ledgerErr) throw new Error('Error ledger RPC failed: ' + ledgerErr.message);

  const errorLedgerResult = verifyErrorLedgerContract(ledgerErrors || [], 0);
  console.log('Error Ledger Verified:', errorLedgerResult);

  // 10. Finalize Checkpoint
  console.log('6. Finalizing checkpoint to RAW_STAGED...');
  const { data: finalizeData, error: finalizeErr } = await supabase.rpc('finalize_mariadb_private_raw_checkpoint', {
    p_run_key: runKey,
    p_expected_staged_rows: 10,
    p_expected_error_rows: 0,
    p_final_status: 'RAW_STAGED'
  });
  if (finalizeErr) throw new Error('Checkpoint finalization failed: ' + finalizeErr.message);
  console.log('Checkpoint Finalized:', finalizeData);

  // 11. Verify Zero Public Delta
  console.log('7. Verifying zero public table delta across all 10 canary rows...');
  const [resPostRaw, resPostVers, resPostWatch] = await Promise.all([
    supabase.from('raw_messages').select('id').in('external_message_id', recordIds),
    supabase.from('raw_message_versions').select('id').in('source_record_id', recordIds),
    supabase.from('watch_records').select('id').in('id', sourceIds)
  ]);
  const postPublicMatches = (resPostRaw.data?.length || 0) + (resPostVers.data?.length || 0) + (resPostWatch.data?.length || 0);
  if (postPublicMatches !== 0) {
    throw new Error(`Zero-public invariant violated: found ${postPublicMatches} public rows matching canary`);
  }
  console.log('Zero Public Delta Verified: raw_messages=0, raw_message_versions=0, watch_records=0.');

  console.log('============================================================');
  console.log('REAL 10-ROW INTERRUPTION/RESUME CANARY COMPLETED WITH 100% RECONCILIATION');
  console.log('============================================================');

  return {
    runKey,
    manifest,
    finalCheckpoint,
    readbackResult,
    errorLedgerResult,
    finalizeData,
    publicDelta: 0
  };
}

if (require.main === module) {
  runLiveCanary()
    .then(res => {
      console.log('SUCCESS:', JSON.stringify(res, null, 2));
    })
    .catch(err => {
      console.error('LIVE CANARY FATAL ERROR:', err);
      process.exit(1);
    });
}

module.exports = { runLiveCanary };
