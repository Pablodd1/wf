'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicJson, boundedInteger, readJsonLines } = require('./lib.cjs');
const { readExistingProgress } = require('./normalize-local.cjs');

function increment(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function boundaryEvidence(filePath) {
  let first = null;
  let last = null;
  for await (const line of readJsonLines(filePath)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const evidence = {
      source_record_id: row.source_record_id || null,
      source_hash: row.source_hash || null,
    };
    if (!first) first = evidence;
    last = evidence;
  }
  return { first, last };
}

function segmentFiles(directory) {
  return {
    proposals: path.join(directory, 'normalization-proposals.jsonl'),
    errors: path.join(directory, 'normalization-errors.csv'),
    coverage: path.join(directory, 'coverage-report.json'),
    reconciliation: path.join(directory, 'normalization-reconciliation.json'),
  };
}

function requiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
}

async function inspectSegment({ directory, name, sourceStartRow, sourceEndRow, requireCompletion }) {
  const files = segmentFiles(directory);
  requiredFile(files.proposals, `${name} proposals`);
  requiredFile(files.errors, `${name} errors`);
  if (requireCompletion) {
    requiredFile(files.coverage, `${name} coverage`);
    requiredFile(files.reconciliation, `${name} reconciliation`);
  }

  const progress = await readExistingProgress(files);
  const coverage = fs.existsSync(files.coverage)
    ? JSON.parse(fs.readFileSync(files.coverage, 'utf8'))
    : null;
  const reconciliation = fs.existsSync(files.reconciliation)
    ? JSON.parse(fs.readFileSync(files.reconciliation, 'utf8'))
    : null;
  const start = coverage ? Number(coverage.source_start_row) : Number(sourceStartRow);
  const end = coverage ? Number(coverage.source_end_row) : Number(sourceEndRow);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error(`${name} has an invalid source range`);
  }
  const rangeRows = end - start + 1;
  if (progress.inputRows !== rangeRows) {
    throw new Error(`${name} evidence rows ${progress.inputRows} do not equal source range ${rangeRows}`);
  }
  if (coverage) {
    if (Number(coverage.input_rows) !== progress.inputRows
      || Number(coverage.output_rows) !== progress.outputRows
      || Number(coverage.error_rows) !== progress.errorRows) {
      throw new Error(`${name} coverage counts do not match durable evidence`);
    }
  }
  if (reconciliation) {
    if (reconciliation.reconciled !== true
      || Number(reconciliation.difference) !== 0
      || Number(reconciliation.input_rows) !== progress.inputRows
      || Number(reconciliation.output_rows) !== progress.outputRows
      || Number(reconciliation.error_rows) !== progress.errorRows) {
      throw new Error(`${name} reconciliation is incomplete or inconsistent`);
    }
  }
  const boundaries = await boundaryEvidence(files.proposals);
  return {
    name,
    directory,
    source_start_row: start,
    source_end_row: end,
    input_rows: progress.inputRows,
    output_rows: progress.outputRows,
    error_rows: progress.errorRows,
    bundle_status: coverage?.bundle_status || progress.bundles,
    review_disposition: coverage?.review_disposition || progress.dispositions,
    blockers_by_reason: coverage?.blockers_by_reason || progress.reasons,
    first_output_evidence: boundaries.first,
    last_output_evidence: boundaries.last,
    proposals_sha256: await sha256File(files.proposals),
    errors_sha256: await sha256File(files.errors),
    complete: requireCompletion ? true : Boolean(coverage && reconciliation),
  };
}

async function buildManifest(options = {}) {
  const env = options.env || process.env;
  const sourceRows = boundedInteger(
    env.MARIADB_NORMALIZATION_SOURCE_ROWS,
    0,
    1,
    10_000_000,
    'MARIADB_NORMALIZATION_SOURCE_ROWS',
  );
  const shardsRoot = path.resolve(env.MARIADB_NORMALIZATION_SHARDS_ROOT || '');
  const output = path.resolve(env.MARIADB_NORMALIZATION_MANIFEST_OUTPUT || path.join(shardsRoot, 'full-normalization-manifest.json'));
  if (!env.MARIADB_NORMALIZATION_SHARDS_ROOT) throw new Error('MARIADB_NORMALIZATION_SHARDS_ROOT is required');
  if (!fs.existsSync(shardsRoot)) throw new Error(`Shard root does not exist: ${shardsRoot}`);
  const segments = [];
  if (env.MARIADB_NORMALIZATION_PREFIX_DIR) {
    const prefixDirectory = path.resolve(env.MARIADB_NORMALIZATION_PREFIX_DIR);
    const prefixFiles = segmentFiles(prefixDirectory);
    requiredFile(prefixFiles.proposals, 'prefix proposals');
    requiredFile(prefixFiles.errors, 'prefix errors');
    const prefixProgress = await readExistingProgress(prefixFiles);
    if (prefixProgress.inputRows < 1) throw new Error('Prefix evidence is empty');
    segments.push(await inspectSegment({
      directory: prefixDirectory,
      name: 'prefix',
      sourceStartRow: 1,
      sourceEndRow: prefixProgress.inputRows,
      requireCompletion: false,
    }));
  }

  const shardDirectories = fs.readdirSync(shardsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(shardsRoot, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en'));
  if (!shardDirectories.length) throw new Error('No shard directories found');
  for (const directory of shardDirectories) {
    segments.push(await inspectSegment({
      directory,
      name: path.basename(directory),
      requireCompletion: true,
    }));
  }
  segments.sort((a, b) => a.source_start_row - b.source_start_row);

  let expectedStart = 1;
  const totals = {
    input_rows: 0,
    output_rows: 0,
    error_rows: 0,
    bundle_status: {},
    review_disposition: {},
    blockers_by_reason: {},
  };
  for (const segment of segments) {
    if (segment.source_start_row !== expectedStart) {
      throw new Error(`Normalization coverage gap or overlap: expected row ${expectedStart}, found ${segment.source_start_row}`);
    }
    expectedStart = segment.source_end_row + 1;
    totals.input_rows += segment.input_rows;
    totals.output_rows += segment.output_rows;
    totals.error_rows += segment.error_rows;
    increment(totals.bundle_status, segment.bundle_status);
    increment(totals.review_disposition, segment.review_disposition);
    increment(totals.blockers_by_reason, segment.blockers_by_reason);
  }
  if (expectedStart !== sourceRows + 1 || totals.input_rows !== sourceRows) {
    throw new Error(`Normalization coverage ends at row ${expectedStart - 1}; expected ${sourceRows}`);
  }
  if (totals.input_rows !== totals.output_rows + totals.error_rows) {
    throw new Error('Full normalization row reconciliation failed');
  }

  const manifest = {
    contract: 'wf-mariadb-full-normalization-manifest-v1',
    generated_at: new Date().toISOString(),
    source_rows: sourceRows,
    segment_count: segments.length,
    segments,
    totals,
    difference: totals.input_rows - totals.output_rows - totals.error_rows,
    source_coverage_reconciled: true,
    production_writes: 0,
    watch_records_writes: 0,
  };
  atomicJson(output, manifest);
  return manifest;
}

if (require.main === module) {
  buildManifest().then(manifest => {
    process.stdout.write(`${JSON.stringify({
      event: 'mariadb_full_normalization_reconciled',
      source_rows: manifest.source_rows,
      output_rows: manifest.totals.output_rows,
      error_rows: manifest.totals.error_rows,
      segment_count: manifest.segment_count,
    })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_full_normalization_reconciliation_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildManifest, inspectSegment, sha256File };
