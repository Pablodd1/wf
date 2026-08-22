#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { comparisonKey, normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');
const { marketPlausibilityFloor, summarizePrices } = require('../../api/_lib/market-stats.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const OUTPUT_DIR = path.resolve(process.env.AUDIT_OUTPUT_DIR || 'audit-output/rolex-listing-completeness');
const SQL_DIR = path.join(__dirname, 'sql');
const SHARDS = 16;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function assertReadOnlySql(sql) {
  const scrubbed = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:''|[^'])*'/g, "''");
  const mutation = scrubbed.match(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|REFRESH|VACUUM|ANALYZE|SET|RESET|NOTIFY|LISTEN|LOCK)\b/i);
  if (mutation) throw new Error(`SQL is not read-only: ${mutation[1]}`);
  if (!/^\s*(WITH|SELECT)\b/i.test(scrubbed) || (scrubbed.match(/;/g) || []).length !== 1 || !/;\s*$/.test(scrubbed)) {
    throw new Error('SQL must be one WITH/SELECT statement.');
  }
}

async function query(sql, label) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN unavailable');
  assertReadOnlySql(sql);
  process.stdout.write(`Starting ${label}\n`);
  const started = Date.now();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(300000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} failed ${response.status}: ${body.slice(0, 700)}`);
  process.stdout.write(`Completed ${label} ${Date.now() - started}ms\n`);
  return JSON.parse(body);
}

function envelope(value, contract) {
  if (!value || value.contract !== contract || value.project_ref !== PROJECT_REF || value.read_only !== true || value.transaction_read_only !== 'on') {
    throw new Error(`Invalid envelope ${contract}`);
  }
}

function shardSql(template, index, canonicalSql) {
  const low = `${index.toString(16)}0000000-0000-0000-0000-000000000000`;
  const high = index === SHARDS - 1 ? '' : `AND l.id<'${(index + 1).toString(16)}0000000-0000-0000-0000-000000000000'::uuid`;
  return template.replaceAll('__SHARD__', String(index)).replaceAll('__LOW__', low)
    .replaceAll('__HIGH_CONDITION__', high).replaceAll('__CANONICAL_KEYS__', canonicalSql);
}

function priceShardSql(template, index, canonicalSql) {
  const low = `${index.toString(16)}0000000-0000-0000-0000-000000000000`;
  const high = index === SHARDS - 1 ? '' : `AND p.id::uuid<'${(index + 1).toString(16)}0000000-0000-0000-0000-000000000000'::uuid`;
  return template.replaceAll('__SHARD__', String(index)).replaceAll('__LOW__', low)
    .replaceAll('__HIGH_CONDITION__', high).replaceAll('__CANONICAL_KEYS__', canonicalSql);
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function benchmarkKey(reference, dial) {
  const normalized = normalizeDialValue(dial);
  return normalized.known ? `${refKey(reference)}|${comparisonKey(normalized.value)}` : '';
}

function buildBenchmarks(priceRows) {
  const seen = new Set();
  const groups = new Map();
  for (const row of priceRows) {
    if (seen.has(row.dedup_key)) continue;
    seen.add(row.dedup_key);
    const key = benchmarkKey(row.reference, row.dial);
    const price = Number(row.price_usd);
    if (!key || !Number.isFinite(price) || price <= 0) continue;
    const prices = groups.get(key) || [];
    prices.push(price);
    groups.set(key, prices);
  }
  const benchmarks = new Map();
  for (const [key, prices] of groups) {
    const floor = marketPlausibilityFloor(prices);
    benchmarks.set(key, summarizePrices(prices.filter(price => price >= floor)));
  }
  return { benchmarks, deduplicatedPriceRows: seen.size };
}

function classify(row, benchmarks) {
  const issues = [];
  const isWts = row.listing_type === 'WTS';
  const price = Number(row.price_usd);
  const benchmark = benchmarks.get(benchmarkKey(row.reference, row.dial));
  const hasPrice = Number.isFinite(price) && price > 0;
  const hasPriceRating = Boolean(isWts && hasPrice && benchmark?.analytics_ready && benchmark.stats
    && price >= benchmark.stats.min && price <= benchmark.stats.max);
  let priceRating = '';
  if (hasPriceRating) {
    const center = Number(benchmark.stats.median || benchmark.stats.avg);
    priceRating = price <= center * 0.95 ? 'GOOD' : price <= center * 1.05 ? 'MARKET' : 'HIGH';
  }
  if (isWts && !hasPrice) issues.push('MISSING_USD_PRICE');
  if (isWts && !hasPriceRating) issues.push('PRICE_RATING_UNAVAILABLE');
  if (!row.has_exact_dealer_link) issues.push('MISSING_DEALER_LINK');
  if (!row.has_dealer_rating) issues.push('MISSING_DEALER_RATING');
  if (!row.has_valid_image) issues.push('MISSING_IMAGE');
  if (row.raw_message_state === 'missing') issues.push('MISSING_RAW_MESSAGE');
  if (row.raw_message_state === 'normalized_summary') issues.push('NORMALIZED_SUMMARY_WITHHELD');
  if (row.raw_message_state === 'url_only') issues.push('RAW_MESSAGE_URL_ONLY');
  if (row.raw_message_state === 'contains_image_url') issues.push('RAW_MESSAGE_CONTAINS_IMAGE_URL');
  if (!row.has_complete_watch_identity) issues.push('MISSING_WATCH_IDENTITY');
  if (!row.has_posted_user) issues.push('MISSING_POSTED_USER');
  if (!row.posted_at) issues.push('MISSING_POSTED_DATE');
  return { ...row, has_price_rating: hasPriceRating, price_rating: priceRating, issues };
}

async function main() {
  const catalog = listCanonicalCatalogReferences('Rolex');
  const canonical = [...new Set(catalog.map(row => refKey(row.reference)).filter(Boolean))].sort();
  const canonicalSql = canonical.map(key => `'${key.replaceAll("'", "''")}'`).join(',');
  const baseTemplate = fs.readFileSync(path.join(SQL_DIR, 'rolex-listing-completeness-base-readonly.sql'), 'utf8');
  const priceTemplate = fs.readFileSync(path.join(SQL_DIR, 'rolex-listing-price-evidence-readonly.sql'), 'utf8');
  const overlayTemplate = fs.readFileSync(path.join(SQL_DIR, 'rolex-listing-completeness-overlay-readonly.sql'), 'utf8');
  const baseSqls = Array.from({ length: SHARDS }, (_, index) => shardSql(baseTemplate, index, canonicalSql));
  const priceSqls = Array.from({ length: SHARDS }, (_, index) => priceShardSql(priceTemplate, index, canonicalSql));
  const overlaySql = overlayTemplate.replaceAll('__CANONICAL_KEYS__', canonicalSql);
  [...baseSqls, ...priceSqls, overlaySql].forEach(assertReadOnlySql);
  if (process.argv.includes('--validate-only')) {
    process.stdout.write(`Validated ${SHARDS * 2 + 1} read-only canonical Rolex queries.\n`);
    return;
  }

  const baseRows = [];
  for (let index = 0; index < SHARDS; index += 1) {
    const value = (await query(baseSqls[index], `base-${index}`))?.[0]?.audit;
    envelope(value, 'watchfacts-rolex-listing-completeness-base-v1');
    if (Number(value.shard) !== index) throw new Error(`Base shard mismatch ${index}`);
    baseRows.push(...value.rows);
  }
  const overlayValue = (await query(overlaySql, 'overlay'))?.[0]?.audit;
  envelope(overlayValue, 'watchfacts-rolex-listing-completeness-overlay-v1');
  const priceRows = [];
  for (let index = 0; index < SHARDS; index += 1) {
    const value = (await query(priceSqls[index], `price-${index}`))?.[0]?.audit;
    envelope(value, 'watchfacts-rolex-listing-price-evidence-v1');
    if (Number(value.shard) !== index) throw new Error(`Price shard mismatch ${index}`);
    priceRows.push(...value.rows);
  }

  const { benchmarks, deduplicatedPriceRows } = buildBenchmarks(priceRows);
  const rows = [...baseRows, ...overlayValue.rows].map(row => classify(row, benchmarks));
  const issueCounts = {};
  const byReference = new Map();
  for (const row of rows) {
    for (const issue of row.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    const key = refKey(row.reference) || 'MISSING';
    const current = byReference.get(key) || { reference: row.reference || '', listings: 0, wts: 0, missing_usd_price: 0, price_rating_unavailable: 0, missing_dealer_link: 0, missing_dealer_rating: 0, missing_image: 0, raw_message_problem: 0, missing_identity: 0 };
    current.listings += 1;
    if (row.listing_type === 'WTS') current.wts += 1;
    if (row.issues.includes('MISSING_USD_PRICE')) current.missing_usd_price += 1;
    if (row.issues.includes('PRICE_RATING_UNAVAILABLE')) current.price_rating_unavailable += 1;
    if (row.issues.includes('MISSING_DEALER_LINK')) current.missing_dealer_link += 1;
    if (row.issues.includes('MISSING_DEALER_RATING')) current.missing_dealer_rating += 1;
    if (row.issues.includes('MISSING_IMAGE')) current.missing_image += 1;
    if (row.issues.some(issue => issue.startsWith('RAW_MESSAGE_') || issue === 'MISSING_RAW_MESSAGE' || issue === 'NORMALIZED_SUMMARY_WITHHELD')) current.raw_message_problem += 1;
    if (row.issues.includes('MISSING_WATCH_IDENTITY')) current.missing_identity += 1;
    byReference.set(key, current);
  }

  const summary = {
    contract: 'watchfacts-rolex-listing-completeness-v1', project_ref: PROJECT_REF,
    read_only: true, transaction_read_only: 'on', generated_at: new Date().toISOString(),
    scope: 'Trading Floor rows whose normalized reference is in the canonical Rolex catalog',
    counts: {
      canonical_catalog_references: canonical.length,
      canonical_base_listings: baseRows.length,
      canonical_reviewed_overlay_listings: overlayValue.rows.length,
      canonical_trading_floor_listings: rows.length,
      canonical_wts_listings: rows.filter(row => row.listing_type === 'WTS').length,
      canonical_wtb_listings: rows.filter(row => row.listing_type === 'WTB').length,
      listings_with_usd_price: rows.filter(row => Number(row.price_usd) > 0).length,
      listings_missing_usd_price: rows.filter(row => row.issues.includes('MISSING_USD_PRICE')).length,
      listings_with_price_rating: rows.filter(row => row.has_price_rating).length,
      listings_without_price_rating: rows.filter(row => row.issues.includes('PRICE_RATING_UNAVAILABLE')).length,
      listings_with_exact_dealer_link: rows.filter(row => row.has_exact_dealer_link).length,
      listings_missing_exact_dealer_link: rows.filter(row => !row.has_exact_dealer_link).length,
      listings_with_dealer_rating: rows.filter(row => row.has_dealer_rating).length,
      listings_missing_dealer_rating: rows.filter(row => !row.has_dealer_rating).length,
      listings_with_valid_image: rows.filter(row => row.has_valid_image).length,
      listings_missing_image: rows.filter(row => !row.has_valid_image).length,
      listings_with_any_required_gap: rows.filter(row => row.issues.length > 0).length,
      price_research_source_rows: priceRows.length,
      price_research_deduplicated_rows: deduplicatedPriceRows,
      price_benchmark_cohorts: benchmarks.size,
    },
    issue_counts: issueCounts,
    checksums: {
      canonical_listing_ids_sha256: sha256(rows.map(row => row.listing_id).sort().join('\n')),
      exception_rows_sha256: sha256(rows.map(row => `${row.listing_id}|${row.issues.join(';')}`).sort().join('\n')),
      price_evidence_sha256: sha256(priceRows.map(row => `${row.listing_id}|${row.dedup_key}|${row.price_usd}`).sort().join('\n')),
    },
    privacy: { raw_messages_exported: false, phone_numbers_exported: false, image_urls_exported: false },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const listingColumns = ['listing_id','source_record_id','source_lane','reference','model','dial','listing_type','posted_at','price_usd','original_currency','dealer_id','dealer_name','has_posted_user','has_location','has_valid_image','raw_message_state','has_exact_dealer_link','has_dealer_rating','has_complete_watch_identity','has_price_rating','price_rating','issues'];
  const listingCsv = [listingColumns.join(','), ...rows.map(row => listingColumns.map(column => csvValue(column === 'issues' ? row.issues.join(';') : row[column])).join(','))].join('\n') + '\n';
  const referenceColumns = ['reference','listings','wts','missing_usd_price','price_rating_unavailable','missing_dealer_link','missing_dealer_rating','missing_image','raw_message_problem','missing_identity'];
  const referenceRows = [...byReference.values()].sort((a,b) => refKey(a.reference).localeCompare(refKey(b.reference)));
  const referenceCsv = [referenceColumns.join(','), ...referenceRows.map(row => referenceColumns.map(column => csvValue(row[column])).join(','))].join('\n') + '\n';
  const summaryText = JSON.stringify(summary, null, 2) + '\n';
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), summaryText);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'listing-exceptions.csv'), listingCsv);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'reference-gap-counts.csv'), referenceCsv);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify({
    contract: 'watchfacts-rolex-listing-completeness-manifest-v1', read_only: true,
    files: {
      'summary.json': sha256(summaryText),
      'listing-exceptions.csv': sha256(listingCsv),
      'reference-gap-counts.csv': sha256(referenceCsv),
    },
  }, null, 2) + '\n');
  const unsafe = /(?:raw_message_text|seller_phone|phone_number|https?:\/\/)/i;
  for (const name of ['summary.json','listing-exceptions.csv','reference-gap-counts.csv']) {
    const body = fs.readFileSync(path.join(OUTPUT_DIR, name), 'utf8');
    if (unsafe.test(body)) throw new Error(`Unsafe content detected in ${name}`);
  }
  process.stdout.write(JSON.stringify(summary.counts, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
