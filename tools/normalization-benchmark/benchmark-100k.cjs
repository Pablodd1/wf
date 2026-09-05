'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Worker } = require('node:worker_threads');

const DEFAULT_ROW_LIMIT = 100_000;
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_FULL_ROW_COUNT = 2_631_583;
const DEFAULT_PENDING_ROW_COUNT = 1_988_995;
const REQUIRED_OUTPUTS = [
  'run-manifest.json',
  'coverage-report.json',
  'coverage-report.csv',
  'blockers-by-reason.csv',
  'changed-records.csv',
  'errors.csv',
  'benchmark.json',
  'reconciliation.json',
];

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const next = inlineValue ?? argv[index + 1];
    if (inlineValue == null) index += 1;
    values[rawKey] = next;
  }
  const logicalCpus = Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
  return {
    input: path.resolve(values.input || process.env.NORMALIZATION_BENCHMARK_INPUT || 'public/parsedWatches.json'),
    output: path.resolve(values.output || process.env.NORMALIZATION_BENCHMARK_OUTPUT
      || 'audit-output/normalization-benchmark-100k'),
    rowLimit: boundedInteger(values.rows || process.env.NORMALIZATION_BENCHMARK_ROWS, DEFAULT_ROW_LIMIT, 1, DEFAULT_ROW_LIMIT),
    workers: boundedInteger(values.workers || process.env.NORMALIZATION_BENCHMARK_WORKERS,
      Math.min(4, logicalCpus), 1, Math.min(16, logicalCpus)),
    batchSize: boundedInteger(values['batch-size'] || process.env.NORMALIZATION_BENCHMARK_BATCH_SIZE,
      DEFAULT_BATCH_SIZE, 10, 5_000),
    fullRowCount: boundedInteger(values['full-row-count'], DEFAULT_FULL_ROW_COUNT, 1, Number.MAX_SAFE_INTEGER),
    pendingRowCount: boundedInteger(values['pending-row-count'], DEFAULT_PENDING_ROW_COUNT, 1, Number.MAX_SAFE_INTEGER),
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}; received ${value}`);
  }
  return parsed;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function fileEvidence(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(process.cwd(), filePath).replaceAll('\\', '/'),
    bytes: stat.size,
    sha256: sha256File(filePath),
  };
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function inferSourceListingType(rawMessage) {
  return /(?:\bWTB\b|want\s+to\s+buy|looking\s+for|seeking|wanted|\bLF\b|求购|求購|求收|收购|寻找|尋找|找表|找貨)|^\s*收[：:\s]/i
    .test(String(rawMessage || '')) ? 'WTB' : 'WTS';
}

function adaptArrayRow(row) {
  const rawMessage = row[8] || '';
  return {
    id: row[0],
    brand: row[1] || null,
    reference: row[2] || null,
    dial_color: row[3] || null,
    price_raw: row[4] ?? null,
    price_usd: row[5] ?? null,
    currency: row[6] || null,
    condition: row[7] || null,
    raw_message: rawMessage,
    listing_type: inferSourceListingType(rawMessage),
    parser_version: 'legacy-static-export-adapter-v1',
  };
}

function adaptObjectRow(row) {
  const rawMessage = row.raw_message ?? row.rawMessage ?? row.source_line ?? row.sourceLine ?? '';
  return {
    id: row.id ?? row.source_record_id ?? row.sourceRecordId,
    brand: row.brand ?? null,
    reference: row.reference ?? null,
    dial_color: row.dial_color ?? row.dialColor ?? row.dial ?? null,
    price_raw: row.price_raw ?? row.price ?? row.originalPrice ?? null,
    price_usd: row.price_usd ?? row.priceUSD ?? null,
    currency: row.currency ?? row.originalCurrency ?? null,
    condition: row.condition ?? null,
    raw_message: rawMessage,
    listing_type: row.listing_type ?? row.listingType ?? inferSourceListingType(rawMessage),
    parser_version: row.parser_version ?? row.parserVersion ?? 'benchmark-object-adapter-v1',
  };
}

function loadEvidence(inputPath, rowLimit) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input evidence does not exist: ${inputPath}`);
  const raw = fs.readFileSync(inputPath, 'utf8');
  let rows;
  if (inputPath.toLowerCase().endsWith('.jsonl')) {
    rows = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
  } else {
    rows = JSON.parse(raw);
  }
  if (!Array.isArray(rows)) throw new Error('Benchmark input must be a JSON array or JSONL records.');
  if (rows.length < rowLimit) {
    throw new Error(`Input has ${rows.length.toLocaleString()} rows; ${rowLimit.toLocaleString()} are required.`);
  }
  const adapter = Array.isArray(rows[0]) ? adaptArrayRow : adaptObjectRow;
  return {
    availableRows: rows.length,
    selectedRows: rows.slice(0, rowLimit).map(adapter),
    inputShape: Array.isArray(rows[0]) ? 'legacy_compact_array' : 'record_object',
  };
}

function csvCell(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(filePath, columns, rows) {
  function* csvLines() {
    yield `${columns.join(',')}\n`;
    for (const row of rows) {
      yield `${columns.map(column => csvCell(row[column])).join(',')}\n`;
    }
  }
  await pipeline(Readable.from(csvLines()), fs.createWriteStream(filePath, { encoding: 'utf8' }));
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function increment(group, value) {
  const key = value || 'UNSPECIFIED';
  group[key] = (group[key] || 0) + 1;
}

function countCoverage(results) {
  const coverage = {
    catalog_status: {},
    currency_status: {},
    bundle_status: {},
    review_disposition: {},
    change_flags: {},
    candidate_count: {},
  };
  for (const result of results) {
    increment(coverage.catalog_status, result.catalog_status);
    increment(coverage.currency_status, result.currency_status);
    increment(coverage.bundle_status, result.bundle_status);
    increment(coverage.review_disposition, result.review_disposition);
    increment(coverage.candidate_count, String(result.candidate_count));
    if (!result.change_flags.length) increment(coverage.change_flags, 'NO_CHANGE');
    for (const flag of result.change_flags) increment(coverage.change_flags, flag);
  }
  return coverage;
}

function coverageRows(coverage, denominator) {
  const rows = [];
  for (const [group, values] of Object.entries(coverage)) {
    for (const [status, count] of Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      rows.push({
        metric_group: group,
        status,
        count,
        rate: denominator ? (count / denominator).toFixed(6) : '0.000000',
      });
    }
  }
  return rows;
}

function blockerRows(results, denominator) {
  const counts = {};
  for (const result of results) {
    if (result.review_disposition === 'READY_FOR_HUMAN_APPROVAL') continue;
    for (const reason of result.review_reasons || []) increment(counts, reason);
  }
  return Object.entries(counts)
    .map(([reason, count]) => ({
      reason,
      count,
      rate: denominator ? (count / denominator).toFixed(6) : '0.000000',
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function secondsLabel(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return {
    seconds: Math.round(seconds * 100) / 100,
    minutes: Math.round((seconds / 60) * 100) / 100,
    hours: Math.round((seconds / 3600) * 100) / 100,
  };
}

function runWorkers(rows, workerCount, batchSize, onMemorySample) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'worker.cjs');
    const batches = [];
    for (let start = 0, batchId = 0; start < rows.length; start += batchSize, batchId += 1) {
      batches.push({
        batchId,
        rows: rows.slice(start, start + batchSize).map((record, offset) => ({
          sourceIndex: start + offset,
          record,
        })),
      });
    }

    const workers = [];
    const results = [];
    const errors = [];
    const workerMetrics = [];
    const readyCatalogStats = [];
    let nextBatch = 0;
    let completedBatches = 0;
    let finished = false;

    const fail = error => {
      if (finished) return;
      finished = true;
      for (const worker of workers) worker.terminate();
      reject(error);
    };

    const dispatch = worker => {
      if (nextBatch >= batches.length) return;
      const batch = batches[nextBatch];
      nextBatch += 1;
      worker.postMessage({ type: 'batch', ...batch });
    };

    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(workerPath);
      workers.push(worker);
      worker.on('error', fail);
      worker.on('exit', code => {
        if (!finished && code !== 0) fail(new Error(`Benchmark worker exited with code ${code}`));
      });
      worker.on('message', message => {
        if (message.type === 'ready') {
          readyCatalogStats.push(message.catalog_stats);
          onMemorySample();
          dispatch(worker);
          return;
        }
        if (message.type !== 'batch-complete') return;
        results.push(...message.results);
        errors.push(...message.errors);
        workerMetrics.push(message.metrics);
        completedBatches += 1;
        onMemorySample();
        if (completedBatches === batches.length) {
          finished = true;
          Promise.all(workers.map(item => item.terminate())).then(() => {
            resolve({ results, errors, workerMetrics, readyCatalogStats });
          }, reject);
        } else {
          dispatch(worker);
        }
      });
    }
  });
}

async function runBenchmark(options) {
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  fs.mkdirSync(options.output, { recursive: true });
  for (const required of REQUIRED_OUTPUTS) {
    const partial = path.join(options.output, `${required}.partial`);
    if (fs.existsSync(partial)) fs.rmSync(partial, { force: true });
  }

  let peakRssBytes = process.memoryUsage().rss;
  const sampleMemory = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };

  const evidence = loadEvidence(options.input, options.rowLimit);
  sampleMemory();
  const sourceEvidence = fileEvidence(options.input);
  const normalizerEvidence = [
    'api/_lib/normalization-v4.cjs',
    'tools/shadow-reprocess/shadow-reprocess.cjs',
    'api/_lib/catalog.js',
    'api/_lib/catalog-confirmation.cjs',
    'api/_lib/dial-normalization.cjs',
    'tools/shadow-reprocess/promotion-policy.cjs',
  ].map(filePath => fileEvidence(path.resolve(filePath)));
  const catalogEvidence = [
    'public/catalog.json',
    'public/enriched_refs.json',
    'public/catalog-source-v1.json',
    'api/dictionaries/catalog-curation.json',
  ].map(filePath => fileEvidence(path.resolve(filePath)));
  const benchmarkEvidence = [
    'tools/normalization-benchmark/benchmark-100k.cjs',
    'tools/normalization-benchmark/worker.cjs',
  ].map(filePath => fileEvidence(path.resolve(filePath)));

  const processingStartedNs = process.hrtime.bigint();
  const workerOutput = await runWorkers(
    evidence.selectedRows,
    options.workers,
    options.batchSize,
    sampleMemory,
  );
  const processingSeconds = Number(process.hrtime.bigint() - processingStartedNs) / 1e9;
  sampleMemory();

  const results = workerOutput.results.sort((a, b) => a.source_index - b.source_index);
  const errors = workerOutput.errors.sort((a, b) => a.source_index - b.source_index);
  const outputRows = results.length;
  const errorRows = errors.length;
  const reconciled = options.rowLimit === outputRows + errorRows;
  if (!reconciled) {
    throw new Error(`Reconciliation failed: ${options.rowLimit} != ${outputRows} + ${errorRows}`);
  }

  const coverage = countCoverage(results);
  const blockers = blockerRows(results, outputRows);
  const changed = results.filter(result => result.change_flags.length > 0);
  const rowsPerSecond = processingSeconds > 0 ? outputRows / processingSeconds : 0;
  const completedAt = new Date();
  const totalRuntimeSeconds = Number(process.hrtime.bigint() - startedNs) / 1e9;

  const manifest = {
    benchmark_contract: 'normalization-benchmark-v1',
    run_started_at: startedAt.toISOString(),
    run_completed_at: completedAt.toISOString(),
    git: {
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      working_tree_status: gitValue(['status', '--short'], ''),
    },
    safety: {
      mode: 'LOCAL_FILES_ONLY',
      production_connections: 0,
      database_writes: 0,
      watch_records_writes: 0,
      full_dataset_run_started: false,
    },
    source_evidence: {
      ...sourceEvidence,
      immutable_basis: 'tracked repository snapshot plus SHA-256',
      input_shape: evidence.inputShape,
      rows_available: evidence.availableRows,
      selection: `first ${options.rowLimit} rows in source order`,
      selected_rows: options.rowLimit,
      adapter_version: evidence.inputShape === 'legacy_compact_array'
        ? 'legacy-static-export-adapter-v1'
        : 'benchmark-object-adapter-v1',
    },
    normalization: {
      version: results[0]?.normalization_version || 'v4.3-mint-condition',
      implementation_files: normalizerEvidence,
    },
    benchmark_implementation_files: benchmarkEvidence,
    catalog_and_aliases: {
      load_policy: 'loaded locally once during each worker initialization',
      worker_catalog_stats: workerOutput.readyCatalogStats,
      files: catalogEvidence,
    },
    execution: {
      workers: options.workers,
      batch_size: options.batchSize,
      requested_rows: options.rowLimit,
      output_directory: options.output,
    },
    required_outputs: REQUIRED_OUTPUTS,
  };

  const coverageReport = {
    generated_at: completedAt.toISOString(),
    input_rows: options.rowLimit,
    output_rows: outputRows,
    error_rows: errorRows,
    changed_rows: changed.length,
    unchanged_rows: outputRows - changed.length,
    normalization_version: manifest.normalization.version,
    coverage,
  };

  const benchmark = {
    generated_at: completedAt.toISOString(),
    normalization_version: manifest.normalization.version,
    input_rows: options.rowLimit,
    output_rows: outputRows,
    error_rows: errorRows,
    workers: options.workers,
    batch_size: options.batchSize,
    processing_runtime_seconds: Math.round(processingSeconds * 1000) / 1000,
    total_runtime_seconds: Math.round(totalRuntimeSeconds * 1000) / 1000,
    rows_per_second: Math.round(rowsPerSecond * 100) / 100,
    memory: {
      peak_process_rss_bytes: peakRssBytes,
      peak_process_rss_mib: Math.round((peakRssBytes / 1024 / 1024) * 100) / 100,
      final_process: process.memoryUsage(),
      peak_worker_heap_used_bytes: Math.max(0, ...workerOutput.workerMetrics.map(metric => metric.heap_used_bytes)),
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      node_version: process.version,
      logical_cpu_count: os.availableParallelism?.() || os.cpus().length,
      cpu_model: os.cpus()[0]?.model || null,
      total_memory_bytes: os.totalmem(),
    },
    estimated_full_run_duration: {
      all_watch_records: {
        rows: options.fullRowCount,
        ...secondsLabel(options.fullRowCount / rowsPerSecond),
      },
      currently_pending_normalization: {
        rows: options.pendingRowCount,
        ...secondsLabel(options.pendingRowCount / rowsPerSecond),
      },
      scope_note: 'CPU/local-file estimate only; database reads, writes, retries, leases, and human review are excluded.',
    },
    recommendation: {
      local_file_workers: options.workers,
      local_file_batch_size: options.batchSize,
      railway_workers_current_supabase: 1,
      railway_batch_size_current_supabase: 250,
      reason: 'Use measured local parallelism only for immutable-file analysis. Repository runbooks require one Railway replica and batch 250 while Supabase capacity and the global lease remain constraints.',
    },
  };

  const reconciliation = {
    generated_at: completedAt.toISOString(),
    equation: 'input_rows = output_rows + error_rows',
    input_rows: options.rowLimit,
    output_rows: outputRows,
    error_rows: errorRows,
    difference: options.rowLimit - outputRows - errorRows,
    reconciled,
    changed_rows: changed.length,
    unchanged_rows: outputRows - changed.length,
    note: 'output_rows counts every successfully analyzed source row; changed-records.csv intentionally contains only rows with one or more change flags.',
  };

  atomicJson(path.join(options.output, 'run-manifest.json'), manifest);
  atomicJson(path.join(options.output, 'coverage-report.json'), coverageReport);
  atomicJson(path.join(options.output, 'reconciliation.json'), reconciliation);
  await writeCsv(path.join(options.output, 'coverage-report.csv'),
    ['metric_group', 'status', 'count', 'rate'], coverageRows(coverage, outputRows));
  await writeCsv(path.join(options.output, 'blockers-by-reason.csv'),
    ['reason', 'count', 'rate'], blockers);
  await writeCsv(path.join(options.output, 'changed-records.csv'), [
    'source_index', 'source_record_id', 'normalization_version', 'candidate_count',
    'change_flags', 'catalog_status', 'currency_status', 'bundle_status',
    'review_disposition', 'review_reasons', 'source_brand', 'source_reference',
    'source_price_raw', 'source_currency', 'source_listing_type', 'source_dial_color',
    'proposed_brand', 'proposed_reference', 'proposed_price_raw', 'proposed_currency',
    'proposed_listing_type', 'proposed_dial_color',
  ], changed);
  await writeCsv(path.join(options.output, 'errors.csv'),
    ['source_index', 'source_record_id', 'error_name', 'error_message'], errors);
  sampleMemory();
  benchmark.total_runtime_seconds = Math.round(
    (Number(process.hrtime.bigint() - startedNs) / 1e9) * 1000,
  ) / 1000;
  benchmark.memory.peak_process_rss_bytes = peakRssBytes;
  benchmark.memory.peak_process_rss_mib = Math.round((peakRssBytes / 1024 / 1024) * 100) / 100;
  benchmark.memory.final_process = process.memoryUsage();
  benchmark.artifacts_completed_at = new Date().toISOString();
  atomicJson(path.join(options.output, 'benchmark.json'), benchmark);

  for (const required of REQUIRED_OUTPUTS) {
    if (!fs.existsSync(path.join(options.output, required))) {
      throw new Error(`Required output was not created: ${required}`);
    }
  }

  return { manifest, coverageReport, benchmark, reconciliation, blockers, outputDir: options.output };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBenchmark(options);
  process.stdout.write(`${JSON.stringify({
    event: 'normalization_benchmark_complete',
    output: report.outputDir,
    input_rows: report.reconciliation.input_rows,
    output_rows: report.reconciliation.output_rows,
    error_rows: report.reconciliation.error_rows,
    reconciled: report.reconciliation.reconciled,
    rows_per_second: report.benchmark.rows_per_second,
    workers: report.benchmark.workers,
    batch_size: report.benchmark.batch_size,
    watch_records_writes: 0,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'normalization_benchmark_error',
      error: error.message,
      watch_records_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_OUTPUTS,
  adaptArrayRow,
  adaptObjectRow,
  parseArgs,
  runBenchmark,
};
