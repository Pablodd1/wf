'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const {
  resolveMariaDbTransport,
  buildStagingRecord
} = require('./run-full-private-capture.cjs');
const {
  fetchKeysetBatch,
  sha256
} = require('./full-capture-preflight.cjs');

async function rpc(supabaseUrl, supabaseKey, functionName, params) {
  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + functionName;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey
    },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('RPC ' + functionName + ' failed (' + res.status + '): ' + txt);
  }
  return await res.json();
}

async function runLive250RowCanary(options = {}) {
  const env = options.env || process.env;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  // 1. Verify Main Checkpoint Before
  const mainRunKey = 'full-capture-auctions-1788028958313';
  const cpBefore = await rpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', { p_run_key: mainRunKey });

  // 2. Connect to MariaDB via Pinned TLS
  const transport = resolveMariaDbTransport(env);
  const conn = await mysql.createConnection({
    host: env.MARIADB_HOST,
    port: Number(env.MARIADB_PORT || 3306),
    user: env.MARIADB_USER,
    password: env.MARIADB_PASSWORD,
    database: env.MARIADB_DATABASE || 'thecollective_inventory',
    ssl: transport.ssl
  });

  const lastCreatedOn = cpBefore.last_created_on;
  const lastSourceId = cpBefore.last_source_id;

  // 3. Keyset fetch the exact next 250 rows from MariaDB after the cursor
  const rawRows = await fetchKeysetBatch(conn, {
    sourceTable: 'auctions',
    upperBoundary: cpBefore.frozen_upper_boundary || { created_on: '2026-08-29T14:42:32.000Z', id: 'f1bdf67a-3723-41c6-a1e3-35c5ca9138b0' },
    lastCreatedOn,
    lastSourceId,
    batchSize: 250
  });

  await conn.end();

  if (rawRows.length !== 250) {
    throw new Error('Expected 250 rows from MariaDB, got ' + rawRows.length);
  }

  // 4. Transform rows into canary namespace staging records
  const canaryManifest = {
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: 'auctions_canary',
    contract: 'wf-mariadb-private-raw-staging-v1'
  };

  const stagingRecords = rawRows.map(r => buildStagingRecord(r, canaryManifest));
  const canaryRunKey = options.runKey || 'canary-live-next-250rows-' + Date.now();
  const batchToken = sha256(canaryRunKey + ':0:' + stagingRecords[0].source_id + ':' + stagingRecords[stagingRecords.length - 1].source_id);

  // 5. Ingest into private Supabase raw staging under canary namespace
  const batchResult = await rpc(supabaseUrl, supabaseKey, 'ingest_mariadb_private_raw_batch', {
    p_run_key: canaryRunKey,
    p_batch_token: batchToken,
    p_contract: 'wf-mariadb-private-raw-staging-v1',
    p_expected_last_created_on: '',
    p_expected_last_source_id: '',
    p_next_last_created_on: stagingRecords[stagingRecords.length - 1].source_created_on,
    p_next_last_source_id: stagingRecords[stagingRecords.length - 1].source_id,
    p_records: stagingRecords,
    p_frozen_upper_boundary: { upper_boundary: { id: stagingRecords[stagingRecords.length - 1].source_id, created_on: stagingRecords[stagingRecords.length - 1].source_created_on } },
    p_manifest_sha256: 'manifest-hash-live-250row-canary'
  });

  // 6. Query error ledger for the canary run
  const errors = await rpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_errors', { p_run_key: canaryRunKey });

  // 7. Verify Main Checkpoint After
  const cpAfter = await rpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', { p_run_key: mainRunKey });

  const isMainCheckpointUnchanged = (
    cpBefore.input_rows === cpAfter.input_rows &&
    cpBefore.newly_staged_rows === cpAfter.newly_staged_rows &&
    cpBefore.already_staged_identical_rows === cpAfter.already_staged_identical_rows &&
    cpBefore.capture_error_rows === cpAfter.capture_error_rows &&
    cpBefore.last_created_on === cpAfter.last_created_on &&
    cpBefore.last_source_id === cpAfter.last_source_id &&
    cpBefore.manifest_sha256 === cpAfter.manifest_sha256 &&
    cpBefore.status === cpAfter.status
  );

  const report = {
    contract: 'wf-mariadb-private-raw-staging-v1',
    timestamp: new Date().toISOString(),
    canary_run_key: canaryRunKey,
    source_table: 'auctions_canary',
    reconciliation: {
      input_rows: batchResult.source_rows,
      newly_staged_rows: batchResult.newly_staged_rows,
      already_staged_identical_rows: batchResult.already_staged_identical_rows,
      capture_error_rows: batchResult.capture_error_rows,
      exact_reconciliation: (batchResult.newly_staged_rows + batchResult.already_staged_identical_rows + batchResult.capture_error_rows) === batchResult.source_rows
    },
    lossless_error_evidence: errors.map(err => ({
      source_id: err.source_id,
      source_created_on: err.source_created_on,
      source_hash: err.source_hash,
      classification: err.raw_payload?._lossless_raw_evidence?.classification || 'CAPTURE_ERROR_LOSSLESS_EVIDENCE',
      affected_fields: err.raw_payload?._lossless_raw_evidence?.affected_fields || [],
      null_byte_count: err.raw_payload?._lossless_raw_evidence?.null_byte_count || 0,
      character_positions: err.raw_payload?._lossless_raw_evidence?.character_positions || {},
      original_payload_base64_present: Boolean(err.raw_payload?._lossless_raw_evidence?.original_payload_base64),
      remediation_status: err.raw_payload?._lossless_raw_evidence?.remediation_status || 'CAPTURE_ERROR_LOSSLESS_EVIDENCE_PRESERVED',
      error_reason: err.error_reason
    })),
    main_checkpoint_verification: {
      main_run_key: mainRunKey,
      unchanged: isMainCheckpointUnchanged,
      input_rows: cpAfter.input_rows,
      last_source_id: cpAfter.last_source_id
    }
  };

  const outputDir = path.resolve('audit-output/mariadb-live');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'canary-250row-nullbyte-report.json'), JSON.stringify(report, null, 2));

  return report;
}

if (require.main === module) {
  runLive250RowCanary()
    .then(report => {
      console.log('LIVE 250-ROW CANARY COMPLETED:');
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(err => {
      console.error('Canary Error:', err);
      process.exit(1);
    });
}

module.exports = {
  runLive250RowCanary
};
