'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const {
  CONTRACT,
  assertReadOnlyGrants,
  atomicJson,
  boundedInteger,
  csv,
  sourceRecord,
} = require('./lib.cjs');

const SELECT_COLUMNS = [
  'id', 'open_unique_key', 'created_on', 'updated_on', 'origin', 'type', 'status',
  'is_bundle', 'category_id', 'company_id', 'from_number', 'from_name', 'region',
  'title', 'description', 'brand', 'model', 'reference', 'normalized_reference',
  'dial_color', 'condition_id', 'box', 'papers', 'price', 'reserve_price',
  'front_image',
].join(',');

function config(env = process.env) {
  const required = ['MARIADB_HOST', 'MARIADB_USER', 'MARIADB_PASSWORD'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required secret environment variables: ${missing.join(', ')}`);
  const maxRows = boundedInteger(env.MARIADB_IMPORT_MAX_ROWS, 1_000, 1, 10_000_000, 'MARIADB_IMPORT_MAX_ROWS');
  if (maxRows > 100_000 && env.MARIADB_IMPORT_ALLOW_FULL !== 'true') {
    throw new Error('Set MARIADB_IMPORT_ALLOW_FULL=true for runs above 100,000 rows');
  }
  return {
    host: env.MARIADB_HOST,
    port: boundedInteger(env.MARIADB_PORT, 3306, 1, 65535, 'MARIADB_PORT'),
    user: env.MARIADB_USER,
    password: env.MARIADB_PASSWORD,
    database: env.MARIADB_DATABASE || 'thecollective_inventory',
    batchSize: boundedInteger(env.MARIADB_IMPORT_BATCH_SIZE, 1_000, 10, 5_000, 'MARIADB_IMPORT_BATCH_SIZE'),
    maxRows,
    output: path.resolve(env.MARIADB_IMPORT_OUTPUT || 'audit-output/mariadb-live/canary'),
    startAt: env.MARIADB_IMPORT_START_AT || '1970-01-01 00:00:00',
  };
}

function prepareOutput(runConfig) {
  fs.mkdirSync(runConfig.output, { recursive: true });
  const paths = {
    records: path.join(runConfig.output, 'raw-records.jsonl'),
    errors: path.join(runConfig.output, 'errors.csv'),
    checkpoint: path.join(runConfig.output, 'checkpoint.json'),
    manifest: path.join(runConfig.output, 'run-manifest.json'),
    reconciliation: path.join(runConfig.output, 'reconciliation.json'),
  };
  let checkpoint = {
    contract: CONTRACT,
    complete: false,
    input_rows: 0,
    output_rows: 0,
    error_rows: 0,
    last_created_on: runConfig.startAt,
    last_id: '',
    record_bytes: 0,
    error_bytes: 0,
    started_at: new Date().toISOString(),
  };
  if (fs.existsSync(paths.checkpoint)) {
    checkpoint = JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
    if (checkpoint.contract !== CONTRACT) throw new Error('Checkpoint contract mismatch');
    if (checkpoint.complete) throw new Error('Collection checkpoint is already complete');
    if (fs.existsSync(paths.records)) fs.truncateSync(paths.records, checkpoint.record_bytes);
    if (fs.existsSync(paths.errors)) fs.truncateSync(paths.errors, checkpoint.error_bytes);
  } else {
    if (fs.existsSync(paths.records) || fs.existsSync(paths.errors)) {
      throw new Error('Output exists without a checkpoint; choose a new output directory');
    }
    fs.writeFileSync(paths.errors, 'source_id,error_name,error_message\n');
    checkpoint.error_bytes = fs.statSync(paths.errors).size;
    atomicJson(paths.checkpoint, checkpoint);
  }
  return { paths, checkpoint };
}

async function run() {
  const runConfig = config();
  const { paths, checkpoint } = prepareOutput(runConfig);
  let db;
  let state = { ...checkpoint };
  let caughtUp = false;
  try {
    db = await mysql.createConnection({
      host: runConfig.host,
      port: runConfig.port,
      user: runConfig.user,
      password: runConfig.password,
      database: runConfig.database,
      connectTimeout: 10_000,
      dateStrings: true,
      charset: 'utf8mb4',
    });
    const [grantRows] = await db.query('SHOW GRANTS FOR CURRENT_USER()');
    assertReadOnlyGrants(grantRows.map(row => Object.values(row)[0]));
    await db.query('SET SESSION TRANSACTION READ ONLY');

    while (state.input_rows < runConfig.maxRows) {
      const limit = Math.min(runConfig.batchSize, runConfig.maxRows - state.input_rows);
      const [rows] = await db.execute(
        `SELECT ${SELECT_COLUMNS} FROM auctions
         WHERE created_on > ? OR (created_on = ? AND id > ?)
         ORDER BY created_on ASC, id ASC LIMIT ${limit}`,
        [state.last_created_on, state.last_created_on, state.last_id],
      );
      if (!rows.length) {
        caughtUp = true;
        break;
      }
      const recordLines = [];
      const errorLines = [];
      for (const row of rows) {
        state.input_rows += 1;
        state.last_created_on = row.created_on;
        state.last_id = String(row.id);
        try {
          recordLines.push(`${JSON.stringify(sourceRecord(row))}\n`);
          state.output_rows += 1;
        } catch (error) {
          errorLines.push(`${csv(row.id)},${csv(error.name || 'Error')},${csv(error.message || String(error))}\n`);
          state.error_rows += 1;
        }
      }
      if (recordLines.length) fs.appendFileSync(paths.records, recordLines.join(''));
      if (errorLines.length) fs.appendFileSync(paths.errors, errorLines.join(''));
      state.record_bytes = fs.existsSync(paths.records) ? fs.statSync(paths.records).size : 0;
      state.error_bytes = fs.statSync(paths.errors).size;
      state.updated_at = new Date().toISOString();
      atomicJson(paths.checkpoint, state);
      process.stdout.write(`${JSON.stringify({ event: 'mariadb_collection_checkpoint', input_rows: state.input_rows, output_rows: state.output_rows, error_rows: state.error_rows, last_created_on: state.last_created_on, last_id: state.last_id })}\n`);
      if (rows.length < limit) {
        caughtUp = true;
        break;
      }
    }
  } finally {
    if (db) await db.end();
  }

  const reconciled = state.input_rows === state.output_rows + state.error_rows;
  const reconciliation = {
    contract: CONTRACT,
    input_rows: state.input_rows,
    output_rows: state.output_rows,
    error_rows: state.error_rows,
    difference: state.input_rows - state.output_rows - state.error_rows,
    reconciled,
    production_writes: 0,
    watch_records_writes: 0,
  };
  atomicJson(paths.reconciliation, reconciliation);
  atomicJson(paths.manifest, {
    contract: CONTRACT,
    source: 'thecollective_inventory.auctions',
    source_mode: 'READ_ONLY',
    target: 'LOCAL_FILES',
    started_at: state.started_at,
    completed_at: new Date().toISOString(),
    bounded_max_rows: runConfig.maxRows,
    batch_size: runConfig.batchSize,
    caught_up: caughtUp,
    last_created_on: state.last_created_on,
    last_id: state.last_id,
    ...reconciliation,
  });
  state.complete = reconciled;
  state.caught_up = caughtUp;
  state.completed_at = new Date().toISOString();
  atomicJson(paths.checkpoint, state);
  if (!reconciled) throw new Error('MariaDB collection reconciliation failed');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_collection_complete', ...reconciliation, caught_up: caughtUp })}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_collection_error', error_name: error.name || 'Error', error_message: error.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { SELECT_COLUMNS, config, prepareOutput, run };
