'use strict';

// Read-only trace from a public Price Research cohort back to immutable source rows.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeMarketRow, referenceBlock } = require('../../api/_lib/market-row-normalization.cjs');
const { deterministicCandidateCount } = require('../../api/_lib/unsplit-bundle-filter.cjs');

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cohortUrl(baseUrl, { brand, reference, dial, condition }) {
  const query = new URLSearchParams({ brand, reference, dial, condition });
  return `${baseUrl}/api/price-research?${query.toString()}`;
}

function classifyCohortRow(row, reference) {
  const normalized = normalizeMarketRow(row, reference);
  const line = referenceBlock(row.raw_message, reference);
  const candidateCount = deterministicCandidateCount(row);
  const issues = [];
  if (!line) issues.push('REFERENCE_LINE_NOT_FOUND');
  if (candidateCount > 1) issues.push('MULTILISTING_OR_BUNDLE_SOURCE');
  if (normalized.analytics_currency_status !== 'VERIFIED') issues.push(normalized.analytics_currency_status || 'CURRENCY_UNVERIFIED');
  if (Number(normalized.analytics_price_usd) !== Number(row.api_price_usd)) issues.push('API_PRICE_DIFFERENT_FROM_RECOMPUTED_SOURCE_LINE');
  return {
    id: row.id,
    api_price_usd: row.api_price_usd,
    stored_price_usd: row.price_usd ?? null,
    derived_price_usd: normalized.analytics_price_usd ?? null,
    price_normalization: normalized.price_normalization || null,
    currency_status: normalized.analytics_currency_status || null,
    candidate_count: candidateCount,
    issue_count: issues.length,
    issues,
    reference_line: line,
    raw_message: row.raw_message || '',
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main() {
  const baseUrl = String(process.env.PRICE_RESEARCH_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const target = {
    brand: required('PRICE_COHORT_BRAND'),
    reference: required('PRICE_COHORT_REFERENCE'),
    dial: required('PRICE_COHORT_DIAL'),
    condition: required('PRICE_COHORT_CONDITION'),
  };
  const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const outputPath = path.resolve(process.env.PRICE_COHORT_OUTPUT || `audit-output/price-research/${target.reference.replace(/[^A-Za-z0-9]+/g, '-')}-${target.dial}-${target.condition}.json`);

  const api = await fetchJson(cohortUrl(baseUrl, target));
  const apiRows = api.rows || [];
  const ids = apiRows.map(row => row.id).filter(Boolean);
  if (!ids.length) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), read_only: true, target, api_summary: api, rows: [], watch_records_mutated: false }, null, 2)}\n`);
    return;
  }
  const params = new URLSearchParams({
    select: 'id,raw_message,price_usd,currency,reference,brand,dial_color,condition,listing_type,flags,listing_status,verdict',
    id: `in.(${ids.join(',')})`,
  });
  const sourceRows = await fetchJson(`${supabaseUrl}/rest/v1/watch_records?${params.toString()}`, {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
  const apiPriceById = new Map(apiRows.map(row => [row.id, row.price_usd]));
  const rows = sourceRows.map(row => classifyCohortRow({ ...row, api_price_usd: apiPriceById.get(row.id) }, target.reference));
  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    target,
    api_summary: {
      included_count: api.count,
      total_listings: api.totalListings,
      stats: api.stats,
      sample_capped: api.sampleCapped,
      outliers_removed: api.outliersRemoved,
    },
    source_rows_returned: sourceRows.length,
    issue_counts: rows.reduce((counts, row) => {
      for (const issue of row.issues) counts[issue] = (counts[issue] || 0) + 1;
      return counts;
    }, {}),
    rows,
    watch_records_mutated: false,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'live_price_cohort_inspection_complete', outputPath, target, sourceRows: sourceRows.length, issueCounts: report.issue_counts, watchRecordsMutated: false })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'live_price_cohort_inspection_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { classifyCohortRow, cohortUrl };
