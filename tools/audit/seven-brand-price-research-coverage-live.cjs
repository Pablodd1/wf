#!/usr/bin/env node
'use strict';

// Read-only, resumable census of the customer-visible Price Research contract.
// Catalog discovery uses the deployed browse APIs. Market coverage uses the
// bounded batch-summary API (24 exact references per request) with one request
// in flight, a pause between batches, and retries limited to failed batches.

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
const BATCH_SIZE = 24;

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

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
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
  const brands = String(process.env.SEVEN_BRAND_AUDIT_BRANDS || DEFAULT_BRANDS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const reportPath = path.join(outputDir, 'report.json');
  const previous = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { rows: [], failed_batches: [] };
  const completed = new Map((previous.rows || []).map(row => [row.key, row]));
  const catalog = await discoverCatalog(baseUrl, brands);
  const pending = catalog.references.filter(row => !completed.has(row.key));
  let processedBatches = 0;
  const failedBatches = [];

  for (let offset = 0; offset < pending.length && processedBatches < maxBatches; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    try {
      const payload = await loadBatch(baseUrl, batch);
      const byKey = new Map((payload.summaries || []).map(summary => [referenceKey(summary.brand, summary.reference), summary]));
      for (const target of batch) {
        const summary = byKey.get(target.key);
        completed.set(target.key, summary
          ? { ...target, ...summary, key: target.key }
          : { ...target, error: 'SUMMARY_NOT_RETURNED' });
      }
    } catch (error) {
      failedBatches.push({ keys: batch.map(row => row.key), error: error.message });
    }
    processedBatches += 1;
    const rows = catalog.references.map(target => completed.get(target.key)).filter(Boolean);
    atomicJson(checkpointPath, {
      generated_at: new Date().toISOString(),
      read_only: true,
      base_url: baseUrl,
      brands,
      catalog_reference_count: catalog.references.length,
      processed_batches_this_run: processedBatches,
      completed_reference_count: rows.length,
      failed_batches: failedBatches,
      rows,
    });
    process.stdout.write(`${JSON.stringify({ event: 'seven_brand_batch', processedBatches, completed: rows.length, total: catalog.references.length, failed: failedBatches.length })}\n`);
    if (offset + BATCH_SIZE < pending.length) await sleep(pauseMs);
  }

  const rows = catalog.references.map(target => completed.get(target.key)).filter(Boolean);
  const report = {
    contract: 'watchfacts-seven-brand-live-price-research-coverage-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    customer_api_writes: 0,
    base_url: baseUrl,
    brands,
    catalog_reference_count: catalog.references.length,
    completed_reference_count: rows.length,
    incomplete_reference_count: catalog.references.length - rows.length,
    catalog_identity_conflicts: catalog.conflicts,
    advertised_catalog: catalog.brandSummaries,
    brand_summary: groupSummary(rows, 'brand'),
    model_summary: groupSummary(rows, 'model'),
    failed_batches: failedBatches,
    checksums: {
      catalog_references_sha256: sha256(catalog.references.map(row => row.key).sort().join('\n')),
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
  process.stdout.write(`${JSON.stringify({ event: 'seven_brand_coverage_complete', report: reportPath, references: rows.length, incomplete: report.incomplete_reference_count, failed_batches: failedBatches.length })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { BATCH_SIZE, DEFAULT_BRANDS, groupSummary, referenceKey };
