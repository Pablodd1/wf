'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { sha256, stableValue } = require('../../api/_lib/review-packets.cjs');
const { exclusiveReason, sanitizeProposal } = require('./snapshot-local.cjs');

const HARD_MAX_ROWS = 100_000;
const DEFAULT_OUTPUT = path.resolve('audit-output/review-packet-routing-export');
const SAFE_ID = /^[A-Za-z0-9:_./-]{1,300}$/;
const SAFE_VERSION = /^[A-Za-z0-9:_.-]{1,120}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,79}$/;

function boundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function appendDurable(filePath, rows) {
  if (!rows.length) return;
  const descriptor = fs.openSync(filePath, 'a');
  try {
    fs.writeFileSync(descriptor, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function required(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function validateRoute(row) {
  const sourceRecordId = String(row.source_record_id || '').trim();
  const normalizationVersion = String(row.normalization_version || '').trim();
  const reviewStatus = String(row.review_status || '').trim().toUpperCase();
  const reason = String(row.reason || '').trim().toUpperCase();
  if (!SAFE_ID.test(sourceRecordId)) return { error: 'source_record_id is invalid' };
  if (!SAFE_VERSION.test(normalizationVersion)) return { error: 'normalization_version is invalid' };
  if (reviewStatus !== 'PENDING') return { error: 'review_status must be PENDING' };
  if (!SAFE_REASON.test(reason)) return { error: 'reason must be one uppercase reason code' };
  return { sourceRecordId, normalizationVersion, reviewStatus, reason };
}

function inFilter(ids) {
  return `in.(${ids.map(id => `"${id.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')})`;
}

async function readRows(fetchImpl, baseUrl, key, table, idColumn, ids, select, timeoutMs) {
  const params = new URLSearchParams({ select, [idColumn]: inFilter(ids) });
  const response = await fetchImpl(`${baseUrl}/rest/v1/${table}?${params}`, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase GET ${table} failed with status ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`Supabase GET ${table} did not return an array`);
  return rows;
}

function indexExact(rows, key, requested, table) {
  const indexed = new Map();
  for (const row of rows) {
    const value = String(row?.[key] || '');
    if (!requested.has(value)) throw new Error(`${table} returned an unrequested lineage key`);
    if (indexed.has(value)) throw new Error(`${table} returned duplicate lineage keys`);
    indexed.set(value, row);
  }
  return indexed;
}

function frozenProposal(shadow) {
  if (!Number.isSafeInteger(shadow.candidate_count) || shadow.candidate_count < 0) {
    throw new Error('shadow candidate_count is invalid');
  }
  if (!Array.isArray(shadow.proposed_candidates) || !Array.isArray(shadow.change_flags)) {
    throw new Error('shadow proposal arrays are invalid');
  }
  if (shadow.candidate_count !== shadow.proposed_candidates.length) {
    throw new Error('shadow candidate_count does not match proposed_candidates');
  }
  return stableValue(sanitizeProposal({
    candidate_count: shadow.candidate_count,
    change_flags: shadow.change_flags,
    proposed_candidates: shadow.proposed_candidates,
    source_parser_version: shadow.source_parser_version ?? null,
  }));
}

function safeError(inputRow, code, message, route = {}) {
  return {
    input_row: inputRow,
    source_record_id: route.sourceRecordId || null,
    normalization_version: route.normalizationVersion || null,
    code,
    error: message,
  };
}

function rebuildSeen(outputPath, errorsPath) {
  const seen = new Set();
  for (const filePath of [outputPath, errorsPath]) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.source_record_id && row.normalization_version) {
        seen.add(`${row.source_record_id}\u0000${row.normalization_version}`);
      }
    }
  }
  return seen;
}

async function runExport(inputOptions = {}) {
  const input = path.resolve(required(
    inputOptions.input ?? process.env.REVIEW_PACKET_ROUTING_CSV,
    'REVIEW_PACKET_ROUTING_CSV',
  ));
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
    throw new Error('REVIEW_PACKET_ROUTING_CSV must be a local file');
  }
  const output = path.resolve(
    inputOptions.output ?? process.env.REVIEW_PACKET_ROUTING_OUTPUT ?? DEFAULT_OUTPUT,
  );
  const baseUrlValue = required(
    inputOptions.baseUrl ?? process.env.SUPABASE_URL,
    'SUPABASE_URL',
  ).replace(/\/$/, '');
  const parsedBaseUrl = new URL(baseUrlValue);
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) throw new Error('SUPABASE_URL must use HTTP(S)');
  const baseUrl = baseUrlValue;
  const key = required(
    inputOptions.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  const maxRows = boundedInteger(
    inputOptions.maxRows ?? process.env.REVIEW_PACKET_ROUTING_MAX_ROWS,
    HARD_MAX_ROWS,
    1,
    HARD_MAX_ROWS,
    'maxRows',
  );
  const batchSize = boundedInteger(
    inputOptions.batchSize ?? process.env.REVIEW_PACKET_ROUTING_BATCH_SIZE,
    100,
    1,
    100,
    'batchSize',
  );
  const timeoutMs = boundedInteger(
    inputOptions.timeoutMs ?? process.env.SUPABASE_REQUEST_TIMEOUT_MS,
    30_000,
    1_000,
    120_000,
    'timeoutMs',
  );
  const fetchImpl = inputOptions.fetchImpl || fetch;
  const inputHash = fileSha256(input);

  fs.mkdirSync(output, { recursive: true });
  const outputPath = path.join(output, 'routing.jsonl');
  const errorsPath = path.join(output, 'errors.jsonl');
  const checkpointPath = path.join(output, 'checkpoint.json');
  const artifacts = [
    outputPath,
    errorsPath,
    checkpointPath,
    path.join(output, 'manifest.json'),
    path.join(output, 'reconciliation.json'),
  ];
  if (artifacts.includes(input)) throw new Error('Input cannot be an exporter output artifact');

  let checkpoint = {
    contract: 'normalization-review-routing-evidence-v1',
    input: path.basename(input),
    input_sha256: inputHash,
    max_rows: maxRows,
    batch_size: batchSize,
    input_rows: 0,
    output_rows: 0,
    error_rows: 0,
    output_bytes: 0,
    error_bytes: 0,
    supabase_get_requests: 0,
    complete: false,
  };
  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (checkpoint.complete) throw new Error('Export is already complete');
    if (checkpoint.input_sha256 !== inputHash) throw new Error('Checkpoint input hash does not match');
    if (maxRows < checkpoint.input_rows) throw new Error('maxRows cannot be lower than checkpoint input_rows');
    if (fs.existsSync(outputPath)) fs.truncateSync(outputPath, checkpoint.output_bytes);
    if (fs.existsSync(errorsPath)) fs.truncateSync(errorsPath, checkpoint.error_bytes);
    checkpoint.max_rows = maxRows;
    checkpoint.batch_size = batchSize;
  } else {
    fs.writeFileSync(outputPath, '');
    fs.writeFileSync(errorsPath, '');
    atomicJson(checkpointPath, checkpoint);
  }

  const seen = rebuildSeen(outputPath, errorsPath);
  let inputRows = checkpoint.input_rows;
  let outputRows = checkpoint.output_rows;
  let errorRows = checkpoint.error_rows;
  let getRequests = checkpoint.supabase_get_requests || 0;

  async function processBatch(batch) {
    const accepted = [];
    const errors = [];
    const valid = [];
    for (const item of batch) {
      const route = validateRoute(item.row);
      if (route.error) {
        errors.push(safeError(item.inputRow, 'INVALID_ROUTE', route.error));
        continue;
      }
      const membership = `${route.sourceRecordId}\u0000${route.normalizationVersion}`;
      if (seen.has(membership)) {
        errors.push(safeError(item.inputRow, 'DUPLICATE_ROUTE', 'duplicate source/version routing row', route));
        continue;
      }
      seen.add(membership);
      valid.push({ ...item, route });
    }

    if (valid.length) {
      const ids = [...new Set(valid.map(item => item.route.sourceRecordId))];
      const requested = new Set(ids);
      const [sourceRows, shadowRows] = await Promise.all([
        readRows(
          fetchImpl,
          baseUrl,
          key,
          'watch_records',
          'id',
          ids,
          'id,raw_message',
          timeoutMs,
        ),
        readRows(
          fetchImpl,
          baseUrl,
          key,
          'normalization_shadow_v4',
          'source_record_id',
          ids,
          [
            'source_record_id',
            'normalization_version',
            'source_parser_version',
            'source_brand',
            'source_reference',
            'source_price_raw',
            'source_price_usd',
            'source_currency',
            'source_listing_type',
            'candidate_count',
            'proposed_candidates',
            'change_flags',
            'review_status',
          ].join(','),
          timeoutMs,
        ),
      ]);
      getRequests += 2;
      const sources = indexExact(sourceRows, 'id', requested, 'watch_records');
      const shadows = indexExact(shadowRows, 'source_record_id', requested, 'normalization_shadow_v4');

      for (const item of valid) {
        const { route } = item;
        const source = sources.get(route.sourceRecordId);
        const shadow = shadows.get(route.sourceRecordId);
        if (!source) {
          errors.push(safeError(item.inputRow, 'MISSING_SOURCE', 'immutable source evidence is missing', route));
          continue;
        }
        if (typeof source.raw_message !== 'string' || !source.raw_message) {
          errors.push(safeError(item.inputRow, 'MISSING_RAW_EVIDENCE', 'immutable raw evidence is missing', route));
          continue;
        }
        if (!shadow) {
          errors.push(safeError(item.inputRow, 'MISSING_SHADOW', 'normalization shadow proposal is missing', route));
          continue;
        }
        if (shadow.normalization_version !== route.normalizationVersion) {
          errors.push(safeError(item.inputRow, 'VERSION_MISMATCH', 'shadow normalization version does not match routing', route));
          continue;
        }
        if (String(shadow.review_status || '').toUpperCase() !== route.reviewStatus) {
          errors.push(safeError(item.inputRow, 'STATUS_MISMATCH', 'shadow review status does not match routing', route));
          continue;
        }
        if (exclusiveReason({ change_flags: shadow.change_flags }) !== route.reason) {
          errors.push(safeError(item.inputRow, 'REASON_MISMATCH', 'exclusive shadow reason does not match routing', route));
          continue;
        }
        try {
          accepted.push({
            source_record_id: route.sourceRecordId,
            normalization_version: route.normalizationVersion,
            review_status: route.reviewStatus,
            reason: route.reason,
            raw_message_sha256: sha256(source.raw_message),
            frozen_proposal: frozenProposal(shadow),
          });
        } catch (error) {
          errors.push(safeError(item.inputRow, 'INVALID_SHADOW_PROPOSAL', error.message, route));
        }
      }
    }

    appendDurable(outputPath, accepted);
    appendDurable(errorsPath, errors);
    inputRows += batch.length;
    outputRows += accepted.length;
    errorRows += errors.length;
    checkpoint = {
      ...checkpoint,
      max_rows: maxRows,
      batch_size: batchSize,
      input_rows: inputRows,
      output_rows: outputRows,
      error_rows: errorRows,
      output_bytes: fs.statSync(outputPath).size,
      error_bytes: fs.statSync(errorsPath).size,
      supabase_get_requests: getRequests,
      updated_at: new Date().toISOString(),
    };
    atomicJson(checkpointPath, checkpoint);
  }

  const parser = fs.createReadStream(input).pipe(csv({
    strict: true,
    mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim(),
  }));
  let seenCsvRows = 0;
  let batch = [];
  for await (const row of parser) {
    seenCsvRows += 1;
    if (seenCsvRows <= checkpoint.input_rows) continue;
    if (seenCsvRows > maxRows) {
      parser.destroy();
      throw new Error(`Input exceeds bounded maxRows=${maxRows}`);
    }
    batch.push({ inputRow: seenCsvRows, row });
    if (batch.length === batchSize) {
      await processBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await processBatch(batch);
  if (!seenCsvRows) throw new Error('Routing CSV contains no data rows');
  if (inputRows !== outputRows + errorRows) {
    throw new Error('Exporter reconciliation failed');
  }

  const reconciliation = {
    input_rows: inputRows,
    output_rows: outputRows,
    error_rows: errorRows,
    difference: inputRows - outputRows - errorRows,
    reconciled: inputRows === outputRows + errorRows,
  };
  atomicJson(path.join(output, 'reconciliation.json'), reconciliation);
  atomicJson(path.join(output, 'manifest.json'), {
    contract: checkpoint.contract,
    generated_at: new Date().toISOString(),
    source_artifact: path.basename(input),
    source_artifact_sha256: inputHash,
    max_rows: maxRows,
    batch_size: batchSize,
    ...reconciliation,
    contains_raw_messages: false,
    contains_contact_data: false,
    database_reads: getRequests,
    database_writes: 0,
    llm_calls: 0,
  });
  checkpoint.complete = true;
  checkpoint.completed_at = new Date().toISOString();
  atomicJson(checkpointPath, checkpoint);
  return { output, ...reconciliation, supabase_get_requests: getRequests };
}

if (require.main === module) {
  runExport().then(result => {
    process.stdout.write(`${JSON.stringify({ event: 'review_packet_routing_export_complete', ...result })}\n`);
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  frozenProposal,
  runExport,
  validateRoute,
};
