'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../shadow-reprocess/promotion-policy.cjs');
const { atomicJson, boundedInteger, csv, normalizationInput } = require('./lib.cjs');

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function normalizeSourceRecord(source) {
  const normalizedInput = normalizationInput(source);
  const shadow = analyzeRecord(normalizedInput);
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

async function run() {
  const input = path.resolve(process.env.MARIADB_NORMALIZE_INPUT || 'audit-output/mariadb-live/canary/raw-records.jsonl');
  const output = path.resolve(process.env.MARIADB_NORMALIZE_OUTPUT || path.dirname(input));
  const maxRows = boundedInteger(process.env.MARIADB_NORMALIZE_MAX_ROWS, 100_000, 1, 10_000_000, 'MARIADB_NORMALIZE_MAX_ROWS');
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  fs.mkdirSync(output, { recursive: true });
  const paths = {
    proposals: path.join(output, 'normalization-proposals.jsonl'),
    errors: path.join(output, 'normalization-errors.csv'),
    coverage: path.join(output, 'coverage-report.json'),
    blockers: path.join(output, 'blockers-by-reason.csv'),
    reconciliation: path.join(output, 'normalization-reconciliation.json'),
  };
  for (const target of Object.values(paths)) {
    if (fs.existsSync(target)) throw new Error(`Output already exists: ${target}`);
  }
  fs.writeFileSync(paths.errors, 'source_record_id,error_name,error_message\n');
  const inputStream = fs.createReadStream(input, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
  const reasons = {};
  const dispositions = {};
  const bundles = {};
  let inputRows = 0;
  let outputRows = 0;
  let errorRows = 0;
  for await (const line of lines) {
    if (inputRows >= maxRows) break;
    if (!line.trim()) continue;
    inputRows += 1;
    let sourceId = null;
    try {
      const source = JSON.parse(line);
      sourceId = source.source_record_id;
      const proposal = normalizeSourceRecord(source);
      increment(bundles, proposal.bundle_status);
      increment(dispositions, proposal.review_disposition);
      for (const reason of proposal.review_reasons) increment(reasons, reason);
      fs.appendFileSync(paths.proposals, `${JSON.stringify(proposal)}\n`);
      outputRows += 1;
    } catch (error) {
      fs.appendFileSync(paths.errors, `${csv(sourceId)},${csv(error.name || 'Error')},${csv(error.message || String(error))}\n`);
      errorRows += 1;
    }
  }
  const reconciled = inputRows === outputRows + errorRows;
  const coverage = {
    contract: 'wf-mariadb-local-normalization-v1',
    generated_at: new Date().toISOString(),
    normalization_version: 'v4.2-line-condition',
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

module.exports = { normalizeSourceRecord, run };
