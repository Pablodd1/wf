'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
const {
  resolveMariaDbTransport,
  buildStagingRecord
} = require('./run-full-private-capture.cjs');
const {
  fetchKeysetBatch,
  sha256
} = require('./full-capture-preflight.cjs');

const MAIN_RUN_KEY = 'full-capture-auctions-1788028958313';
const ORIGINAL_377750_BOUNDARY = Object.freeze({
  input_rows: 377750,
  last_created_on: '2025-11-19T02:27:57.000Z',
  last_source_id: '80da285d-8ef3-46a9-8f36-b89f93eff399'
});
const CANARY_SOURCE_TABLE = 'auctions_canary_after_377750_v1';

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

async function snapshotPublicLineage(supabase, sourceIds) {
  const snapshot = { raw_messages: 0, raw_message_versions: 0, watch_records: 0 };
  for (let offset = 0; offset < sourceIds.length; offset += 100) {
    const ids = sourceIds.slice(offset, offset + 100);
    const recordIds = ids.map(id => `mysql_auctions_${id}`);
    const [raw, versions, watches] = await Promise.all([
      supabase.from('raw_messages').select('id').in('external_message_id', recordIds),
      supabase.from('raw_message_versions').select('id').in('source_record_id', recordIds),
      supabase.from('watch_records').select('id').in('id', ids)
    ]);
    if (raw.error) throw new Error(`Public raw_messages audit failed: ${raw.error.message}`);
    if (versions.error) throw new Error(`Public raw_message_versions audit failed: ${versions.error.message}`);
    if (watches.error) throw new Error(`Public watch_records audit failed: ${watches.error.message}`);
    snapshot.raw_messages += raw.data?.length || 0;
    snapshot.raw_message_versions += versions.data?.length || 0;
    snapshot.watch_records += watches.data?.length || 0;
  }
  return snapshot;
}

async function runLive250RowCanary(options = {}) {
  const env = options.env || process.env;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided');
  }

  // 1. Read the main checkpoint for non-mutation proof. The canary source cursor is
  // deliberately pinned to the recorded 377,750-row boundary even if the main
  // checkpoint was advanced by an independently running deployment.
  const cpBefore = await rpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', { p_run_key: MAIN_RUN_KEY });

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

  const lastCreatedOn = ORIGINAL_377750_BOUNDARY.last_created_on;
  const lastSourceId = ORIGINAL_377750_BOUNDARY.last_source_id;

  // 3. Keyset fetch the exact next 250 rows from MariaDB after the cursor
  const rawRows = await fetchKeysetBatch(conn, {
    sourceTable: 'auctions',
    upperBoundary: cpBefore.frozen_upper_boundary,
    lastCreatedOn,
    lastSourceId,
    batchSize: 250
  });

  await conn.end();

  if (rawRows.length !== 250) {
    throw new Error('Expected 250 rows from MariaDB, got ' + rawRows.length);
  }

  const sourceIds = rawRows.map(row => String(row.id));
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const publicBefore = await snapshotPublicLineage(supabase, sourceIds);

  // 4. Transform rows into canary namespace staging records
  const canaryManifest = {
    source_system: 'OceanDigital MariaDB',
    source_database: 'thecollective_inventory',
    source_table: CANARY_SOURCE_TABLE,
    contract: 'wf-mariadb-private-raw-staging-v1'
  };

  const stagingRecords = rawRows.map(r => buildStagingRecord(r, canaryManifest));
  const canaryRunKey = options.runKey || 'canary-live-after-377750-' + Date.now();
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

  const publicAfter = await snapshotPublicLineage(supabase, sourceIds);

  // 7. Verify Main Checkpoint After
  const cpAfter = await rpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', { p_run_key: MAIN_RUN_KEY });

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
    source_table: CANARY_SOURCE_TABLE,
    source_cursor: {
      description: 'actual next 250 MariaDB rows after the recorded 377,750-row checkpoint boundary',
      ...ORIGINAL_377750_BOUNDARY,
      first_source_id: sourceIds[0],
      last_source_id: sourceIds[sourceIds.length - 1]
    },
    reconciliation: {
      input_rows: batchResult.source_rows,
      newly_staged_rows: batchResult.newly_staged_rows,
      already_staged_identical_rows: batchResult.already_staged_identical_rows,
      capture_error_rows: batchResult.capture_error_rows,
      exact_reconciliation: (batchResult.newly_staged_rows + batchResult.already_staged_identical_rows + batchResult.capture_error_rows) === batchResult.source_rows
    },
    lossless_error_evidence: errors.map(err => {
      const evidence = err.raw_payload?._lossless_raw_evidence || {};
      const decoded = evidence.original_payload_base64
        ? Buffer.from(evidence.original_payload_base64, 'base64').toString('utf8')
        : '';
      return {
        source_id: err.source_id,
        source_created_on: err.source_created_on,
        source_hash: err.source_hash,
        classification: evidence.classification || 'CAPTURE_ERROR_LOSSLESS_EVIDENCE',
        affected_fields: evidence.affected_fields || [],
        null_byte_count: evidence.null_byte_count || 0,
        character_positions: evidence.character_positions || {},
        original_payload_base64_present: Boolean(evidence.original_payload_base64),
        original_payload_reconstructs_to_source_hash: Boolean(decoded) && sha256(decoded) === err.source_hash,
        sanitized_transport_copy_present: Boolean(err.raw_payload_text),
        sanitized_transport_sha256: err.raw_payload_text ? sha256(err.raw_payload_text) : null,
        remediation_status: evidence.remediation_status || 'CAPTURE_ERROR_LOSSLESS_EVIDENCE_PRESERVED',
        error_reason: err.error_reason
      };
    }),
    public_impact_verification: {
      source_ids_checked: sourceIds.length,
      before: publicBefore,
      after: publicAfter,
      zero_public_delta: JSON.stringify(publicBefore) === JSON.stringify(publicAfter)
    },
    main_checkpoint_verification: {
      main_run_key: MAIN_RUN_KEY,
      unchanged: isMainCheckpointUnchanged,
      requested_historical_value: ORIGINAL_377750_BOUNDARY.input_rows,
      observed_before: {
        input_rows: cpBefore.input_rows,
        last_created_on: cpBefore.last_created_on,
        last_source_id: cpBefore.last_source_id,
        capture_error_rows: cpBefore.capture_error_rows,
        manifest_sha256: cpBefore.manifest_sha256
      },
      observed_after: {
        input_rows: cpAfter.input_rows,
        last_created_on: cpAfter.last_created_on,
        last_source_id: cpAfter.last_source_id,
        capture_error_rows: cpAfter.capture_error_rows,
        manifest_sha256: cpAfter.manifest_sha256
      }
    }
  };

  if (report.reconciliation.input_rows !== 250 ||
      report.reconciliation.newly_staged_rows !== 249 ||
      report.reconciliation.already_staged_identical_rows !== 0 ||
      report.reconciliation.capture_error_rows !== 1 ||
      !report.reconciliation.exact_reconciliation ||
      report.lossless_error_evidence.length !== 1 ||
      !report.lossless_error_evidence[0].original_payload_reconstructs_to_source_hash ||
      !report.public_impact_verification.zero_public_delta ||
      !report.main_checkpoint_verification.unchanged) {
    throw new Error(`Canary acceptance criteria failed: ${JSON.stringify(report)}`);
  }

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
