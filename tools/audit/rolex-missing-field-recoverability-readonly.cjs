#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const { applyCurrencyPolicy } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { fetchFxSnapshot } = require('../mariadb-live/fetch-fx-snapshot.cjs');
const { sourceAuctionId, exactImageUrl } = require('./audit-four-brand-source-completeness.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const OUTPUT_DIR = path.resolve(process.env.AUDIT_OUTPUT_DIR || 'audit-output/rolex-missing-field-recoverability');
const PAGE_SIZE = 250;
const SHARDS = 16;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function assertReadOnlySql(sql) {
  const scrubbed = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const mutation = scrubbed.match(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE|REFRESH|VACUUM|ANALYZE|SET|RESET|NOTIFY|LISTEN|LOCK)\b/i);
  if (mutation) throw new Error(`SQL is not read-only: ${mutation[1]}`);
  if (!/^\s*(WITH|SELECT)\b/i.test(scrubbed) || (scrubbed.match(/;/g) || []).length !== 1 || !/;\s*$/.test(scrubbed)) {
    throw new Error('SQL must be one WITH/SELECT statement');
  }
}

async function query(sql, label) {
  assertReadOnlySql(sql);
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} failed ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function shardBounds(index) {
  return {
    low: `${index.toString(16)}0000000-0000-0000-0000-000000000000`,
    high: index === SHARDS - 1 ? null : `${(index + 1).toString(16)}0000000-0000-0000-0000-000000000000`,
  };
}

function candidateSql(canonicalSql, shard, cursor = null) {
  const { low, high } = shardBounds(shard);
  return `WITH control AS MATERIALIZED (
    SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
    WHERE canonical_brand='Rolex' AND trading_floor_enabled
  ), page AS MATERIALIZED (
    SELECT l.id,l.source_record_id,l.source_hash,l.source_candidate_hash,l.raw_message_version_id,
      l.reference_normalized,v.raw_payload
    FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
    JOIN public.raw_message_versions v ON v.id=l.raw_message_version_id
      AND v.source_record_id=l.source_record_id AND v.source_hash=l.source_hash
    WHERE l.brand_normalized='Rolex' AND upper(COALESCE(l.category,''))='WATCH'
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false
      AND upper(COALESCE(l.listing_type,l.intent,''))='WTS'
      AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
      AND l.source_hash~'^[0-9a-f]{64}$' AND l.source_candidate_hash~'^[0-9a-f]{64}$'
      AND COALESCE(l.price_usd,l.price_normalized,0)<=0
      AND lower(COALESCE(l.trading_floor_status,'')) NOT IN ('bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate','withdrawn','rejected','hidden','deleted','archived')
      AND upper(COALESCE(l.verdict,'')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      AND regexp_replace(upper(btrim(l.reference_normalized)),'[^A-Z0-9]','','g') IN (${canonicalSql})
      AND l.id>=${sqlString(low)}::uuid ${high ? `AND l.id<${sqlString(high)}::uuid` : ''}
      ${cursor ? `AND l.id>${sqlString(cursor)}::uuid` : ''}
    ORDER BY l.id LIMIT ${PAGE_SIZE}
  ) SELECT jsonb_build_object('read_only',true,'transaction_read_only',current_setting('transaction_read_only'),
    'rows',COALESCE(jsonb_agg(jsonb_build_object('listing_id',id,'source_record_id',source_record_id,
      'source_hash',source_hash,'source_candidate_hash',source_candidate_hash,
      'raw_message_version_id',raw_message_version_id,'normalized_reference',reference_normalized,
      'raw_payload',raw_payload) ORDER BY id),'[]'::jsonb)) AS audit FROM page;`;
}

function exactPriceCandidate(row, fxSnapshot) {
  const source = row.raw_payload;
  if (!source || source.source_record_id !== row.source_record_id || source.raw_sha256 !== row.source_hash) return { reason: 'LINEAGE_MISMATCH' };
  const raw = String(source.raw_message || '');
  if (!raw || /\b(?:patek(?:\s+philippe)?|audemars\s+piguet|omega|cartier|tudor|vacheron\s+constantin|richard\s+mille)\b/i.test(raw)) {
    return { reason: 'EMPTY_OR_CROSS_BRAND_RAW' };
  }
  const reference = refKey(row.normalized_reference);
  if (!reference || !refKey(raw).includes(reference)) return { reason: 'REFERENCE_NOT_IN_RAW' };
  const observations = extractPriceObservations(raw, {}).map(value => applyCurrencyPolicy(value, fxSnapshot))
    .filter(value => value?.amount_original > 0 && value?.amount_usd > 0 && value?.currency_original
      && value?.conversion_rate > 0 && value?.conversion_source
      && (['USD','USDT'].includes(value.currency_original) || value.conversion_timestamp));
  if (!observations.length) return { reason: 'NO_EXPLICIT_CONVERTIBLE_PRICE' };
  let price = null;
  if (observations.length === 1) price = observations[0];
  else {
    const usd = observations.filter(value => ['USD','USDT'].includes(value.currency_original));
    const values = observations.map(value => Number(value.amount_usd));
    const low = Math.min(...values); const high = Math.max(...values);
    if (usd.length === 1 && low > 0 && high / low <= 1.05) price = usd[0];
  }
  if (!price) return { reason: 'AMBIGUOUS_MULTIPLE_PRICES' };
  return { candidate: {
    listing_id: String(row.listing_id), source_record_id: row.source_record_id,
    source_hash: row.source_hash, source_candidate_hash: row.source_candidate_hash,
    raw_message_version_id: row.raw_message_version_id, canonical_brand: 'Rolex',
    normalized_reference: row.normalized_reference, proposed_price_usd: Number(price.amount_usd),
    source_price_amount: Number(price.amount_original), source_currency: price.currency_original,
    currency_evidence: price.currency_evidence, conversion_rate: Number(price.conversion_rate),
    conversion_timestamp: price.conversion_timestamp || null, conversion_source: price.conversion_source,
  } };
}

async function priceCensus(canonicalSql, fxSnapshot) {
  const candidates = []; const skipped = {}; let scanned = 0;
  for (let shard = 0; shard < SHARDS; shard += 1) {
    let cursor = null;
    for (;;) {
      const value = (await query(candidateSql(canonicalSql, shard, cursor), `price-shard-${shard}`))?.[0]?.audit;
      if (!value?.read_only || value.transaction_read_only !== 'on') throw new Error('Read-only envelope failed');
      const rows = value.rows || [];
      for (const row of rows) {
        scanned += 1;
        const result = exactPriceCandidate(row, fxSnapshot);
        if (result.candidate) candidates.push(result.candidate);
        else skipped[result.reason] = (skipped[result.reason] || 0) + 1;
      }
      if (rows.length < PAGE_SIZE) break;
      cursor = rows.at(-1).listing_id;
      if (scanned % 5000 === 0) process.stdout.write(`Scanned ${scanned} missing-price rows\n`);
    }
  }
  candidates.sort((a,b) => a.listing_id.localeCompare(b.listing_id));
  return { scanned, candidates, skipped };
}

async function imageCensus(canonicalSql) {
  const sql = `WITH control AS MATERIALIZED (SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
    WHERE canonical_brand='Rolex' AND trading_floor_enabled)
  SELECT l.id::text listing_id,l.source_record_id,l.source_hash,l.source_candidate_hash,
    l.raw_message_version_id::text raw_message_version_id,l.reference_normalized
  FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
  WHERE l.brand_normalized='Rolex' AND upper(COALESCE(l.category,''))='WATCH' AND l.parent_id IS NULL
    AND COALESCE(l.is_bundle,false)=false AND COALESCE(l.provenance_metadata->>'bundle_status','SINGLE_CANDIDATE')='SINGLE_CANDIDATE'
    AND regexp_replace(upper(btrim(l.reference_normalized)),'[^A-Z0-9]','','g') IN (${canonicalSql})
    AND NULLIF(btrim(COALESCE(l.image_url,l.source_media_url_candidate,'')),'') IS NULL ORDER BY l.id;`;
  const rows = await query(sql, 'missing-images');
  const ids = rows.map(row => sourceAuctionId(row.source_record_id)).filter(Boolean);
  if (!ids.length) return { scanned: rows.length, candidates: [], missingSource: rows.length };
  const connection = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASS, database: process.env.MYSQL_DB || 'thecollective_inventory' });
  let sources;
  try {
    const placeholders = ids.map(() => '?').join(',');
    [sources] = await connection.execute(`SELECT id,front_image FROM auctions WHERE id IN (${placeholders})`, ids);
  } finally { await connection.end(); }
  const byId = new Map(sources.map(row => [String(row.id).toLowerCase(), row]));
  const candidates = [];
  for (const row of rows) {
    const source = byId.get(sourceAuctionId(row.source_record_id));
    const url = exactImageUrl(source?.front_image);
    if (!url) continue;
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) continue;
    const mediaKey = decodeURIComponent(new URL(url).pathname.split('/').pop());
    candidates.push({ ...row, proposed_image_url: url, source_media_key: mediaKey,
      source_media_sha256: sha256(mediaKey), image_verified_at: new Date().toISOString() });
  }
  return { scanned: rows.length, candidates, missingSource: rows.length - candidates.length };
}

async function linkageSummary(canonicalSql) {
  const sql = `WITH control AS MATERIALIZED (SELECT enabled_run_key FROM public.qnsa_two_brand_release_control
    WHERE canonical_brand='Rolex' AND trading_floor_enabled), eligible AS MATERIALIZED (
    SELECT l.id FROM staging.listings l JOIN control c ON c.enabled_run_key=l.normalization_run_key
    WHERE l.brand_normalized='Rolex' AND regexp_replace(upper(btrim(l.reference_normalized)),'[^A-Z0-9]','','g') IN (${canonicalSql})
      AND l.parent_id IS NULL AND COALESCE(l.is_bundle,false)=false)
  SELECT jsonb_build_object('total',count(*),'linked',count(link.dealer_id),
    'missing_link',count(*)-count(link.dealer_id),'rated',count(*) FILTER (WHERE COALESCE(d.rating,0)>0 AND COALESCE(d.review_count,0)>0),
    'missing_rating',count(*)-count(*) FILTER (WHERE COALESCE(d.rating,0)>0 AND COALESCE(d.review_count,0)>0)) summary
  FROM eligible e LEFT JOIN LATERAL (SELECT dl.dealer_id FROM public.dealer_listing_links dl
    WHERE dl.listing_id=e.id AND dl.link_status='APPLIED' ORDER BY dl.linked_at,dl.dealer_id LIMIT 1) link ON true
  LEFT JOIN public.dealers d ON d.id=link.dealer_id;`;
  return (await query(sql, 'dealer-summary'))?.[0]?.summary;
}

async function main() {
  const canonical = [...new Set(listCanonicalCatalogReferences('Rolex').map(row => refKey(row.reference)).filter(Boolean))].sort();
  const canonicalSql = canonical.map(sqlString).join(',');
  if (process.argv.includes('--validate-only')) {
    assertReadOnlySql(candidateSql(canonicalSql, 0));
    process.stdout.write('Validated Rolex missing-field recoverability read-only contract.\n'); return;
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN unavailable');
  const fxSnapshot = await fetchFxSnapshot();
  const prices = await priceCensus(canonicalSql, fxSnapshot);
  const images = await imageCensus(canonicalSql);
  const dealer = await linkageSummary(canonicalSql);
  const manifest = { contract: 'watchfacts-rolex-null-only-candidates-v1', project_ref: PROJECT_REF,
    generated_at: new Date().toISOString(), fx_snapshot: fxSnapshot,
    prices: prices.candidates, images: images.candidates };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const summary = { contract: 'watchfacts-rolex-missing-field-recoverability-v1', project_ref: PROJECT_REF,
    read_only: true, generated_at: manifest.generated_at, canonical_references: canonical.length,
    missing_price_rows_scanned: prices.scanned, recoverable_price_rows: prices.candidates.length,
    unrecoverable_price_rows: prices.scanned - prices.candidates.length, price_skip_reasons: prices.skipped,
    missing_image_rows_scanned: images.scanned, recoverable_image_rows: images.candidates.length,
    unrecoverable_image_rows: images.missingSource, dealer,
    recoverable_numeric_dealer_ratings: 0,
    raw_message_policy: 'immutable; URL-only source evidence is not rewritten',
    candidate_manifest_sha256: sha256(manifestText), raw_messages_exported: false, contact_values_exported: false };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'candidate-manifest.json'), manifestText);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { candidateSql, exactPriceCandidate };
