#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function managementQuery(sql) {
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      detail = String(parsed.message || parsed.error || parsed.code || '');
    } catch {
      detail = '';
    }
    detail = detail.replace(/[\r\n]+/g, ' ').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 240);
    throw new Error(`QNSA read-only census failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
  }
  return response.json();
}

function catalogReferenceKeys() {
  const catalog = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'catalog-source-v1.json'), 'utf8'));
  const keys = [...new Set((catalog.entries || [])
    .filter(entry => entry.brand === 'Omega')
    .map(entry => String(entry.normalized_reference || ''))
    .filter(key => /^[A-Z0-9]{3,50}$/.test(key)))].sort();
  if (keys.length < 500) throw new Error('Checked-in Omega catalog reference set is incomplete.');
  return keys;
}

function censusSql(keys) {
  const catalogArray = keys.map(sqlText).join(',');
  return `
SET statement_timeout = '90s';
SET lock_timeout = '5s';
WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true
), source AS MATERIALIZED (
  SELECT l.*
  FROM control c JOIN staging.listings l ON l.normalization_run_key = c.enabled_run_key
  WHERE upper(COALESCE(l.category, '')) = 'WATCH'
    AND l.brand_normalized = 'Omega'
    AND l.parent_id IS NULL AND COALESCE(l.is_bundle, false) = false
    AND COALESCE(l.provenance_metadata->>'bundle_status', 'SINGLE_CANDIDATE') = 'SINGLE_CANDIDATE'
    AND l.raw_message_version_id IS NOT NULL AND COALESCE(l.source_record_id, '') <> ''
    AND l.source_hash ~ '^[0-9a-f]{64}$' AND l.source_candidate_hash ~ '^[0-9a-f]{64}$'
    AND lower(COALESCE(l.trading_floor_status, '')) NOT IN (
      'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
      'withdrawn','rejected','hidden','deleted','archived')
    AND upper(COALESCE(l.verdict, '')) NOT IN ('WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
), marked AS MATERIALIZED (
  SELECT s.*,
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])omega([^[:alnum:]]|$)'
      AS raw_omega_brand,
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])(speedmaster|seamaster|constellation|de[ -]?ville)([^[:alnum:]]|$)'
      AS raw_omega_collection,
    regexp_replace(upper(COALESCE(s.reference_normalized, '')), '[^A-Z0-9]', '', 'g')
      = ANY(ARRAY[${catalogArray}]::text[]) AS catalog_omega_reference,
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])(rolex|patek|audemars|richard[ -]?mille|cartier|vacheron|panerai|iwc|hublot|tudor|breitling)([^[:alnum:]]|$)'
      AS competing_brand,
    upper(COALESCE(s.listing_type, s.intent, '')) AS source_intent,
    COALESCE(s.price_usd, s.price_normalized, 0) > 0 AS has_stored_price,
    btrim(COALESCE(s.image_url, s.source_media_url_candidate, '')) ~* '^https://[^[:space:]]+$'
      AS has_https_media
  FROM source s
), identity_safe AS MATERIALIZED (
  SELECT * FROM marked
  WHERE (raw_omega_brand OR raw_omega_collection OR catalog_omega_reference)
    AND NOT (competing_brand AND NOT raw_omega_brand)
), ranked AS MATERIALIZED (
  SELECT identity_safe.*,
    row_number() OVER (
      PARTITION BY COALESCE(NULLIF(btrim(contact_number), ''), NULLIF(btrim(from_number), ''),
        NULLIF(btrim(user_name), ''), NULLIF(btrim(from_name), ''), 'UNLINKED:' || source_record_id),
        source_candidate_hash
      ORDER BY created_at DESC, id DESC
    ) AS seller_candidate_rank
  FROM identity_safe
), released AS MATERIALIZED (
  SELECT * FROM ranked WHERE seller_candidate_rank = 1
), metrics AS (
  SELECT jsonb_build_object(
    'project_ref', '${PROJECT_REF}',
    'enabled_run_key', (SELECT enabled_run_key FROM control),
    'catalog_reference_keys', ${keys.length},
    'omega_source_rows', (SELECT count(*) FROM source),
    'raw_omega_brand_rows', (SELECT count(*) FROM marked WHERE raw_omega_brand),
    'raw_omega_collection_rows', (SELECT count(*) FROM marked WHERE raw_omega_collection),
    'catalog_omega_reference_rows', (SELECT count(*) FROM marked WHERE catalog_omega_reference),
    'competing_brand_rows', (SELECT count(*) FROM marked WHERE competing_brand),
    'identity_safe_rows', (SELECT count(*) FROM identity_safe),
    'identity_held_rows', (SELECT count(*) FROM marked) - (SELECT count(*) FROM identity_safe),
    'release_unique_individual_listings', (SELECT count(*) FROM released),
    'release_duplicates_excluded', (SELECT count(*) FROM identity_safe) - (SELECT count(*) FROM released),
    'release_wts_rows', (SELECT count(*) FROM released WHERE source_intent = 'WTS'),
    'release_wtb_rows', (SELECT count(*) FROM released WHERE source_intent = 'WTB'),
    'release_other_rows', (SELECT count(*) FROM released WHERE source_intent NOT IN ('WTS','WTB')),
    'release_priced_wts_rows', (SELECT count(*) FROM released WHERE source_intent = 'WTS' AND has_stored_price),
    'release_explicit_usd_usdt_wts_rows', (SELECT count(*) FROM released WHERE source_intent = 'WTS'
      AND COALESCE(price_usd, 0) > 0 AND upper(COALESCE(currency_normalized, '')) IN ('USD','USDT')),
    'release_dated_fx_wts_rows', (SELECT count(*) FROM released WHERE source_intent = 'WTS'
      AND COALESCE(price_usd, 0) > 0 AND COALESCE(conversion_rate, 0) > 0 AND conversion_timestamp IS NOT NULL),
    'release_owner_assumed_usd_candidates', (SELECT count(*) FROM released WHERE source_intent = 'WTS'
      AND COALESCE(price_normalized, 0) > 0 AND NULLIF(btrim(currency_normalized), '') IS NULL),
    'release_named_currency_requires_dated_fx', (SELECT count(*) FROM released WHERE source_intent = 'WTS'
      AND COALESCE(price_normalized, 0) > 0 AND NULLIF(btrim(currency_normalized), '') IS NOT NULL
      AND upper(currency_normalized) NOT IN ('USD','USDT')
      AND NOT (COALESCE(conversion_rate, 0) > 0 AND conversion_timestamp IS NOT NULL)),
    'release_price_not_supplied', (SELECT count(*) FROM released WHERE NOT has_stored_price),
    'release_exact_image_claim_rows', (SELECT count(*) FROM released WHERE public_image_eligible = true
      AND NULLIF(btrim(source_media_key), '') IS NOT NULL AND has_https_media),
    'release_exact_dealer_linked_rows', (SELECT count(*) FROM released r
      JOIN public.dealer_listing_links dl ON dl.listing_id = r.id AND dl.link_status = 'APPLIED'),
    'release_missing_reference_rows', (SELECT count(*) FROM released WHERE NULLIF(btrim(reference_normalized), '') IS NULL),
    'release_missing_model_rows', (SELECT count(*) FROM released WHERE NULLIF(btrim(model_normalized), '') IS NULL),
    'release_missing_dial_rows', (SELECT count(*) FROM released WHERE NULLIF(btrim(dial_color_normalized), '') IS NULL),
    'release_listing_ids_sha256', (SELECT encode(extensions.digest(convert_to(
      string_agg(id::text, E'\\n' ORDER BY id), 'UTF8'), 'sha256'), 'hex') FROM released),
    'generated_at', now()
  ) AS evidence
), models AS (
  SELECT COALESCE(NULLIF(btrim(model_normalized), ''), 'UNRESOLVED') AS model, count(*)::bigint AS row_count
  FROM released GROUP BY 1 ORDER BY row_count DESC, model LIMIT 50
), references AS (
  SELECT COALESCE(NULLIF(btrim(reference_normalized), ''), 'UNRESOLVED') AS reference, count(*)::bigint AS row_count
  FROM released GROUP BY 1 ORDER BY row_count DESC, reference LIMIT 100
)
SELECT jsonb_build_object(
  'evidence', (SELECT evidence FROM metrics),
  'models', COALESCE((SELECT jsonb_agg(to_jsonb(models)) FROM models), '[]'::jsonb),
  'top_references', COALESCE((SELECT jsonb_agg(to_jsonb(references)) FROM references), '[]'::jsonb)
) AS report;`;
}

async function main() {
  const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || 'omega-census.json');
  const rows = await managementQuery(censusSql(catalogReferenceKeys()));
  const report = rows?.[0]?.report;
  if (!report || report.evidence?.project_ref !== PROJECT_REF) throw new Error('Invalid census response.');
  if (Number(report.evidence.omega_source_rows || 0) < 1) throw new Error('No Omega source rows found.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    omega_source_rows: report.evidence.omega_source_rows,
    release_unique_individual_listings: report.evidence.release_unique_individual_listings,
    release_listing_ids_sha256: report.evidence.release_listing_ids_sha256,
  }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
