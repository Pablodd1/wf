'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
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

const WORKER_CONTRACT = 'wf-mariadb-continuous-shadow-v1';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function append(filePath, lines) {
  if (lines.length) fs.appendFileSync(filePath, lines.join(''));
}

function byteSize(filePath) {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

function prepareOutput(output, startAt) {
  fs.mkdirSync(output, { recursive: true });
  const paths = {
    raw: path.join(output, 'raw-records.jsonl'),
    proposals: path.join(output, 'normalization-proposals.jsonl'),
    collectionErrors: path.join(output, 'collection-errors.csv'),
    normalizationErrors: path.join(output, 'normalization-errors.csv'),
    checkpoint: path.join(output, 'checkpoint.json'),
    status: path.join(output, 'status.json'),
  };
  let state;
  if (fs.existsSync(paths.checkpoint)) {
    state = JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
    if (state.contract !== WORKER_CONTRACT || state.source_contract !== CONTRACT) {
      throw new Error('Continuous worker checkpoint contract mismatch');
    }
    for (const [key, bytes] of Object.entries(state.file_bytes || {})) {
      if (paths[key] && fs.existsSync(paths[key])) fs.truncateSync(paths[key], bytes);
    }
  } else {
    if ([paths.raw, paths.proposals, paths.collectionErrors, paths.normalizationErrors]
      .some(filePath => fs.existsSync(filePath))) {
      throw new Error('Continuous output exists without a checkpoint');
    }
    fs.writeFileSync(paths.collectionErrors, 'source_id,error_name,error_message\n');
    fs.writeFileSync(paths.normalizationErrors, 'source_record_id,error_name,error_message\n');
    state = {
      contract: WORKER_CONTRACT,
      source_contract: CONTRACT,
      started_at: new Date().toISOString(),
      last_created_on: startAt,
      last_id: '',
      source_input_rows: 0,
      raw_output_rows: 0,
      collection_error_rows: 0,
      normalization_output_rows: 0,
      normalization_error_rows: 0,
      file_bytes: {},
    };
    state.file_bytes = {
      raw: 0,
      proposals: 0,
      collectionErrors: byteSize(paths.collectionErrors),
      normalizationErrors: byteSize(paths.normalizationErrors),
    };
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

async function run() {
  const required = ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing required secret environment variables: ${missing.join(', ')}`);
  const output = path.resolve(process.env.MARIADB_CONTINUOUS_OUTPUT || '/data/mariadb-live');
  const startAt = process.env.MARIADB_CONTINUOUS_START_AT || '1970-01-01 00:00:00';
  const batchSize = boundedInteger(process.env.MARIADB_CONTINUOUS_BATCH_SIZE, 1000, 10, 5000, 'MARIADB_CONTINUOUS_BATCH_SIZE');
  const pollMs = boundedInteger(process.env.MARIADB_CONTINUOUS_POLL_MS, 30000, 5000, 3600000, 'MARIADB_CONTINUOUS_POLL_MS');
  const exitWhenCaughtUp = process.env.MARIADB_CONTINUOUS_EXIT_WHEN_CAUGHT_UP === 'true';
  const { paths, state } = prepareOutput(output, startAt);
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
        const report = {
          contract: WORKER_CONTRACT,
          checked_at: new Date().toISOString(),
          status: 'CAUGHT_UP',
          ...state,
          ...reconciliation(state),
          production_writes: 0,
          watch_records_writes: 0,
        };
        atomicJson(paths.status, report);
        process.stdout.write(`${JSON.stringify({ event: 'mariadb_continuous_idle', ...report })}\n`);
        if (exitWhenCaughtUp) break;
        await sleep(pollMs);
        continue;
      }
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
      append(paths.raw, rawLines);
      append(paths.proposals, proposalLines);
      append(paths.collectionErrors, collectionErrorLines);
      append(paths.normalizationErrors, normalizationErrorLines);
      state.file_bytes = {
        raw: byteSize(paths.raw),
        proposals: byteSize(paths.proposals),
        collectionErrors: byteSize(paths.collectionErrors),
        normalizationErrors: byteSize(paths.normalizationErrors),
      };
      state.updated_at = new Date().toISOString();
      const reconciled = reconciliation(state);
      atomicJson(paths.checkpoint, state);
      atomicJson(paths.status, {
        contract: WORKER_CONTRACT,
        checked_at: state.updated_at,
        status: reconciled.source_reconciled && reconciled.normalization_reconciled ? 'PROCESSING' : 'ERROR',
        ...state,
        ...reconciled,
        production_writes: 0,
        watch_records_writes: 0,
      });
      process.stdout.write(`${JSON.stringify({ event: 'mariadb_continuous_checkpoint', batch_rows: rows.length, ...state, ...reconciled })}\n`);
      if (!reconciled.source_reconciled || !reconciled.normalization_reconciled) {
        throw new Error('Continuous worker reconciliation failed');
      }
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_continuous_error', status: 'ERROR', declared_errors: ['WORKER_EXECUTION_FAILED'], error_name: error.name || 'Error', error_message: error.message || String(error), production_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { prepareOutput, reconciliation, run };
