'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const JOHN_COHORTS = [
  { brand: 'Patek Philippe', reference: '5712/1A', dial: 'Blue', condition: 'Used' },
  { brand: 'Patek Philippe', reference: '5712/1R', dial: 'Black', condition: 'Used' },
  { brand: 'Patek Philippe', reference: '3712/1A', dial: 'Blue', condition: 'Used' },
  { brand: 'Rolex', reference: '116500LN', dial: 'White', condition: 'Used' },
  { brand: 'Rolex', reference: '52506', dial: 'Blue', condition: 'New' },
];

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportCsv(rows) {
  const headings = [
    'sample_group', 'brand', 'reference', 'dial', 'condition', 'http_ok',
    'included_offers', 'verified_dealers', 'monthly_periods', 'forecast_ready',
    'withholding_reasons', 'release_candidate', 'sample_capped', 'error',
  ];
  return `${[headings.join(','), ...rows.map(row => [
    row.sample_group, row.brand, row.reference, row.dial, row.condition,
    row.http_ok, row.included_offers, row.verified_dealers, row.monthly_periods,
    row.forecast_ready, row.withholding_reasons, row.release_candidate,
    row.sample_capped, row.error,
  ].map(csvCell).join(','))].join('\n')}\n`;
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      const data = JSON.parse(text);
      if (data?.error && data?.success === false) throw new Error(data.error);
      return data;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * (2 ** (attempt - 1))));
    }
  }
  throw new Error('unreachable');
}

function quantileSample(rows, count) {
  if (rows.length <= count) return rows;
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (rows.length - 1)) / (count - 1));
    result.push(rows[position]);
  }
  return [...new Map(result.map(row => [row.reference, row])).values()];
}

function chooseCondition(cohorts, dial) {
  const dialKey = String(dial || '').trim().toLowerCase();
  return (cohorts || [])
    .filter(cohort => String(cohort.dial_color || '').trim().toLowerCase() === dialKey)
    .filter(cohort => ['new', 'used'].includes(String(cohort.condition || '').trim().toLowerCase()))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0]?.condition || null;
}

async function mapConcurrent(items, concurrency, worker, onResult = null) {
  const output = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
      if (onResult) onResult(output.filter(Boolean));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return output;
}

async function discoverReferences(baseUrl) {
  const catalog = await fetchJson(`${baseUrl}/api/catalog-brands`);
  const brands = catalog.brands || [];
  // Use listing-rich brands for the fixed-size validation cohort. Small-brand
  // coverage has a separate QA report; including empty catalog groups here
  // previously produced only 30 of the required 50 references.
  const selectedBrands = brands.slice(0, 16);
  const byBrand = await mapConcurrent(selectedBrands, 4, async brandRow => {
    const models = await fetchJson(`${baseUrl}/api/catalog-models?brand=${encodeURIComponent(brandRow.brand)}`);
    const referenceRows = [];
    for (const model of (models.models || []).slice(0, 12)) {
      const payload = await fetchJson(`${baseUrl}/api/catalog-references?brand=${encodeURIComponent(brandRow.brand)}&model=${encodeURIComponent(model.model)}`);
      referenceRows.push(...(payload.references || []).map(row => ({ ...row, brand: brandRow.brand })));
      if (referenceRows.length >= 25) break;
    }
    const unique = [...new Map(referenceRows.map(row => [String(row.reference).toUpperCase(), row])).values()]
      .filter(row => Number(row.listing_count || 0) >= 5)
      .sort((a, b) => Number(b.listing_count || 0) - Number(a.listing_count || 0));
    return quantileSample(unique, 5);
  });
  return byBrand.flat().slice(0, 50);
}

async function auditCohort(baseUrl, cohort, sampleGroup) {
  try {
    let condition = cohort.condition || null;
    const dial = cohort.dial || cohort.dial_colors?.[0]?.dial_color || null;
    if (!dial) throw new Error('NO_KNOWN_DIAL_COHORT');
    if (!condition) {
      const discoveryUrl = `${baseUrl}/api/price-research?reference=${encodeURIComponent(cohort.reference)}&brand=${encodeURIComponent(cohort.brand)}&dial=${encodeURIComponent(dial)}`;
      const discovery = await fetchJson(discoveryUrl);
      condition = chooseCondition(discovery.cohorts, dial);
      if (!condition) throw new Error('NO_NEW_OR_USED_COHORT');
    }
    const url = `${baseUrl}/api/price-research?reference=${encodeURIComponent(cohort.reference)}&brand=${encodeURIComponent(cohort.brand)}&dial=${encodeURIComponent(dial)}&condition=${encodeURIComponent(condition)}`;
    const result = await fetchJson(url);
    const forecast = result.forecast || {};
    return {
      sample_group: sampleGroup,
      brand: cohort.brand,
      reference: cohort.reference,
      dial,
      condition,
      http_ok: true,
      included_offers: Number(forecast.offer_count || result.count || 0),
      verified_dealers: Number(forecast.verified_dealer_count || 0),
      monthly_periods: Array.isArray(forecast.monthly) ? forecast.monthly.length : 0,
      forecast_ready: forecast.ready === true,
      withholding_reasons: forecast.reasons || [],
      release_candidate: forecast.release_candidate === true,
      sample_capped: result.sampleCapped === true,
      error: null,
    };
  } catch (error) {
    return {
      sample_group: sampleGroup,
      brand: cohort.brand,
      reference: cohort.reference,
      dial: cohort.dial || cohort.dial_colors?.[0]?.dial_color || null,
      condition: cohort.condition || null,
      http_ok: false,
      included_offers: 0,
      verified_dealers: 0,
      monthly_periods: 0,
      forecast_ready: false,
      withholding_reasons: [],
      release_candidate: false,
      sample_capped: false,
      error: error.message,
    };
  }
}

async function main() {
  const baseUrl = String(process.env.PRICE_RESEARCH_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const outputDir = path.resolve(process.env.FORECAST_AUDIT_OUTPUT_DIR || 'audit-output/forecast-readiness/live-50-reference');
  const concurrency = Math.max(1, Math.min(Number(process.env.FORECAST_AUDIT_CONCURRENCY || 2), 4));
  fs.mkdirSync(outputDir, { recursive: true });
  const stratified = await discoverReferences(baseUrl);
  const targets = [
    ...JOHN_COHORTS.map(row => ({ ...row, sample_group: 'JOHN_REFERENCE' })),
    ...stratified.map(row => ({ ...row, sample_group: 'STRATIFIED_REFERENCE' })),
  ];
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const rows = await mapConcurrent(
    targets,
    concurrency,
    (row) => auditCohort(baseUrl, row, row.sample_group),
    completedRows => atomicJson(checkpointPath, {
      updated_at: new Date().toISOString(),
      base_url: baseUrl,
      completed: completedRows.length,
      total: targets.length,
      rows: completedRows,
    }),
  );
  const reasons = new Map();
  for (const row of rows) {
    for (const reason of row.withholding_reasons) reasons.set(reason, (reasons.get(reason) || 0) + 1);
    if (row.error) reasons.set(row.error, (reasons.get(row.error) || 0) + 1);
  }
  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    john_reference_count: rows.filter(row => row.sample_group === 'JOHN_REFERENCE').length,
    stratified_reference_count: rows.filter(row => row.sample_group === 'STRATIFIED_REFERENCE').length,
    successful_requests: rows.filter(row => row.http_ok).length,
    forecast_ready_count: rows.filter(row => row.forecast_ready).length,
    release_candidate_count: rows.filter(row => row.release_candidate).length,
    withholding_reason_counts: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
    public_forecast_release_recommended: false,
    rows,
  };
  atomicJson(path.join(outputDir, 'report.json'), report);
  fs.writeFileSync(path.join(outputDir, 'review.csv'), reportCsv(rows));
  process.stdout.write(`${JSON.stringify({ event: 'forecast_readiness_audit_complete', ...report, rows: undefined }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'forecast_readiness_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { JOHN_COHORTS, chooseCondition, quantileSample, reportCsv };
