'use strict';

// Read-only, resumable audit of the customer-facing Price Research contract.
// It deliberately calls the deployed API rather than reimplementing its gates.
const fs = require('node:fs');
const path = require('node:path');
const { listCatalogBrands, listCatalogReferences } = require('../../api/_lib/catalog');

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const PRIORITY_REFERENCES = [
  ['Patek Philippe', '5712/1A'],
  ['Patek Philippe', '5712/1R'],
  ['Patek Philippe', '3712/1A'],
  ['Patek Philippe', '4910/1200A-010'],
  ['Rolex', '116500LN'],
  ['Rolex', '52506'],
];
const CONDITIONS = ['All', 'New', 'Used', 'Unspecified'];

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : fallback;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function targetKey(target) {
  return [target.brand, target.reference, target.dial || '', target.condition || ''].join('|').toUpperCase();
}

function catalogTargets() {
  const all = [];
  for (const brand of listCatalogBrands()) {
    for (const item of listCatalogReferences(brand.brand)) {
      all.push({ brand: brand.brand, reference: item.reference });
    }
  }
  const unique = new Map(all.map(target => [targetKey(target), target]));
  const priority = PRIORITY_REFERENCES.map(([brand, reference]) => ({ brand, reference }));
  for (const target of priority) unique.delete(targetKey(target));
  return [...priority, ...unique.values()];
}

async function fetchJson(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
      const data = JSON.parse(text);
      if (data?.success === false) throw new Error(data.error || 'API returned unsuccessful response');
      return data;
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1_000 * attempt));
    }
  }
  throw new Error('unreachable');
}

function makeUrl(baseUrl, target) {
  const query = new URLSearchParams({ brand: target.brand, reference: target.reference });
  if (target.dial) query.set('dial', target.dial);
  if (target.condition) query.set('condition', target.condition);
  return `${baseUrl}/api/price-research?${query.toString()}`;
}

function auditResult(target, data, error = null) {
  if (error) return { ...target, status: 'REQUEST_ERROR', error: error.message };
  const count = Number(data.count || 0);
  const total = Number(data.totalListings || 0);
  const ready = data.analytics_ready === true;
  const issues = [];
  if (count > total) issues.push('INCLUDED_EXCEEDS_SELECTED_COHORT');
  if (ready !== (count >= 5)) issues.push('MINIMUM_SAMPLE_CONTRACT_MISMATCH');
  if (ready && !data.stats) issues.push('READY_WITHOUT_STATS');
  if (!ready && data.stats) issues.push('STATS_BELOW_MINIMUM');
  if (Number(data.outliersRemoved || 0) > Number(data.rawCount || 0)) issues.push('OUTLIER_COUNT_EXCEEDS_RAW_COUNT');
  const minimum = Number(data.stats?.min || 0);
  const maximum = Number(data.stats?.max || 0);
  const smallCohortHighSpread = count >= 5 && count < 10 && minimum > 0 && maximum / minimum >= 3;
  if (smallCohortHighSpread) issues.push('SMALL_COHORT_HIGH_SPREAD');
  return {
    ...target,
    status: issues.length ? 'ANALYTICAL_REVIEW' : 'OK',
    issues,
    selected_count: total,
    included_count: count,
    analytics_ready: ready,
    stats: data.stats || null,
    outliers_removed: Number(data.outliersRemoved || 0),
    excluded_evidence_count: Number(data.excludedEvidenceCount || 0),
    sample_capped: data.sampleCapped === true,
    currency_corrected_count: Number(data.currency_data_quality?.corrected_count || 0),
    bundle_parent_excluded_count: Number(data.bundle_data_quality?.unsplit_parent_excluded_count || 0),
    dial_completeness_percent: data.dial_data_quality?.completeness_percent ?? null,
    monthly_points: Array.isArray(data.monthly) ? data.monthly.length : 0,
    forecast_ready: data.forecast?.ready === true,
    forecast_reasons: data.forecast?.reasons || [],
    discovered_dials: (data.dial_groups || []).map(group => group.dial_color),
    error: null,
  };
}

function deriveCohortTargets(referenceResult) {
  const dials = referenceResult.discovered_dials || [];
  return dials.flatMap(dial => CONDITIONS.map(condition => ({
    brand: referenceResult.brand,
    reference: referenceResult.reference,
    dial,
    condition,
  })));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reportCsv(rows) {
  const columns = ['brand', 'reference', 'dial', 'condition', 'status', 'selected_count', 'included_count', 'analytics_ready', 'outliers_removed', 'excluded_evidence_count', 'sample_capped', 'currency_corrected_count', 'bundle_parent_excluded_count', 'monthly_points', 'forecast_ready', 'issues', 'error'];
  return `${[columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n')}\n`;
}

async function main() {
  const baseUrl = String(process.env.PRICE_RESEARCH_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const outputDir = path.resolve(process.env.PRICE_RESEARCH_ALL_AUDIT_OUTPUT || 'audit-output/price-research/all-cohorts');
  const limit = bounded('PRICE_RESEARCH_ALL_AUDIT_LIMIT', 25, 1, 50_000);
  const pauseMs = bounded('PRICE_RESEARCH_ALL_AUDIT_PAUSE_MS', 300, 0, 10_000);
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const reportPath = path.join(outputDir, 'report.json');
  const csvPath = path.join(outputDir, 'report.csv');
  const previous = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : { rows: [], reference_discovery_complete: [] };
  const done = new Set((previous.rows || []).map(targetKey));
  const referenceDiscoveryDone = new Set(previous.reference_discovery_complete || []);
  const rows = previous.rows || [];
  let processed = 0;

  const references = catalogTargets();
  for (const referenceTarget of references) {
    if (processed >= limit) break;
    const referenceKey = targetKey(referenceTarget);
    let referenceResult = rows.find(row => targetKey(row) === referenceKey);
    if (!referenceResult) {
      try {
        referenceResult = auditResult(referenceTarget, await fetchJson(makeUrl(baseUrl, referenceTarget)));
      } catch (error) {
        referenceResult = auditResult(referenceTarget, null, error);
      }
      rows.push(referenceResult);
      done.add(referenceKey);
      processed += 1;
      if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
    }
    if (referenceResult.status === 'REQUEST_ERROR' || referenceDiscoveryDone.has(referenceKey)) continue;

    let completedReference = true;
    for (const cohortTarget of deriveCohortTargets(referenceResult)) {
      if (processed >= limit) break;
      const key = targetKey(cohortTarget);
      if (done.has(key)) continue;
      try {
        rows.push(auditResult(cohortTarget, await fetchJson(makeUrl(baseUrl, cohortTarget))));
      } catch (error) {
        rows.push(auditResult(cohortTarget, null, error));
      }
      done.add(key);
      processed += 1;
      if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
    }
    if (deriveCohortTargets(referenceResult).every(target => done.has(targetKey(target)))) {
      referenceDiscoveryDone.add(referenceKey);
    } else {
      completedReference = false;
    }
    atomicJson(checkpointPath, { updated_at: new Date().toISOString(), base_url: baseUrl, catalog_reference_count: references.length, processed_this_run: processed, reference_discovery_complete: [...referenceDiscoveryDone], rows });
    if (!completedReference) break;
  }

  const summary = {
    generated_at: new Date().toISOString(),
    read_only: true,
    base_url: baseUrl,
    catalog_reference_count: references.length,
    processed_this_run: processed,
    audited_targets: rows.length,
    status_counts: rows.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}),
    analytical_review_count: rows.filter(row => row.status === 'ANALYTICAL_REVIEW').length,
    request_error_count: rows.filter(row => row.status === 'REQUEST_ERROR').length,
    ready_cohort_count: rows.filter(row => row.analytics_ready).length,
    sample_capped_count: rows.filter(row => row.sample_capped).length,
    watch_records_mutated: false,
    rows,
  };
  atomicJson(checkpointPath, { ...summary, reference_discovery_complete: [...referenceDiscoveryDone] });
  atomicJson(reportPath, summary);
  fs.writeFileSync(csvPath, reportCsv(rows));
  process.stdout.write(`${JSON.stringify({ event: 'all_price_research_audit_complete', ...summary, rows: undefined })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'all_price_research_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { PRIORITY_REFERENCES, CONDITIONS, auditResult, catalogTargets, deriveCohortTargets, targetKey };
