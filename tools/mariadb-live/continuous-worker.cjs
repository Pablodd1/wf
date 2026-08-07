'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const mysql = require('mysql2/promise');
console.log("CRITICAL: Worker paused for wf-mariadb-shadow-volume expansion.");
setInterval(() => {}, 60000);
return;
const { SELECT_COLUMNS } = require('./collect.cjs');
const {
  CONTRACT,
  assertReadOnlyGrants,
  atomicJson,
  boundedInteger,
  csv,
  sourceRecord,
} = require('./lib.cjs');
const { normalizeSourceRecord } = require('./normalize-local.cjs');

const WORKER_CONTRACT = 'wf-mariadb-continuous-shadow-v2';
const ACCOUNTABILITY_SOURCE_KEY = 'mariadb-thecollective-inventory-auctions';
const PARSER_VERSION = 'v4.2-line-condition';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countSeed(name) {
  return boundedInteger(process.env[name], 0, 0, Number.MAX_SAFE_INTEGER, name);
}

function atomicGzip(filePath, lines) {
  if (!lines.length) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, zlib.gzipSync(lines.join(''), { level: 6 }));
  fs.renameSync(temporary, filePath);
  return fs.statSync(filePath).size;
}

function prepareOutput(output, startAt, startId = '') {
  fs.mkdirSync(output, { recursive: true });
  const paths = {
    raw: path.join(output, 'raw'),
    proposals: path.join(output, 'proposals'),
    collectionErrors: path.join(output, 'collection-errors'),
    normalizationErrors: path.join(output, 'normalization-errors'),
    checkpoint: path.join(output, 'checkpoint.json'),
    status: path.join(output, 'status.json'),
  };
  let state;
  if (fs.existsSync(paths.checkpoint)) {
    state = JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
    if (state.contract !== WORKER_CONTRACT || state.source_contract !== CONTRACT) {
      throw new Error('Continuous worker checkpoint contract mismatch');
    }
  } else {
    state = {
      contract: WORKER_CONTRACT,
      source_contract: CONTRACT,
      started_at: new Date().toISOString(),
      last_created_on: startAt,
      last_id: startId,
      batch_sequence: 0,
      source_input_rows: countSeed('MARIADB_CONTINUOUS_SEED_SOURCE_ROWS'),
      raw_output_rows: countSeed('MARIADB_CONTINUOUS_SEED_RAW_ROWS'),
      collection_error_rows: countSeed('MARIADB_CONTINUOUS_SEED_COLLECTION_ERRORS'),
      normalization_output_rows: countSeed('MARIADB_CONTINUOUS_SEED_PROPOSAL_ROWS'),
      normalization_error_rows: countSeed('MARIADB_CONTINUOUS_SEED_NORMALIZATION_ERRORS'),
      compressed_bytes: 0,
    };
    const reconciled = reconciliation(state);
    if (!reconciled.source_reconciled || !reconciled.normalization_reconciled) {
      throw new Error('Continuous worker seed counts do not reconcile');
    }
    atomicJson(paths.checkpoint, state);
  }
  return { paths, state };
}

function reconciliation(state) {
  return {
    source_reconciled: state.source_input_rows === state.raw_output_rows + state.collection_error_rows,
    normalization_reconciled: state.raw_output_rows === state.normalization_output_rows + state.normalization_error_rows,
    source_difference: state.source_input_rows - state.raw_output_rows - state.collection_error_rows,
    normalization_difference: state.raw_output_rows - state.normalization_output_rows - state.normalization_error_rows,
  };
}

async function publishAccountability(report, fetchImpl = fetch) {
  if (process.env.PIPELINE_ACCOUNTABILITY_ENABLED !== 'true') {
    return { enabled: false, published: false };
  }
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !key) throw new Error('Pipeline accountability requires Supabase server credentials');

  const payload = {
    source_key: ACCOUNTABILITY_SOURCE_KEY,
    source_platform: 'mariadb',
    source_table: 'thecollective_inventory.auctions',
    pipeline_status: report.status,
    observed_at: report.checked_at,
    source_cursor: {
      created_on: report.last_created_on || null,
      source_id: report.last_id || null,
      batch_sequence: report.batch_sequence || 0,
    },
    parser_version: PARSER_VERSION,
    customer_record_writes: 0,
    details: {
      worker_contract: WORKER_CONTRACT,
      source_contract: CONTRACT,
      compressed_bytes: report.compressed_bytes || 0,
      declared_errors: report.declared_errors || [],
    },
    updated_at: report.checked_at,
  };
  if (Number.isFinite(Number(report.source_input_rows))) {
    Object.assign(payload, {
      source_input_rows: report.source_input_rows,
      immutable_raw_rows: report.raw_output_rows || 0,
      normalization_proposal_rows: report.normalization_output_rows || 0,
      collection_error_rows: report.collection_error_rows || 0,
      normalization_error_rows: report.normalization_error_rows || 0,
      source_reconciled: report.source_reconciled === true,
      normalization_reconciled: report.normalization_reconciled === true,
    });
  }

  const response = await fetchImpl(`${baseUrl}/rest/v1/source_pipeline_accountability?on_conflict=source_key`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Pipeline accountability publish failed (${response.status})`);
  return { enabled: true, published: true, published_at: report.checked_at };
}

async function withAccountability(report) {
  try {
    return { ...report, accountability: await publishAccountability(report) };
  } catch (error) {
    return {
      ...report,
      accountability: {
        enabled: true,
        published: false,
        error_code: 'ACCOUNTABILITY_PUBLISH_FAILED',
        error_message: String(error.message || error).slice(0, 300),
      },
    };
  }
}

function writeBatchSegments(paths, state, rows) {
  const rawLines = [];
  const proposalLines = [];
  const collectionErrorLines = [];
  const normalizationErrorLines = [];
  for (const row of rows) {
    state.source_input_rows += 1;
    state.last_created_on = row.created_on;
    state.last_id = String(row.id);
    let source;
    try {
      source = sourceRecord(row);
      rawLines.push(`${JSON.stringify(source)}\n`);
      state.raw_output_rows += 1;
    } catch (error) {
      collectionErrorLines.push(`${csv(row.id)},${csv(error.name || 'Error')},${csv(error.message || String(error))}\n`);
      state.collection_error_rows += 1;
      continue;
    }
    try {
      proposalLines.push(`${JSON.stringify(normalizeSourceRecord(source))}\n`);
      state.normalization_output_rows += 1;
    } catch (error) {
      normalizationErrorLines.push(`${csv(source.source_record_id)},${csv(error.name || 'Error')},${csv(error.message || String(error))}\n`);
      state.normalization_error_rows += 1;
    }
  }
  const sequence = String(state.batch_sequence + 1).padStart(9, '0');
  const cursorHash = crypto.createHash('sha256')
    .update(`${state.last_created_on}\n${state.last_id}`)
    .digest('hex').slice(0, 12);
  const name = `${sequence}-${cursorHash}.jsonl.gz`;
  const written = [
    atomicGzip(path.join(paths.raw, name), rawLines),
    atomicGzip(path.join(paths.proposals, name), proposalLines),
    atomicGzip(path.join(paths.collectionErrors, name), collectionErrorLines),
    atomicGzip(path.join(paths.normalizationErrors, name), normalizationErrorLines),
  ].filter(value => value !== null);
  state.batch_sequence += 1;
  state.compressed_bytes += written.reduce((sum, value) => sum + value, 0);
}

async function run() {
  const required = ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing required secret environment variables: ${missing.join(', ')}`);
  const output = path.resolve(process.env.MARIADB_CONTINUOUS_OUTPUT || '/data/mariadb-live-v2');
  const startAt = process.env.MARIADB_CONTINUOUS_START_AT || '1970-01-01 00:00:00';
  const startId = process.env.MARIADB_CONTINUOUS_START_ID || '';
  const batchSize = boundedInteger(process.env.MARIADB_CONTINUOUS_BATCH_SIZE, 1000, 10, 5000, 'MARIADB_CONTINUOUS_BATCH_SIZE');
  const pollMs = boundedInteger(process.env.MARIADB_CONTINUOUS_POLL_MS, 30000, 5000, 3600000, 'MARIADB_CONTINUOUS_POLL_MS');
  const exitWhenCaughtUp = process.env.MARIADB_CONTINUOUS_EXIT_WHEN_CAUGHT_UP === 'true';
  const { paths, state } = prepareOutput(output, startAt, startId);
  const db = await mysql.createConnection({
    host: process.env.MARIADB_HOST,
    port: boundedInteger(process.env.MARIADB_PORT, 3306, 1, 65535, 'MARIADB_PORT'),
    user: process.env.MARIADB_USER,
    password: process.env.MARIADB_PASSWORD,
    database: process.env.MARIADB_DATABASE || 'thecollective_inventory',
    connectTimeout: 10000,
    dateStrings: true,
    charset: 'utf8mb4',
  });
  try {
    const [grantRows] = await db.query('SHOW GRANTS FOR CURRENT_USER()');
    assertReadOnlyGrants(grantRows.map(row => Object.values(row)[0]));
    await db.query('SET SESSION TRANSACTION READ ONLY');
    for (;;) {
      const [rows] = await db.execute(
        `SELECT ${SELECT_COLUMNS} FROM auctions
         WHERE created_on > ? OR (created_on = ? AND id > ?)
         ORDER BY created_on ASC, id ASC LIMIT ${batchSize}`,
        [state.last_created_on, state.last_created_on, state.last_id],
      );
      if (!rows.length) {
        let report = {
          contract: WORKER_CONTRACT,
          checked_at: new Date().toISOString(),
          status: 'CAUGHT_UP',
          ...state,
          ...reconciliation(state),
          production_writes: 0,
          watch_records_writes: 0,
        };
        report = await withAccountability(report);
        atomicJson(paths.status, report);
        process.stdout.write(`${JSON.stringify({ event: 'mariadb_continuous_idle', ...report })}\n`);
        if (exitWhenCaughtUp) break;
        await sleep(pollMs);
        continue;
      }
      writeBatchSegments(paths, state, rows);
      state.updated_at = new Date().toISOString();
      const reconciled = reconciliation(state);
      atomicJson(paths.checkpoint, state);
      const statusReport = await withAccountability({
        contract: WORKER_CONTRACT,
        checked_at: state.updated_at,
        status: reconciled.source_reconciled && reconciled.normalization_reconciled ? 'PROCESSING' : 'ERROR',
        ...state,
        ...reconciled,
        production_writes: 0,
        watch_records_writes: 0,
      });
      atomicJson(paths.status, statusReport);
      process.stdout.write(`${JSON.stringify({ event: 'mariadb_continuous_checkpoint', batch_rows: rows.length, ...statusReport })}\n`);
      if (!reconciled.source_reconciled || !reconciled.normalization_reconciled) {
        throw new Error('Continuous worker reconciliation failed');
      }
    }
  } finally {
    await db.end();
  }
}

async function supervise() {
  let consecutiveFailures = 0;
  for (;;) {
    try {
      await run();
      return;
    } catch (error) {
      consecutiveFailures += 1;
      const retryDelayMs = Math.min(300000, 30000 * (2 ** Math.min(4, consecutiveFailures - 1)));
      const output = path.resolve(process.env.MARIADB_CONTINUOUS_OUTPUT || '/data/mariadb-live-v2');
      let report = {
        contract: WORKER_CONTRACT,
        checked_at: new Date().toISOString(),
        status: 'ERROR_RETRYING',
        declared_errors: ['WORKER_EXECUTION_FAILED'],
        error_name: error.name || 'Error',
        error_message: error.message || String(error),
        consecutive_failures: consecutiveFailures,
        retry_delay_ms: retryDelayMs,
        production_writes: 0,
        watch_records_writes: 0,
      };
      report = await withAccountability(report);
      atomicJson(path.join(output, 'status.json'), report);
      process.stderr.write(`${JSON.stringify({ event: 'mariadb_continuous_error', ...report })}\n`);
      await sleep(retryDelayMs);
    }
  }
}

if (require.main === module) {
  supervise().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_supervisor_error', status: 'FATAL', declared_errors: ['SUPERVISOR_FAILED'], error_name: error.name || 'Error', error_message: error.message || String(error), production_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { atomicGzip, prepareOutput, publishAccountability, reconciliation, run, supervise, withAccountability, writeBatchSegments };
