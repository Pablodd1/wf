'use strict';

/**
 * Read-only, customer-safe evidence collector for the Watch Listing Data
 * Integrity & Display Audit. It performs GET requests only and prints a
 * sanitized JSON summary to stdout. It never writes files or database rows.
 */

const { multiItemRisk } = require('../../api/_lib/unsplit-bundle-filter.cjs');

const ORIGIN = String(process.env.WATCHFACTS_AUDIT_ORIGIN || 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
const BRANDS = ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'];
const REFERENCES = [
  ['Rolex', '116500LN'],
  ['Patek Philippe', '5712/1A'],
  ['Audemars Piguet', '26470ST.OO.A028CR.01'],
  ['Richard Mille', 'RM030TI'],
  ['Cartier', 'WSSA0032'],
  ['Zenith', '49.9010.9004/01.R947'],
  ['Zenith', '03.2522.400'],
];

async function get(path) {
  const started = Date.now();
  const response = await fetch(`${ORIGIN}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'watch-listing-integrity-audit/1.0' },
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, elapsed_ms: Date.now() - started, body };
}

function imageCount(row) {
  if (Array.isArray(row?.image_urls)) return row.image_urls.filter(Boolean).length;
  return row?.thumbnail_url || row?.image_url ? 1 : 0;
}

function fieldCoverage(rows) {
  const count = key => rows.filter(row => row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== '').length;
  return {
    rows: rows.length,
    brand: count('brand'), model: count('model'), reference: count('reference'), dial: count('dial_color'),
    condition: count('condition'), raw_message: count('raw_message'), listing_date: count('listing_date'),
    seller_name: count('seller_name'), dealer_id: count('dealer_id'), location: count('location'),
    priced_usd: rows.filter(row => Number(row?.price_usd) > 0).length,
    wts: rows.filter(row => String(row?.listing_type).toUpperCase() === 'WTS').length,
    wtb: rows.filter(row => String(row?.listing_type).toUpperCase() === 'WTB').length,
    image_zero: rows.filter(row => imageCount(row) === 0).length,
    image_one: rows.filter(row => imageCount(row) === 1).length,
    image_multiple: rows.filter(row => imageCount(row) > 1).length,
    rated: rows.filter(row => ['SOURCE_SUPPLIED', 'SOURCE_FEEDBACK_COUNT'].includes(row?.seller_rating_evidence_status)).length,
    contact_approved: rows.filter(row => row?.contact_publication_approved === true).length,
    source_record_id: count('source_record_id'),
    source_group_id: count('source_group_id'),
    source_message_id: count('source_message_id'),
    raw_message_version_id: count('raw_message_version_id'),
    structured_multi: rows.filter(row => row?.multi_listing || row?.is_bundle || row?.is_unbundled_child || row?.parent_id).length,
    raw_multi_risk: rows.filter(row => multiItemRisk(row?.raw_message || '').isMultiItem).length,
  };
}

async function collectBrandPages(brand) {
  const rows = [];
  const pageEvidence = [];
  let cursor = null;
  for (let page = 1; page <= 2; page += 1) {
    const params = new URLSearchParams({ brand, item: 'watches', pageSize: '50', pagination: 'cursor' });
    if (cursor) params.set('cursor', cursor);
    const response = await get(`/api/reviewed-market-inventory?${params}`);
    const pageRows = response.body?.records || [];
    rows.push(...pageRows);
    pageEvidence.push({ page, http: response.status, elapsed_ms: response.elapsed_ms, returned: pageRows.length, has_more: response.body?.hasMore === true });
    cursor = response.body?.nextCursor || null;
    if (response.status !== 200 || !response.body?.hasMore || !cursor) break;
  }
  return {
    brand,
    pages: pageEvidence,
    unique_ids: new Set(rows.map(row => row.id)).size,
    duplicate_ids: rows.length - new Set(rows.map(row => row.id)).size,
    coverage: fieldCoverage(rows),
  };
}

async function collectReference(brand, reference) {
  const params = new URLSearchParams({ brand, reference, evidencePage: '1' });
  const response = await get(`/api/price-research?${params}`);
  const body = response.body || {};
  return {
    brand, reference, http: response.status, elapsed_ms: response.elapsed_ms,
    analytics_ready: body.analytics_ready === true,
    tracked: Number(body.total_tracked_listings || 0),
    wts_eligible: Number(body.wts_eligible_analytics_count || 0),
    wtb_demand: Number(body.wtb_demand_count || 0),
    excluded: Number(body.excluded_count || 0),
    excluded_breakdown: body.excluded_breakdown || null,
    sample_capped: body.sampleCapped === true,
    rows_returned: Array.isArray(body.rows) ? body.rows.length : 0,
    monthly_buckets: Array.isArray(body.monthly) ? body.monthly.length : 0,
    forecast_ready: body.forecast?.ready === true,
    forecast_provisional: body.forecast?.provisional === true,
    minimum_usd: body.stats?.min ?? null,
    median_usd: body.stats?.median ?? null,
    maximum_usd: body.stats?.max ?? null,
    wts_accounting_reconciles: body.reconciliation?.wts_accounting_reconciles === true,
  };
}

async function collectWtbFilter(brand) {
  const params = new URLSearchParams({ brand, item: 'watches', type: 'WTB', pageSize: '50', pagination: 'cursor' });
  const response = await get(`/api/reviewed-market-inventory?${params}`);
  const rows = response.body?.records || [];
  return { brand, http: response.status, returned: rows.length, has_more: response.body?.hasMore === true, returned_types: [...new Set(rows.map(row => row.listing_type))] };
}

async function main() {
  const [health, summary, broad, references, wtbFilters] = await Promise.all([
    get('/api/health'),
    get('/api/live-release-summary'),
    Promise.all(BRANDS.map(collectBrandPages)),
    Promise.all(REFERENCES.map(([brand, reference]) => collectReference(brand, reference))),
    Promise.all(BRANDS.map(collectWtbFilter)),
  ]);
  const output = {
    contract: 'watch-listing-integrity-audit-v1',
    read_only: true,
    observed_at: new Date().toISOString(),
    origin: ORIGIN,
    health: {
      http: health.status,
      status: health.body?.status || null,
      database_reachable: health.body?.database === 'reachable' || health.body?.database?.reachable === true,
      project_ref: health.body?.database_project_ref || health.body?.database?.project_ref || null,
    },
    release_summary: summary.body || { http: summary.status },
    broad_two_page_samples: broad,
    price_research_reference_samples: references,
    trading_floor_wtb_filter_samples: wtbFilters,
    limitations: [
      'Public endpoints do not expose immutable raw payloads or source media counts.',
      'Two-page samples are bounded evidence, not a full-table scan.',
      'This collector never verifies or follows seller phone values.',
      'Live ingestion worker state requires deployment logs or read-only database access.',
    ],
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ error: error.message, read_only: true })}\n`);
  process.exitCode = 1;
});
