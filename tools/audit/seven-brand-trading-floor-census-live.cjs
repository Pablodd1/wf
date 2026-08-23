#!/usr/bin/env node
'use strict';

// Read-only, resumable census of the customer-visible Trading Floor contract.
// It uses one bounded cursor request at a time, stores no raw messages, and
// compares released references with the completed Price Research catalog census.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const DEFAULT_BRANDS = ['Tudor', 'Cartier', 'TAG Heuer', 'Patek Philippe', 'Rolex', 'Zenith', 'Omega'];
const PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.SEVEN_BRAND_TF_FETCH_TIMEOUT_MS || 90_000));
const FETCH_ATTEMPTS = Math.max(1, Number(process.env.SEVEN_BRAND_TF_FETCH_ATTEMPTS || 4));

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function bounded(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function exactText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function referenceKey(brand, reference) {
  return `${exactText(brand).toUpperCase()}|${exactText(reference).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasImage(row) {
  if (Array.isArray(row?.image_urls) && row.image_urls.some(Boolean)) return true;
  return Boolean(exactText(row?.thumbnail_url || row?.image_url));
}

function hasDealerRating(row) {
  return positive(row?.dealer_rating ?? row?.seller_rating ?? row?.rating) !== null
    || ['SOURCE_SUPPLIED', 'SOURCE_FEEDBACK_COUNT'].includes(exactText(row?.seller_rating_evidence_status).toUpperCase());
}

function publicDuplicateSignature(row) {
  const fields = [
    exactText(row?.brand).toUpperCase(),
    exactText(row?.reference).toUpperCase(),
    exactText(row?.listing_type).toUpperCase(),
    exactText(row?.source_record_id),
    positive(row?.source_price_amount ?? row?.price_original ?? row?.price) || '',
    exactText(row?.source_price_currency ?? row?.price_currency ?? row?.currency).toUpperCase(),
    exactText(row?.listing_date).slice(0, 10),
    exactText(row?.seller_name).toUpperCase(),
  ];
  return sha256(fields.join('\u001f'));
}

function summarizeRows(brand, rows, catalogKeys = new Set()) {
  const ids = rows.map(row => exactText(row.id)).filter(Boolean);
  const referenceKeys = new Set(rows.map(row => referenceKey(brand, row.reference)).filter(key => !key.endsWith('|')));
  const sourceGroups = new Map();
  const signatureGroups = new Map();
  const currencyCounts = new Map();
  const missing = [];

  for (const row of rows) {
    const sourceId = exactText(row.source_record_id);
    if (sourceId) sourceGroups.set(sourceId, [...(sourceGroups.get(sourceId) || []), exactText(row.id)]);
    const signature = publicDuplicateSignature(row);
    signatureGroups.set(signature, [...(signatureGroups.get(signature) || []), exactText(row.id)]);
    const currency = exactText(row.source_price_currency ?? row.price_currency ?? row.currency).toUpperCase() || 'UNSPECIFIED';
    currencyCounts.set(currency, (currencyCounts.get(currency) || 0) + 1);
    const absent = [];
    if (!exactText(row.reference)) absent.push('reference');
    if (!exactText(row.seller_name) && !exactText(row.dealer_id)) absent.push('dealer_or_seller');
    if (!hasImage(row)) absent.push('image');
    if (String(row.listing_type || '').toUpperCase() === 'WTS'
      && positive(row.source_price_amount ?? row.price_original ?? row.price_usd ?? row.price) === null) absent.push('price');
    if (!hasDealerRating(row)) absent.push('dealer_rating');
    if (absent.length) missing.push({ listing_id: exactText(row.id), reference: exactText(row.reference) || null, fields: absent });
  }

  const repeatedSourceIds = [...sourceGroups.entries()].filter(([, group]) => group.length > 1);
  const repeatedSignatures = [...signatureGroups.entries()].filter(([, group]) => group.length > 1);
  const catalogForBrand = new Set([...catalogKeys].filter(key => key.startsWith(`${brand.toUpperCase()}|`)));
  return {
    brand,
    released_listings: rows.length,
    unique_ids: new Set(ids).size,
    duplicate_ids: ids.length - new Set(ids).size,
    unique_references: referenceKeys.size,
    catalog_references_without_released_listing: catalogForBrand.size
      ? [...catalogForBrand].filter(key => !referenceKeys.has(key)).length
      : null,
    released_references_outside_catalog: catalogForBrand.size
      ? [...referenceKeys].filter(key => !catalogForBrand.has(key)).length
      : null,
    wts: rows.filter(row => exactText(row.listing_type).toUpperCase() === 'WTS').length,
    wtb: rows.filter(row => exactText(row.listing_type).toUpperCase() === 'WTB').length,
    with_price: rows.filter(row => positive(row.price_usd ?? row.source_price_amount ?? row.price_original ?? row.price) !== null).length,
    missing_price: rows.filter(row => exactText(row.listing_type).toUpperCase() === 'WTS'
      && positive(row.price_usd ?? row.source_price_amount ?? row.price_original ?? row.price) === null).length,
    with_image: rows.filter(hasImage).length,
    missing_image: rows.filter(row => !hasImage(row)).length,
    with_dealer_or_seller: rows.filter(row => exactText(row.seller_name) || exactText(row.dealer_id)).length,
    missing_dealer_or_seller: rows.filter(row => !exactText(row.seller_name) && !exactText(row.dealer_id)).length,
    with_dealer_rating: rows.filter(hasDealerRating).length,
    missing_dealer_rating: rows.filter(row => !hasDealerRating(row)).length,
    with_public_contact: rows.filter(row => row.contact_publication_approved === true).length,
    original_currency_counts: Object.fromEntries([...currencyCounts.entries()].sort()),
    repeated_source_id_groups: repeatedSourceIds.map(([sourceId, listingIds]) => ({ source_id_sha256: sha256(sourceId), listing_ids: listingIds })),
    repeated_public_signature_groups: repeatedSignatures.map(([signature, listingIds]) => ({ signature_sha256: signature, listing_ids: listingIds })),
    missing_field_rows: missing,
  };
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'watchfacts-seven-brand-trading-floor-census/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await sleep(attempt * 1_500);
    }
  }
  throw lastError;
}

function loadCatalogKeys(priceResearchReportPath) {
  if (!fs.existsSync(priceResearchReportPath)) return new Set();
  const report = JSON.parse(fs.readFileSync(priceResearchReportPath, 'utf8'));
  if (report.snapshot_complete !== true) return new Set();
  return new Set((report.rows || []).map(row => exactText(row.key)).filter(Boolean));
}

async function main() {
  const baseUrl = exactText(process.env.SEVEN_BRAND_TF_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const outputDir = path.resolve(process.env.SEVEN_BRAND_TF_OUTPUT || 'audit-output/seven-brand-trading-floor-coverage');
  const pauseMs = bounded('SEVEN_BRAND_TF_PAGE_PAUSE_MS', 750, 250, 10_000);
  const maxPages = bounded('SEVEN_BRAND_TF_MAX_PAGES', 10_000, 1, 10_000);
  const brands = exactText(process.env.SEVEN_BRAND_TF_BRANDS || DEFAULT_BRANDS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const reportPath = path.join(outputDir, 'report.json');
  const priceResearchReportPath = path.resolve(process.env.SEVEN_BRAND_PRICE_RESEARCH_REPORT
    || 'audit-output/seven-brand-price-research-coverage/report.json');
  const previous = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { brand_state: {}, failures: [] };
  const censusRunId = previous.snapshot_complete === true ? crypto.randomUUID() : (previous.census_run_id || crypto.randomUUID());
  const censusStartedAt = previous.snapshot_complete === true ? new Date().toISOString() : (previous.census_started_at || new Date().toISOString());
  const brandState = previous.snapshot_complete === true ? {} : (previous.brand_state || {});
  const failures = previous.snapshot_complete === true ? [] : [...(previous.failures || [])];
  let processedPages = 0;

  const save = snapshotComplete => atomicJson(checkpointPath, {
    contract: 'watchfacts-seven-brand-live-trading-floor-census-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    customer_api_writes: 0,
    base_url: baseUrl,
    brands,
    census_run_id: censusRunId,
    census_started_at: censusStartedAt,
    processed_pages_this_run: processedPages,
    snapshot_complete: snapshotComplete,
    brand_state: brandState,
    failures,
  });

  for (const brand of brands) {
    const current = brandState[brand] || { cursor: null, rows: [], pages: 0, complete: false };
    brandState[brand] = current;
    if (current.complete) continue;
    while (processedPages < maxPages) {
      const url = new URL('/api/reviewed-market-inventory', baseUrl);
      url.searchParams.set('brand', brand);
      url.searchParams.set('item', 'watches');
      url.searchParams.set('pageSize', String(PAGE_SIZE));
      url.searchParams.set('pagination', 'cursor');
      if (current.cursor) url.searchParams.set('cursor', current.cursor);
      try {
        const payload = await fetchJson(url);
        const pageRows = Array.isArray(payload.records) ? payload.records : [];
        current.rows.push(...pageRows.map(row => {
          const { raw_message: _rawMessage, ...safeRow } = row;
          return safeRow;
        }));
        current.pages += 1;
        current.advertised_total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : null;
        current.total_status = payload.totalStatus || null;
        current.cursor = payload.hasMore === true ? payload.nextCursor || null : null;
        current.complete = payload.hasMore !== true;
        processedPages += 1;
        save(false);
        process.stdout.write(`${JSON.stringify({ event: 'seven_brand_tf_page', brand, page: current.pages, rows: current.rows.length, complete: current.complete })}\n`);
        if (current.complete) break;
        if (!current.cursor) throw new Error(`${brand} advertised hasMore without nextCursor`);
        await sleep(pauseMs);
      } catch (error) {
        failures.push({ brand, cursor: current.cursor, error: error.message, at: new Date().toISOString() });
        save(false);
        throw error;
      }
    }
    if (!current.complete && processedPages >= maxPages) break;
  }

  const snapshotComplete = brands.every(brand => brandState[brand]?.complete === true);
  const catalogKeys = loadCatalogKeys(priceResearchReportPath);
  const summaries = brands.map(brand => summarizeRows(brand, brandState[brand]?.rows || [], catalogKeys));
  const rowsChecksum = sha256(brands.flatMap(brand => (brandState[brand]?.rows || [])
    .map(row => `${brand}|${exactText(row.id)}|${exactText(row.reference)}|${positive(row.price_usd) || ''}`)).sort().join('\n'));
  const report = {
    contract: 'watchfacts-seven-brand-live-trading-floor-census-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    customer_api_writes: 0,
    base_url: baseUrl,
    brands,
    census_run_id: censusRunId,
    census_started_at: censusStartedAt,
    snapshot_complete: snapshotComplete,
    price_research_catalog_comparison_available: catalogKeys.size > 0,
    brand_summary: summaries,
    totals: {
      released_listings: summaries.reduce((sum, row) => sum + row.released_listings, 0),
      unique_references: summaries.reduce((sum, row) => sum + row.unique_references, 0),
      duplicate_ids: summaries.reduce((sum, row) => sum + row.duplicate_ids, 0),
      missing_price: summaries.reduce((sum, row) => sum + row.missing_price, 0),
      missing_image: summaries.reduce((sum, row) => sum + row.missing_image, 0),
      missing_dealer_or_seller: summaries.reduce((sum, row) => sum + row.missing_dealer_or_seller, 0),
      missing_dealer_rating: summaries.reduce((sum, row) => sum + row.missing_dealer_rating, 0),
    },
    failures,
    checksums: { released_rows_sha256: rowsChecksum },
    count_semantics: {
      released_listings: 'Unique customer-visible rows returned by the terminating Trading Floor cursor for the exact brand filter.',
      catalog_references_without_released_listing: 'Price Research catalog references with no currently released Trading Floor listing; this is not automatically a defect.',
      missing_price: 'Released WTS rows without a positive source or normalized price value in the customer API record.',
      duplicate_groups: 'Candidate repeated source/signature groups only; no row is suppressed without separate immutable evidence review.',
    },
  };
  save(snapshotComplete);
  atomicJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ event: snapshotComplete ? 'seven_brand_tf_complete' : 'seven_brand_tf_incomplete', report: reportPath, totals: report.totals })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'seven_brand_tf_error', read_only: true, error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { hasDealerRating, hasImage, publicDuplicateSignature, referenceKey, summarizeRows };
