#!/usr/bin/env node
'use strict';

// Read-only reconciliation of the deployed Price Research browse catalog with
// previously audited exact-reference rows. No customer data or raw messages are read.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = (process.env.SEVEN_BRAND_BASE_URL || 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
const BRANDS = ['Tudor', 'Cartier', 'TAG Heuer', 'Patek Philippe', 'Rolex', 'Zenith', 'Omega'];
const INPUTS = [
  'audit-output/seven-brand-price-research-coverage/checkpoint.json',
  'audit-output/zenith-omega-price-research-coverage/report.json',
];
const OUTPUT = 'audit-output/seven-brand-price-research-coverage/reconciled-report.json';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeReference(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function key(brand, reference) {
  return `${String(brand || '').trim().toUpperCase()}|${normalizeReference(reference)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'watchfacts-price-research-reconciler/1.0' },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text);
}

async function discoverCatalog() {
  const references = new Map();
  const summaries = [];
  for (const brand of BRANDS) {
    const modelsPayload = await fetchJson(`${BASE_URL}/api/catalog-models?brand=${encodeURIComponent(brand)}`);
    const models = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
    let count = 0;
    for (const modelRow of models) {
      const model = String(modelRow?.model || modelRow || '').trim();
      if (!model) continue;
      const payload = await fetchJson(`${BASE_URL}/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`);
      for (const row of payload.references || []) {
        const reference = String(row?.reference || row || '').trim();
        if (!reference) continue;
        references.set(key(brand, reference), { brand, model, reference });
        count += 1;
      }
    }
    summaries.push({ brand, models: models.length, references: count });
  }
  return { references, summaries };
}

async function main() {
  const audited = new Map();
  for (const input of INPUTS) {
    const document = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
    for (const row of document.rows || []) {
      if (!row?.error && row?.brand && row?.reference) audited.set(key(row.brand, row.reference), row);
    }
  }

  const catalog = await discoverCatalog();
  const catalogKeys = [...catalog.references.keys()].sort();
  const auditedKeys = [...audited.keys()].sort();
  const missingAudit = catalogKeys.filter(value => !audited.has(value));
  const auditedOutsideCatalog = auditedKeys.filter(value => !catalog.references.has(value));
  const rows = catalogKeys.map(value => audited.get(value)).filter(Boolean);
  const brandSummary = BRANDS.map(brand => {
    const selected = rows.filter(row => row.brand === brand);
    return {
      brand,
      catalog_references: catalogKeys.filter(value => value.startsWith(`${brand.toUpperCase()}|`)).length,
      audited_references: selected.length,
      references_with_observations: selected.filter(row => Number(row.source_observation_count || 0) > 0).length,
      references_with_wts: selected.filter(row => Number(row.wts_observation_count || 0) > 0).length,
      references_with_qualified_wts: selected.filter(row => Number(row.reference_qualified_wts_count || 0) > 0).length,
      references_analytics_ready: selected.filter(row => row.reference_analytics_ready === true).length,
      references_without_observations: selected.filter(row => Number(row.source_observation_count || 0) === 0).length,
    };
  });

  const report = {
    contract: 'watchfacts-seven-brand-price-research-reconciliation-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    customer_api_writes: 0,
    base_url: BASE_URL,
    snapshot_complete: missingAudit.length === 0,
    catalog_reference_count: catalogKeys.length,
    audited_reference_count: rows.length,
    catalog_references_missing_audit: missingAudit,
    audited_references_outside_catalog: auditedOutsideCatalog,
    advertised_catalog: catalog.summaries,
    brand_summary: brandSummary,
    checksums: {
      catalog_references_sha256: sha256(catalogKeys.join('\n')),
      audited_result_rows_sha256: sha256(rows.map(row => JSON.stringify(row)).sort().join('\n')),
    },
  };
  const outputPath = path.resolve(OUTPUT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, snapshot_complete: report.snapshot_complete, catalog_references: catalogKeys.length, audited_references: rows.length, missing: missingAudit.length, outside_catalog: auditedOutsideCatalog.length })}\n`);
  if (!report.snapshot_complete) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ read_only: true, error: error.message })}\n`);
  process.exitCode = 1;
});
