#!/usr/bin/env node
'use strict';

// Read-only, resumable census of the customer-visible Price Research contract.
// Catalog discovery uses the deployed browse APIs. Market coverage uses the
// bounded batch-summary API with one request in flight, adaptive subdivision,
// durable failures, and resumable catalog checksums.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const DEFAULT_BRANDS = [
  'Tudor',
  'Cartier',
  'TAG Heuer',
  'Patek Philippe',
  'Rolex',
  'Zenith',
  'Omega',
];
const BATCH_SIZE = 4;
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.SEVEN_BRAND_FETCH_TIMEOUT_MS || 60_000));
const FETCH_ATTEMPTS = Math.max(1, Number(process.env.SEVEN_BRAND_FETCH_ATTEMPTS || 3));

function bounded(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function referenceKey(brand, reference) {
  return `${String(brand).trim().toUpperCase()}|${String(reference).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

async function fetchJson(url, options = {}, attempts = FETCH_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
  }
  throw lastError;
}

async function discoverCatalog(baseUrl, brands) {
  const references = new Map();
  const conflicts = [];
  const brandSummaries = [];
  for (const brand of brands) {
    const modelsPayload = await fetchJson(`${baseUrl}/api/catalog-models?brand=${encodeURIComponent(brand)}`);
    const models = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
    for (const modelRow of models) {
      const model = String(modelRow.model || '').trim();
      if (!model) continue;
      const payload = await fetchJson(`${baseUrl}/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`);
      for (const row of payload.references || []) {
        const reference = String(row.reference || '').trim();
        if (!reference) continue;
        const key = referenceKey(brand, reference);
        const existing = references.get(key);
        if (existing && existing.model !== model) {
          conflicts.push({ brand, reference, models: [...new Set([existing.model, model])].sort() });
          continue;
        }
        references.set(key, { key, brand, model, reference });
      }
    }
    brandSummaries.push({
      brand,
      advertised_model_count: Number(modelsPayload.model_count || models.length),
      advertised_reference_count: Number(modelsPayload.catalog_reference_count || 0),
    });
  }
  return { references: [...references.values()], conflicts, brandSummaries };
}

async function loadBatch(baseUrl, batch) {
  return fetchJson(`${baseUrl}/api/price-research-batch-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairs: batch.map(({ brand, reference }) => ({ brand, reference })) }),
  });
}

function requireCompleteBatch(payload, batch) {
  const returnedKeys = new Set((payload.summaries || [])
    .map(summary => referenceKey(summary.brand, summary.reference)));
  const missing = batch.filter(target => !returnedKeys.has(target.key));
  if (missing.length) throw new Error(`SUMMARY_NOT_RETURNED: ${missing.map(target => target.key).join(',')}`);
  return payload;
}

async function loadBatchAdaptive(batch, load, options = {}) {
  const onSuccess = options.onSuccess || (() => {});
  const onFailure = options.onFailure || (() => {});
  const canAttempt = options.canAttempt || (() => true);
  const onAttempt = options.onAttempt || (() => {});
  if (!batch.length || !canAttempt()) return;
  onAttempt(batch);
  try {
    const payload = await load(batch);
    onSuccess(batch, payload);
  } catch (error) {
    if (batch.length > 1 && canAttempt()) {
      const midpoint = Math.ceil(batch.length / 2);
      await loadBatchAdaptive(batch.slice(0, midpoint), load, options);
      await loadBatchAdaptive(batch.slice(midpoint), load, options);
      return;
    }
    onFailure(batch, error);
  }
}

function groupSummary(rows, keyName) {
  const groups = new Map();
  for (const row of rows) {
    const groupKey = keyName === 'brand' ? row.brand : `${row.brand}|${row.model}`;
    const current = groups.get(groupKey) || {
      brand: row.brand,
      ...(keyName === 'model' ? { model: row.model } : {}),
      catalog_references: 0,
      references_with_observations: 0,
      references_with_wts: 0,
      references_with_qualified_wts: 0,
      references_analytics_ready: 0,
      references_without_observations: 0,
      bounded_source_observations: 0,
      bounded_wts_observations: 0,
      bounded_wtb_observations: 0,
      capped_references: 0,
      failed_references: 0,
    };
    current.catalog_references += 1;
    if (row.error) current.failed_references += 1;
    else if (Number(row.source_observation_count || 0) > 0) current.references_with_observations += 1;
    else current.references_without_observations += 1;
    if (Number(row.wts_observation_count || 0) > 0) current.references_with_wts += 1;
    if (Number(row.reference_qualified_wts_count || 0) > 0) current.references_with_qualified_wts += 1;
    if (row.reference_analytics_ready === true) current.references_analytics_ready += 1;
    current.bounded_source_observations += Number(row.source_observation_count || 0);
    current.bounded_wts_observations += Number(row.wts_observation_count || 0);
    current.bounded_wtb_observations += Number(row.wtb_observation_count || 0);
    if (row.sample_capped === true) current.capped_references += 1;
    groups.set(groupKey, current);
  }
  return [...groups.values()].sort((a, b) => a.brand.localeCompare(b.brand)
    || String(a.model || '').localeCompare(String(b.model || '')));
}

async function main() {
  const baseUrl = String(process.env.SEVEN_BRAND_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const outputDir = path.resolve(process.env.SEVEN_BRAND_COVERAGE_OUTPUT || 'audit-output/seven-brand-price-research-coverage');
  const pauseMs = bounded('SEVEN_BRAND_BATCH_PAUSE_MS', 750, 250, 10_000);
  const maxBatches = bounded('SEVEN_BRAND_MAX_BATCHES', 10_000, 1, 10_000);
  const requestConcurrency = bounded('SEVEN_BRAND_REQUEST_CONCURRENCY', 1, 1, 2);
  const brands = String(process.env.SEVEN_BRAND_AUDIT_BRANDS || DEFAULT_BRANDS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const reportPath = path.join(outputDir, 'report.json');
  const previous = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { rows: [], failed_batches: [] };
  const catalog = await discoverCatalog(baseUrl, brands);
  const catalogChecksum = sha256(catalog.references
    .map(row => `${row.key}|${row.model || ''}`)
    .sort().join('\n'));
  const currentKeys = new Set(catalog.references.map(row => row.key));
  const previousCatalogChecksum = previous.catalog_references_sha256
    || previous.checksums?.catalog_references_sha256
    || null;
  const catalogChanged = Boolean(previousCatalogChecksum && previousCatalogChecksum !== catalogChecksum);
  const resumePrevious = !catalogChanged && previous.snapshot_complete !== true;
  const censusRunId = resumePrevious && previous.census_run_id
    ? previous.census_run_id
    : crypto.randomUUID();
  const censusStartedAt = resumePrevious && previous.census_started_at
    ? previous.census_started_at
    : new Date().toISOString();
  const completed = new Map((resumePrevious ? previous.rows || [] : [])
    .filter(row => currentKeys.has(row.key) && !row.error)
    .map(row => [row.key, row]));
  const previouslyFailedKeys = new Set((resumePrevious ? previous.failed_batches || [] : []).flatMap(batch => batch.keys || []));
  const pending = catalog.references
    .filter(row => !completed.has(row.key))
    .sort((left, right) => Number(previouslyFailedKeys.has(right.key)) - Number(previouslyFailedKeys.has(left.key)));
  let processedBatches = 0;
  const failureHistory = resumePrevious
    ? (Array.isArray(previous.failure_history)
      ? [...previous.failure_history]
      : (previous.failed_batches || []).map(batch => ({ ...batch, carried_from_previous_checkpoint: true })))
    : [];
  const unresolvedFailures = new Map((resumePrevious ? previous.failed_batches || [] : [])
    .flatMap(batch => (batch.keys || []).map(key => [key, { ...batch, keys: [key] }]))
    .filter(([key]) => currentKeys.has(key) && !completed.has(key)));

  const saveCheckpoint = () => {
    const rows = catalog.references.map(target => completed.get(target.key)).filter(Boolean);
    atomicJson(checkpointPath, {
      generated_at: new Date().toISOString(),
      read_only: true,
      base_url: baseUrl,
      brands,
      census_run_id: censusRunId,
      census_started_at: censusStartedAt,
      catalog_reference_count: catalog.references.length,
      catalog_references_sha256: catalogChecksum,
      previous_catalog_references_sha256: previousCatalogChecksum,
      catalog_changed_since_checkpoint: catalogChanged,
      processed_batches_this_run: processedBatches,
      request_concurrency: requestConcurrency,
      completed_reference_count: rows.length,
      unattempted_reference_count: catalog.references.length - rows.length - unresolvedFailures.size,
      failed_batches: [...unresolvedFailures.values()],
      failure_history: failureHistory,
      rows,
    });
    return rows;
  };

  let nextOffset = 0;
  const runWorker = async () => {
    while (nextOffset < pending.length && processedBatches < maxBatches) {
      const offset = nextOffset;
      nextOffset += BATCH_SIZE;
      const batch = pending.slice(offset, offset + BATCH_SIZE);
      await loadBatchAdaptive(batch, async current => {
        const payload = await loadBatch(baseUrl, current);
        return requireCompleteBatch(payload, current);
      }, {
        canAttempt: () => processedBatches < maxBatches,
        onAttempt: () => { processedBatches += 1; },
        onSuccess: (targets, payload) => {
          const byKey = new Map((payload.summaries || []).map(summary => [referenceKey(summary.brand, summary.reference), summary]));
          for (const target of targets) {
            const summary = byKey.get(target.key);
            if (summary) {
              completed.set(target.key, { ...target, ...summary, key: target.key, observed_at: new Date().toISOString() });
              unresolvedFailures.delete(target.key);
            } else {
              const failure = { keys: [target.key], error: 'SUMMARY_NOT_RETURNED', at: new Date().toISOString() };
              unresolvedFailures.set(target.key, failure);
              failureHistory.push(failure);
            }
          }
        },
        onFailure: (targets, error) => {
          for (const target of targets) {
            const failure = { keys: [target.key], error: error.message, at: new Date().toISOString() };
            unresolvedFailures.set(target.key, failure);
            failureHistory.push(failure);
          }
        },
      });
      const rows = saveCheckpoint();
      process.stdout.write(`${JSON.stringify({ event: 'seven_brand_batch', processedBatches, completed: rows.length, total: catalog.references.length, failed: unresolvedFailures.size })}\n`);
      if (nextOffset < pending.length) await sleep(pauseMs);
    }
  };
  await Promise.all(Array.from({ length: requestConcurrency }, runWorker));

  const rows = catalog.references.map(target => completed.get(target.key)).filter(Boolean);
  const report = {
    contract: 'watchfacts-seven-brand-live-price-research-coverage-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    customer_api_writes: 0,
    base_url: baseUrl,
    brands,
    request_concurrency: requestConcurrency,
    census_run_id: censusRunId,
    census_started_at: censusStartedAt,
    catalog_reference_count: catalog.references.length,
    completed_reference_count: rows.length,
    incomplete_reference_count: catalog.references.length - rows.length,
    unattempted_reference_count: catalog.references.length - rows.length - unresolvedFailures.size,
    coverage_accounting_reconciles: rows.length + unresolvedFailures.size
      + (catalog.references.length - rows.length - unresolvedFailures.size) === catalog.references.length,
    snapshot_complete: rows.length === catalog.references.length && unresolvedFailures.size === 0,
    snapshot_observed_at_min: rows.map(row => row.observed_at).filter(Boolean).sort()[0] || null,
    snapshot_observed_at_max: rows.map(row => row.observed_at).filter(Boolean).sort().at(-1) || null,
    catalog_identity_conflicts: catalog.conflicts,
    advertised_catalog: catalog.brandSummaries,
    brand_summary: groupSummary(rows, 'brand'),
    model_summary: groupSummary(rows, 'model'),
    failed_batches: [...unresolvedFailures.values()],
    failure_history: failureHistory,
    checksums: {
      catalog_references_sha256: catalogChecksum,
      completed_rows_sha256: sha256(rows.map(row => `${row.key}|${row.source_observation_count || 0}|${row.reference_qualified_wts_count || 0}`).sort().join('\n')),
    },
    count_semantics: {
      catalog_references: 'Exact references discoverable through the deployed Price Research browse contract.',
      references_with_observations: 'References for which the bounded exact-reference summary returned at least one WTS or WTB observation.',
      references_with_qualified_wts: 'References with at least one source-backed WTS row passing the Price Research identity, price and currency gates before minimum-sample analytics.',
      bounded_source_observations: 'Bounded API observations; capped references are identified and this is not an uncapped inventory census.',
    },
    rows,
  };
  atomicJson(checkpointPath, report);
  atomicJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ event: report.snapshot_complete ? 'seven_brand_coverage_complete' : 'seven_brand_coverage_incomplete', report: reportPath, references: rows.length, incomplete: report.incomplete_reference_count, failed_batches: report.failed_batches.length })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { BATCH_SIZE, DEFAULT_BRANDS, groupSummary, loadBatchAdaptive, referenceKey, requireCompleteBatch };
