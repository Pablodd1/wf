'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../shadow-reprocess/promotion-policy.cjs');
const { atomicJson, boundedInteger, csv, jsonLine, normalizationInput, readJsonLines } = require('./lib.cjs');

function loadFxSnapshot(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`FX snapshot does not exist: ${resolved}`);
  const snapshot = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!snapshot.observed_at || !snapshot.source || !snapshot.usd_per_unit || typeof snapshot.usd_per_unit !== 'object') {
    throw new Error('FX snapshot must contain observed_at, source, and usd_per_unit');
  }
  if (!Number.isFinite(Date.parse(snapshot.observed_at))) throw new Error('FX snapshot observed_at is invalid');
  for (const [currency, value] of Object.entries(snapshot.usd_per_unit)) {
    if (!/^[A-Z]{3,4}$/.test(currency) || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      throw new Error(`FX snapshot contains an invalid USD-per-unit rate for ${currency}`);
    }
  }
  return snapshot;
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function normalizeSourceRecord(source, options = {}) {
  const normalizedInput = normalizationInput(source);
  const shadow = analyzeRecord(normalizedInput, { fxSnapshot: options.fxSnapshot || null });
  const confirmation = shadow.candidate_count === 1
    ? confirmCatalogCandidate(shadow.proposed_candidates[0])
    : null;
  const decision = buildPromotionDecision(shadow, confirmation);
  const bundleStatus = shadow.candidate_count > 1
    ? 'BUNDLE_SPLIT_REQUIRED'
    : shadow.candidate_count === 1 ? 'SINGLE_CANDIDATE' : 'NO_CANDIDATE';
  return {
    source_record_id: source.source_record_id,
    source_id: source.source_id,
    source_created_on: source.source_created_on,
    source_hash: source.raw_sha256,
    media_key: source.raw_data?.front_image || null,
    bundle_status: bundleStatus,
    catalog_confirmation: confirmation,
    review_disposition: decision.disposition,
    review_reasons: decision.reasons || [],
    normalization: shadow,
  };
}

async function readExistingProgress(paths) {
  const reasons = {};
  const dispositions = {};
  const bundles = {};
  let outputRows = 0;
  let errorRows = 0;
  for await (const line of readJsonLines(paths.proposals)) {
    if (!line.trim()) continue;
    const proposal = JSON.parse(line);
    increment(bundles, proposal.bundle_status);
    increment(dispositions, proposal.review_disposition);
    for (const reason of proposal.review_reasons || []) increment(reasons, reason);
    outputRows += 1;
  }
  let lineNumber = 0;
  for await (const line of readJsonLines(paths.errors)) {
    lineNumber += 1;
    if (lineNumber === 1 || !line.trim()) continue;
    errorRows += 1;
  }
  return { reasons, dispositions, bundles, outputRows, errorRows, inputRows: outputRows + errorRows };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const input = path.resolve(env.MARIADB_NORMALIZE_INPUT || 'audit-output/mariadb-live/canary/raw-records.jsonl');
  const output = path.resolve(env.MARIADB_NORMALIZE_OUTPUT || path.dirname(input));
  const maxRows = boundedInteger(env.MARIADB_NORMALIZE_MAX_ROWS, 100_000, 1, 10_000_000, 'MARIADB_NORMALIZE_MAX_ROWS');
  const startRow = boundedInteger(env.MARIADB_NORMALIZE_START_ROW, 0, 0, 10_000_000, 'MARIADB_NORMALIZE_START_ROW');
  const flushRows = boundedInteger(env.MARIADB_NORMALIZE_FLUSH_ROWS, 500, 1, 5000, 'MARIADB_NORMALIZE_FLUSH_ROWS');
  const resume = env.MARIADB_NORMALIZE_RESUME === '1';
  const fxSnapshot = loadFxSnapshot(env.MARIADB_NORMALIZE_FX_SNAPSHOT || null);
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  fs.mkdirSync(output, { recursive: true });
  const paths = {
    proposals: path.join(output, 'normalization-proposals.jsonl'),
    errors: path.join(output, 'normalization-errors.csv'),
    coverage: path.join(output, 'coverage-report.json'),
    blockers: path.join(output, 'blockers-by-reason.csv'),
    reconciliation: path.join(output, 'normalization-reconciliation.json'),
  };
  if (resume) {
    if (!fs.existsSync(paths.proposals) || !fs.existsSync(paths.errors)) {
      throw new Error('Resume requires existing proposals and errors evidence');
    }
    for (const target of [paths.coverage, paths.blockers, paths.reconciliation]) {
      if (fs.existsSync(target)) throw new Error(`Resume refused because completed output exists: ${target}`);
    }
  } else {
    for (const target of Object.values(paths)) {
      if (fs.existsSync(target)) throw new Error(`Output already exists: ${target}`);
    }
    fs.writeFileSync(paths.errors, 'source_record_id,error_name,error_message\n');
  }
  const lines = readJsonLines(input);
  const existing = resume
    ? await readExistingProgress(paths)
    : { reasons: {}, dispositions: {}, bundles: {}, inputRows: 0, outputRows: 0, errorRows: 0 };
  const { reasons, dispositions, bundles } = existing;
  let inputRows = existing.inputRows;
  let outputRows = existing.outputRows;
  let errorRows = existing.errorRows;
  const resumedRows = inputRows;
  let sourceInputRows = 0;
  let bufferedRows = 0;
  let proposalBuffer = '';
  let errorBuffer = '';

  function flush() {
    if (proposalBuffer) fs.appendFileSync(paths.proposals, proposalBuffer);
    if (errorBuffer) fs.appendFileSync(paths.errors, errorBuffer);
    proposalBuffer = '';
    errorBuffer = '';
    bufferedRows = 0;
  }

  for await (const line of lines) {
    if (!line.trim()) continue;
    sourceInputRows += 1;
    if (sourceInputRows <= startRow + resumedRows) continue;
    if (inputRows >= maxRows) break;
    inputRows += 1;
    let sourceId = null;
    try {
      const source = JSON.parse(line);
      sourceId = source.source_record_id;
      const proposal = normalizeSourceRecord(source, { fxSnapshot });
      increment(bundles, proposal.bundle_status);
      increment(dispositions, proposal.review_disposition);
      for (const reason of proposal.review_reasons) increment(reasons, reason);
      proposalBuffer += jsonLine(proposal);
      outputRows += 1;
    } catch (error) {
      errorBuffer += `${csv(sourceId)},${csv(error.name || 'Error')},${csv(error.message || String(error))}\n`;
      errorRows += 1;
    }
    bufferedRows += 1;
    if (bufferedRows >= flushRows) flush();
  }
  flush();
  const reconciled = inputRows === outputRows + errorRows;
  const coverage = {
    contract: 'wf-mariadb-local-normalization-v1',
    generated_at: new Date().toISOString(),
    normalization_version: 'v4.2-line-condition',
    source_start_row: startRow + 1,
    source_end_row: startRow + inputRows,
    resumed_rows: resumedRows,
    input_rows: inputRows,
    output_rows: outputRows,
    error_rows: errorRows,
    bundle_status: bundles,
    review_disposition: dispositions,
    blockers_by_reason: reasons,
    production_writes: 0,
    watch_records_writes: 0,
  };
  atomicJson(paths.coverage, coverage);
  const blockerLines = ['reason,count', ...Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${csv(reason)},${count}`)];
  fs.writeFileSync(paths.blockers, `${blockerLines.join('\n')}\n`);
  atomicJson(paths.reconciliation, {
    contract: coverage.contract,
    input_rows: inputRows,
    output_rows: outputRows,
    error_rows: errorRows,
    difference: inputRows - outputRows - errorRows,
    reconciled,
    production_writes: 0,
    watch_records_writes: 0,
  });
  if (!reconciled) throw new Error('Local normalization reconciliation failed');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_local_normalization_complete', ...coverage, reconciled })}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_local_normalization_error', error_name: error.name || 'Error', error_message: error.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { loadFxSnapshot, normalizeSourceRecord, readExistingProgress, run };
