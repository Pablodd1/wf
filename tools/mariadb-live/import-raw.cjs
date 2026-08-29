'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CONTRACT, atomicJson, boundedInteger, readJsonLines, stableJson } = require('./lib.cjs');

const IMPORT_CONTRACT = 'wf-mariadb-raw-import-v1';

function config(env = process.env) {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MARIADB_RAW_IMPORT_INPUT'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    baseUrl: String(env.SUPABASE_URL).replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    input: path.resolve(env.MARIADB_RAW_IMPORT_INPUT),
    runKey: env.MARIADB_RAW_IMPORT_RUN_KEY || `mariadb-raw-${new Date().toISOString().slice(0, 10)}`,
    batchSize: boundedInteger(env.MARIADB_RAW_IMPORT_BATCH_SIZE, 200, 10, 500, 'MARIADB_RAW_IMPORT_BATCH_SIZE'),
    output: path.resolve(env.MARIADB_RAW_IMPORT_OUTPUT || 'audit-output/mariadb-live/raw-import'),
  };
}

function discoverInputFiles(input) {
  if (!fs.existsSync(input)) throw new Error(`Raw import input does not exist: ${input}`);
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const rawDirectory = path.join(input, 'raw');
  const candidates = fs.existsSync(rawDirectory)
    ? fs.readdirSync(rawDirectory).map(name => path.join(rawDirectory, name))
    : fs.readdirSync(input).map(name => path.join(input, name));
  const files = candidates
    .filter(file => fs.statSync(file).isFile() && /(?:\.jsonl|\.jsonl\.gz)$/i.test(file))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (!files.length) throw new Error(`No JSONL raw-evidence files were found under: ${input}`);
  return files;
}

function inputFingerprint(files) {
  return crypto.createHash('sha256')
    .update(stableJson(files.map(file => ({
      path: path.resolve(file),
      size: fs.statSync(file).size,
      mtime_ms: fs.statSync(file).mtimeMs,
    }))))
    .digest('hex');
}

function containsPostgresNul(value) {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsPostgresNul);
  if (value && typeof value === 'object') return Object.values(value).some(containsPostgresNul);
  return false;
}

function replacePostgresNul(value) {
  if (typeof value === 'string') return value.replaceAll('\u0000', '\\u0000');
  if (Array.isArray(value)) return value.map(replacePostgresNul);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replacePostgresNul(child)]));
  }
  return value;
}

function postgresSafeRecord(record, originalJsonLine) {
  if (!containsPostgresNul(record)) return record;
  if (Object.hasOwn(record, 'wf_transport_evidence')) {
    throw new Error(`Source record ${record.source_record_id || 'unknown'} collides with wf_transport_evidence`);
  }
  const original = String(originalJsonLine);
  return {
    ...replacePostgresNul(record),
    wf_transport_evidence: {
      version: 1,
      reason: 'POSTGRES_TEXT_NUL',
      original_json_encoding: 'base64-json-utf8',
      original_json_sha256: crypto.createHash('sha256').update(original, 'utf8').digest('hex'),
      original_json_utf8_base64: Buffer.from(original, 'utf8').toString('base64'),
    },
  };
}

function prepareOutput(runConfig, files) {
  fs.mkdirSync(runConfig.output, { recursive: true });
  const paths = {
    checkpoint: path.join(runConfig.output, 'checkpoint.json'),
    reconciliation: path.join(runConfig.output, 'reconciliation.json'),
  };
  const fingerprint = inputFingerprint(files);
  let checkpoint = {
    contract: IMPORT_CONTRACT,
    source_contract: CONTRACT,
    input_fingerprint: fingerprint,
    run_key: runConfig.runKey,
    file_index: 0,
    line_index: 0,
    batch_sequence: 0,
    input_rows: 0,
    envelope_rows_inserted: 0,
    version_rows_inserted: 0,
    version_rows_existing: 0,
    transport_encoded_rows: 0,
    error_rows: 0,
    last_created_on: '1970-01-01 00:00:00',
    last_source_id: '',
    complete: false,
    started_at: new Date().toISOString(),
  };
  if (fs.existsSync(paths.checkpoint)) {
    checkpoint = JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
    if (checkpoint.contract !== IMPORT_CONTRACT
      || checkpoint.source_contract !== CONTRACT
      || checkpoint.input_fingerprint !== fingerprint
      || checkpoint.run_key !== runConfig.runKey) {
      throw new Error('Raw-import checkpoint does not match this immutable input/run configuration');
    }
    if (checkpoint.complete) throw new Error('Raw-import checkpoint is already complete');
  } else {
    atomicJson(paths.checkpoint, checkpoint);
  }
  return { paths, checkpoint };
}

function compareCursor(previous, record) {
  const createdOn = String(record.source_created_on || '');
  const sourceId = String(record.source_id || '');
  if (!createdOn || !sourceId) throw new Error('Every raw record needs source_created_on and source_id');
  if (createdOn < previous.last_created_on
    || (createdOn === previous.last_created_on && sourceId <= previous.last_source_id)) {
    throw new Error(`Raw input keyset is not strictly increasing at ${record.source_record_id}`);
  }
  return { createdOn, sourceId };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function rpc(runConfig, functionName, body, fetchImpl = fetch, retryOptions = {}) {
  const maxAttempts = boundedInteger(retryOptions.maxAttempts, 6, 1, 10, 'RPC_MAX_ATTEMPTS');
  const baseDelayMs = boundedInteger(retryOptions.baseDelayMs, 500, 0, 30000, 'RPC_BASE_DELAY_MS');
  const sleep = retryOptions.sleep || wait;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${runConfig.baseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: runConfig.key,
          Authorization: `Bearer ${runConfig.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : null;

      const error = new Error(`${functionName} failed (${response.status}): ${text.slice(0, 500)}`);
      if (!isTransientStatus(response.status) || attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      if (error.message?.startsWith(`${functionName} failed (`) || attempt === maxAttempts) throw error;
      lastError = error;
    }

    const delay = Math.min(baseDelayMs * (2 ** (attempt - 1)), 15000);
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_raw_import_retry',
      function_name: functionName,
      attempt,
      next_attempt: attempt + 1,
      delay_ms: delay,
      error_name: lastError?.name || 'Error',
      error_message: lastError?.message || String(lastError),
    })}\n`);
    await sleep(delay);
  }
  throw lastError;
}

async function submitBatch(runConfig, checkpoint, records, fetchImpl = fetch) {
  if (!records.length) return null;
  const previous = {
    last_created_on: checkpoint.last_created_on,
    last_source_id: checkpoint.last_source_id,
  };
  let cursor = previous;
  for (const record of records) {
    if (record.contract !== CONTRACT) throw new Error(`Unsupported source contract: ${record.contract}`);
    cursor = compareCursor(cursor, record);
    cursor = { last_created_on: cursor.createdOn, last_source_id: cursor.sourceId };
  }
  const batchToken = crypto.createHash('sha256')
    .update(stableJson({
      run_key: runConfig.runKey,
      sequence: checkpoint.batch_sequence + 1,
      hashes: records.map(record => record.raw_sha256),
    }))
    .digest('hex');
  const result = await rpc(runConfig, 'ingest_mariadb_raw_batch', {
    p_run_key: runConfig.runKey,
    p_batch_token: batchToken,
    p_contract: CONTRACT,
    p_expected_last_created_on: previous.last_created_on,
    p_expected_last_source_id: previous.last_source_id,
    p_next_last_created_on: cursor.last_created_on,
    p_next_last_source_id: cursor.last_source_id,
    p_records: records,
  }, fetchImpl);
  if (Number(result?.input_rows) !== records.length
    || Number(result?.version_rows_inserted || 0) + Number(result?.version_rows_existing || 0) !== records.length
    || Number(result?.error_rows || 0) !== 0) {
    throw new Error('Raw-import RPC counts do not reconcile with the submitted batch');
  }
  return result;
}

async function loadRemoteCheckpoint(runConfig, fetchImpl = fetch) {
  const params = new URLSearchParams({
    run_key: `eq.${runConfig.runKey}`,
    select: [
      'run_key',
      'status',
      'input_rows',
      'envelope_rows_inserted',
      'version_rows_inserted',
      'version_rows_existing',
      'error_rows',
      'last_created_on',
      'last_source_id',
      'started_at',
      'updated_at',
    ].join(','),
    limit: '1',
  });
  const response = await fetchImpl(`${runConfig.baseUrl}/rest/v1/mariadb_raw_import_checkpoints?${params}`, {
    method: 'GET',
    headers: {
      apikey: runConfig.key,
      Authorization: `Bearer ${runConfig.key}`,
    },
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Remote raw-import checkpoint query failed (${response.status}): ${text.slice(0, 500)}`);
  const rows = text ? JSON.parse(text) : [];
  return rows[0] || null;
}

async function locateRemoteCursor(files, localCheckpoint, remoteCheckpoint) {
  const targetRows = Number(remoteCheckpoint.input_rows);
  let inputRows = 0;
  let target = null;
  let recoveredTransportRows = 0;

  outer: for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    let lineIndex = 0;
    for await (const line of readJsonLines(files[fileIndex])) {
      lineIndex += 1;
      if (!line.trim()) continue;
      inputRows += 1;
      if (inputRows > Number(localCheckpoint.input_rows)) {
        const record = JSON.parse(line);
        if (postgresSafeRecord(record, line).wf_transport_evidence) recoveredTransportRows += 1;
        if (inputRows === targetRows) {
          target = { fileIndex, lineIndex, record };
          break outer;
        }
      }
    }
  }
  if (!target) throw new Error(`Immutable input ended before remote checkpoint row ${targetRows}`);
  return { ...target, recoveredTransportRows };
}

async function reconcileRemoteCheckpoint(runConfig, files, prepared, fetchImpl = fetch) {
  const local = prepared.checkpoint;
  if (Number(local.input_rows) === 0 || local.complete) return { reconciled: false, reason: 'REMOTE_CHECK_NOT_REQUIRED' };
  const remote = await loadRemoteCheckpoint(runConfig, fetchImpl);
  if (!remote) throw new Error(`Remote checkpoint is missing for resumed run ${runConfig.runKey}`);

  const localRows = Number(local.input_rows);
  const remoteRows = Number(remote.input_rows);
  if (!Number.isSafeInteger(remoteRows) || remoteRows < localRows) {
    throw new Error(`Remote checkpoint row count ${remoteRows} is behind local checkpoint ${localRows}`);
  }
  if (Number(remote.error_rows || 0) !== 0
    || Number(remote.version_rows_inserted || 0) + Number(remote.version_rows_existing || 0) !== remoteRows) {
    throw new Error('Remote checkpoint does not reconcile cleanly');
  }
  if (remoteRows === localRows) {
    if (String(remote.last_created_on) !== String(local.last_created_on)
      || String(remote.last_source_id) !== String(local.last_source_id)) {
      throw new Error('Equal local and remote checkpoint counts have conflicting cursors');
    }
    return { reconciled: false, reason: 'CHECKPOINTS_ALREADY_EQUAL' };
  }

  const recoveredRows = remoteRows - localRows;
  if (recoveredRows % runConfig.batchSize !== 0) {
    throw new Error(`Remote checkpoint lead ${recoveredRows} is not aligned to batch size ${runConfig.batchSize}`);
  }
  const located = await locateRemoteCursor(files, local, remote);
  if (String(located.record.source_created_on) !== String(remote.last_created_on)
    || String(located.record.source_id) !== String(remote.last_source_id)) {
    throw new Error('Remote checkpoint cursor does not match the immutable input row');
  }

  const repaired = {
    ...local,
    file_index: located.fileIndex,
    line_index: located.lineIndex,
    batch_sequence: Number(local.batch_sequence) + (recoveredRows / runConfig.batchSize),
    input_rows: remoteRows,
    envelope_rows_inserted: Number(remote.envelope_rows_inserted || 0),
    version_rows_inserted: Number(remote.version_rows_inserted || 0),
    version_rows_existing: Number(remote.version_rows_existing || 0),
    transport_encoded_rows: Number(local.transport_encoded_rows || 0) + located.recoveredTransportRows,
    error_rows: Number(remote.error_rows || 0),
    last_created_on: remote.last_created_on,
    last_source_id: remote.last_source_id,
    started_at: remote.started_at || local.started_at,
    updated_at: remote.updated_at || new Date().toISOString(),
  };
  const backup = path.join(runConfig.output, `checkpoint.before-remote-reconcile-${localRows}.json`);
  if (!fs.existsSync(backup)) atomicJson(backup, local);
  atomicJson(path.join(runConfig.output, 'remote-checkpoint-reconciliation.json'), {
    contract: 'wf-mariadb-raw-import-checkpoint-reconciliation-v1',
    reconciled_at: new Date().toISOString(),
    local_input_rows_before: localRows,
    remote_input_rows: remoteRows,
    recovered_rows: recoveredRows,
    recovered_transport_encoded_rows: located.recoveredTransportRows,
    verified_last_created_on: remote.last_created_on,
    verified_last_source_id: remote.last_source_id,
    source_cursor_verified: true,
    production_writes: 0,
  });
  atomicJson(prepared.paths.checkpoint, repaired);
  prepared.checkpoint = repaired;
  return { reconciled: true, recoveredRows, repaired };
}

async function run(options = {}) {
  const runConfig = options.config || config();
  const fetchImpl = options.fetchImpl || fetch;
  const files = discoverInputFiles(runConfig.input);
  const prepared = prepareOutput(runConfig, files);
  await reconcileRemoteCheckpoint(runConfig, files, prepared, fetchImpl);
  const state = { ...prepared.checkpoint };
  state.transport_encoded_rows = Number(state.transport_encoded_rows || 0);
  let records = [];

  async function flush(nextFileIndex, nextLineIndex) {
    if (!records.length) return;
    const transportEncodedRows = records.filter(record => record.wf_transport_evidence).length;
    const result = await submitBatch(runConfig, state, records, fetchImpl);
    state.batch_sequence += 1;
    state.input_rows += Number(result.input_rows);
    state.envelope_rows_inserted += Number(result.envelope_rows_inserted || 0);
    state.version_rows_inserted += Number(result.version_rows_inserted || 0);
    state.version_rows_existing += Number(result.version_rows_existing || 0);
    state.transport_encoded_rows += transportEncodedRows;
    state.error_rows += Number(result.error_rows || 0);
    state.last_created_on = result.last_created_on;
    state.last_source_id = result.last_source_id;
    state.file_index = nextFileIndex;
    state.line_index = nextLineIndex;
    state.updated_at = new Date().toISOString();
    atomicJson(prepared.paths.checkpoint, state);
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_raw_import_checkpoint', ...result, batch_sequence: state.batch_sequence })}\n`);
    records = [];
  }

  for (let fileIndex = state.file_index; fileIndex < files.length; fileIndex += 1) {
    const lines = readJsonLines(files[fileIndex]);
    let lineIndex = 0;
    for await (const line of lines) {
      lineIndex += 1;
      if (fileIndex === state.file_index && lineIndex <= state.line_index) continue;
      if (!line.trim()) continue;
      records.push(postgresSafeRecord(JSON.parse(line), line));
      if (records.length >= runConfig.batchSize) await flush(fileIndex, lineIndex);
    }
    await flush(fileIndex + 1, 0);
    if (state.file_index <= fileIndex) {
      state.file_index = fileIndex + 1;
      state.line_index = 0;
      state.updated_at = new Date().toISOString();
      atomicJson(prepared.paths.checkpoint, state);
    }
  }

  const completion = await rpc(runConfig, 'complete_mariadb_raw_import', {
    p_run_key: runConfig.runKey,
    p_expected_rows: state.input_rows,
    p_expected_last_created_on: state.last_created_on,
    p_expected_last_source_id: state.last_source_id,
  }, fetchImpl);
  state.complete = completion?.status === 'RAW_COPY_COMPLETE';
  state.completed_at = new Date().toISOString();
  const reconciled = state.input_rows === state.version_rows_inserted + state.version_rows_existing
    && state.error_rows === 0
    && state.complete;
  const report = {
    ...state,
    reconciled,
    watch_records_writes: 0,
    normalization_writes: 0,
  };
  atomicJson(prepared.paths.reconciliation, report);
  atomicJson(prepared.paths.checkpoint, state);
  if (!reconciled) throw new Error('Completed raw import did not reconcile');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_raw_import_complete', ...report })}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_raw_import_error', error_name: error.name || 'Error', error_message: error.message || String(error), watch_records_writes: 0, normalization_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  IMPORT_CONTRACT,
  compareCursor,
  config,
  discoverInputFiles,
  inputFingerprint,
  isTransientStatus,
  loadRemoteCheckpoint,
  locateRemoteCursor,
  postgresSafeRecord,
  prepareOutput,
  reconcileRemoteCheckpoint,
  rpc,
  run,
  submitBatch,
};
