'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { buildCanaryRow } = require('./build-unbundled-canary.cjs');
const { serializeJsonLine } = require('./json-line.cjs');

const VERSION = 'manual-unbundle-full-v4';
const DEFAULT_SHARD_SIZE = 10_000;
const RETRYABLE_FILE_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function renameWithRetry(source, destination) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      if (!RETRYABLE_FILE_ERRORS.has(error?.code) || attempt === 12) throw error;
      sleepSync(attempt * 50);
    }
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function bucketFor(row) {
  switch (row.review_status) {
    case 'READY_FOR_HUMAN_REVIEW': return 'review-ready';
    case 'REQUIRES_HUMAN_CORRECTION': return 'human-correction';
    case 'BLOCKED_LINEAGE_CONTEXT': return 'held-lineage';
    case 'BLOCKED_MULTI_WATCH': return 'held-multi-watch';
    case 'BLOCKED_NOT_WATCH': return 'held-non-watch';
    case 'BLOCKED_PRICE_CURRENCY': return 'held-price-currency';
    default: return 'held-catalog';
  }
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function loadParents(parentsPath) {
  return new Promise((resolve, reject) => {
    const parents = new Map();
    fs.createReadStream(parentsPath)
      .pipe(csv())
      .on('data', row => parents.set(text(row.source_record_id), row))
      .on('end', () => resolve(parents))
      .on('error', reject);
  });
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameWithRetry(temporary, filePath);
}

function flushShard(outputDir, shardNumber, rowsByBucket) {
  const files = [];
  for (const [bucket, rows] of rowsByBucket) {
    if (!rows.length) continue;
    const directory = path.join(outputDir, bucket);
    fs.mkdirSync(directory, { recursive: true });
    const finalPath = path.join(directory, `part-${String(shardNumber).padStart(6, '0')}.jsonl`);
    const temporary = `${finalPath}.partial`;
    const payload = Buffer.from(`${rows.map(serializeJsonLine).join('\n')}\n`);
    fs.writeFileSync(temporary, payload);
    if (fs.existsSync(finalPath)) {
      const existing = fs.readFileSync(finalPath);
      if (!existing.equals(payload)) {
        throw new Error(`Existing shard conflicts with resumed output: ${finalPath}`);
      }
      fs.rmSync(temporary, { force: true });
    } else {
      renameWithRetry(temporary, finalPath);
    }
    files.push({ bucket, path: finalPath, rows: rows.length, bytes: fs.statSync(finalPath).size });
  }
  return files;
}

function emptyCounts() {
  return {
    status: {}, bucket: {}, intent: {}, blockers: {}, reviewReasons: {},
    sellerCoverage: { sellerName: 0, sellerPhone: 0, dealer: 0 },
  };
}

function updateCounts(counts, row, bucket) {
  increment(counts.status, row.review_status || 'UNKNOWN');
  increment(counts.bucket, bucket);
  increment(counts.intent, row.listing_type || 'UNRESOLVED');
  for (const blocker of row.blockers || []) increment(counts.blockers, blocker);
  for (const reason of row.review_reasons || []) increment(counts.reviewReasons, reason);
  if (row.seller_name) counts.sellerCoverage.sellerName += 1;
  if (row.seller_phone) counts.sellerCoverage.sellerPhone += 1;
  if (row.dealer) counts.sellerCoverage.dealer += 1;
}

function removePartialFiles(outputDir) {
  if (!fs.existsSync(outputDir)) return;
  for (const directory of fs.readdirSync(outputDir, { withFileTypes: true })) {
    const target = path.join(outputDir, directory.name);
    if (directory.isDirectory()) removePartialFiles(target);
    else if (directory.name.endsWith('.partial')) fs.rmSync(target, { force: true });
  }
}

async function normalizeBatch({ listingsPath, parentsPath, outputDir, shardSize = DEFAULT_SHARD_SIZE, maxRows = Infinity, resume = true }) {
  fs.mkdirSync(outputDir, { recursive: true });
  removePartialFiles(outputDir);
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const checkpoint = resume && fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { processedRows: 0, completedShards: 0, counts: emptyCounts(), files: [] };
  const parents = await loadParents(parentsPath);
  const rowsByBucket = new Map();
  const counts = checkpoint.counts || emptyCounts();
  const files = Array.isArray(checkpoint.files) ? checkpoint.files : [];
  let seenRows = 0;
  let processedRows = checkpoint.processedRows || 0;
  let shardNumber = checkpoint.completedShards || 0;
  let rowsInShard = 0;

  const flush = () => {
    if (!rowsInShard) return;
    shardNumber += 1;
    files.push(...flushShard(outputDir, shardNumber, rowsByBucket));
    rowsByBucket.clear();
    rowsInShard = 0;
    atomicJson(checkpointPath, {
      version: VERSION,
      input: path.resolve(listingsPath),
      parents: path.resolve(parentsPath),
      processedRows,
      completedShards: shardNumber,
      counts,
      files,
      updatedAt: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify({ event: 'unbundled_normalization_checkpoint', processedRows, shardNumber, counts: counts.bucket })}\n`);
  };

  const input = fs.createReadStream(listingsPath).pipe(csv());
  for await (const row of input) {
    seenRows += 1;
    if (seenRows <= (checkpoint.processedRows || 0)) continue;
    if (processedRows >= maxRows) break;
    const normalized = buildCanaryRow(row, parents.get(text(row.source_record_id)));
    normalized.parser_version = VERSION;
    normalized.review_bucket = bucketFor(normalized);
    const bucketRows = rowsByBucket.get(normalized.review_bucket) || [];
    bucketRows.push(normalized);
    rowsByBucket.set(normalized.review_bucket, bucketRows);
    updateCounts(counts, normalized, normalized.review_bucket);
    processedRows += 1;
    rowsInShard += 1;
    if (rowsInShard >= shardSize) flush();
  }
  flush();

  const report = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input: path.resolve(listingsPath),
    parents: path.resolve(parentsPath),
    outputDir: path.resolve(outputDir),
    parentRows: parents.size,
    processedRows,
    completedShards: shardNumber,
    counts,
    files,
    productionWrites: 0,
    releaseGate: 'INDIVIDUAL_HUMAN_AND_CATALOG_APPROVAL_REQUIRED',
  };
  atomicJson(path.join(outputDir, 'report.json'), report);
  return report;
}

async function main() {
  const listingsPath = process.env.UNBUNDLED_CSV_PATH || process.argv[2];
  const parentsPath = process.env.UNBUNDLED_PARENT_CSV_PATH || process.argv[3];
  if (!listingsPath || !parentsPath) throw new Error('Provide listings and parent raw-message CSV paths.');
  const outputDir = path.resolve(process.env.UNBUNDLED_NORMALIZED_OUTPUT || 'audit-output/unbundled/batch-002-normalized');
  const shardSize = Math.max(100, Math.min(Number(process.env.UNBUNDLED_SHARD_SIZE || DEFAULT_SHARD_SIZE), 50_000));
  const maxRows = process.env.UNBUNDLED_MAX_ROWS ? Math.max(1, Number(process.env.UNBUNDLED_MAX_ROWS)) : Infinity;
  const resume = String(process.env.UNBUNDLED_RESUME || 'true').toLowerCase() !== 'false';
  const report = await normalizeBatch({ listingsPath, parentsPath, outputDir, shardSize, maxRows, resume });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_normalization_complete', ...report }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'unbundled_normalization_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { bucketFor, normalizeBatch };
