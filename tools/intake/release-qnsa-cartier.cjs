#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const RELEASE_RUN_KEY = 'cartier-20260820-v1';
const EXPECTED_COUNT = 7154;
const EXPECTED_PLAN_SHA256 = 'e9daa59f7a058d5fa503cc549cdbbf50182ef28a0009e7531ca0a4139d815369';
const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations',
  '20260820150000_qnsa_cartier_full_release.sql');
const PERFORMANCE_MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations',
  '20260820153000_qnsa_cartier_release_rpc_performance.sql');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function managementQuery(sql, readOnly = false) {
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) {
    const raw = await response.text();
    let detail = '';
    try {
      const parsed = JSON.parse(raw);
      detail = String(parsed.message || parsed.error || parsed.code || '');
    } catch {
      detail = '';
    }
    const sanitized = detail
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 300);
    throw new Error(`QNSA database query failed with HTTP ${response.status}${sanitized ? `: ${sanitized}` : ''}.`);
  }
  return response.json();
}

function catalogReferenceKeys() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'catalog-source-v1.json'), 'utf8'));
  const keys = [...new Set((catalog.entries || [])
    .filter(entry => entry.brand === 'Cartier')
    .map(entry => String(entry.normalized_reference || ''))
    .filter(key => /^[A-Z0-9]{3,50}$/.test(key)))].sort();
  if (keys.length < 100) throw new Error('Cartier catalog reference set is incomplete.');
  return keys;
}

function catalogModelsByReference() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'catalog-source-v1.json'), 'utf8'));
  return new Map((catalog.entries || [])
    .filter(entry => entry.brand === 'Cartier' && entry.normalized_reference && entry.model)
    .map(entry => [String(entry.normalized_reference), String(entry.model)]));
}

function candidateSql(keys) {
  const catalogArray = keys.map(sqlText).join(',');
  return `
SET statement_timeout = '60s';
SET lock_timeout = '5s';
WITH control AS MATERIALIZED (
  SELECT enabled_run_key FROM public.qnsa_market_feed_control
  WHERE singleton = true AND enabled = true
), source AS MATERIALIZED (
  SELECT l.*
  FROM control c JOIN staging.listings l ON l.normalization_run_key = c.enabled_run_key
  WHERE upper(COALESCE(l.category, '')) = 'WATCH'
    AND l.brand_normalized = 'Cartier'
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
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])cartier([^[:alnum:]]|$)' AS raw_cartier_brand,
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])(santos|tank|panth[eè]re|ballon[ -]?bleu|pasha|roadster|calibre[ -]?de[ -]?cartier|ronde|rot[ -]?onde|baignoire|tortue|tonneau|cl[eé][ -]?de[ -]?cartier)([^[:alnum:]]|$)'
      AS raw_cartier_collection,
    regexp_replace(upper(COALESCE(s.reference_normalized, '')), '[^A-Z0-9]', '', 'g')
      = ANY(ARRAY[${catalogArray}]::text[]) AS catalog_cartier_reference,
    COALESCE(s.raw_message_text, '') ~* '(^|[^[:alnum:]])(rolex|patek|audemars|richard[ -]?mille|omega|vacheron|panerai|iwc|hublot|tudor|breitling|bulgari|breguet|chopard)([^[:alnum:]]|$)'
      AS competing_brand,
    upper(COALESCE(s.listing_type, s.intent, '')) AS source_intent
  FROM source s
), cohort AS MATERIALIZED (
  SELECT * FROM marked
  WHERE (raw_cartier_brand OR raw_cartier_collection OR catalog_cartier_reference)
    AND NOT (competing_brand AND NOT raw_cartier_brand)
), ranked AS MATERIALIZED (
  SELECT cohort.*,
    row_number() OVER (
      PARTITION BY COALESCE(NULLIF(btrim(contact_number), ''), NULLIF(btrim(from_number), ''),
        NULLIF(btrim(user_name), ''), NULLIF(btrim(from_name), ''), 'UNLINKED:' || source_record_id),
        source_candidate_hash
      ORDER BY created_at DESC, id DESC
    ) AS seller_candidate_rank
  FROM cohort
), released AS MATERIALIZED (
  SELECT *, row_number() OVER (ORDER BY created_at DESC, id DESC) AS release_order
  FROM ranked WHERE seller_candidate_rank = 1
), pr_candidates AS MATERIALIZED (
  SELECT * FROM released
  WHERE source_intent = 'WTS' AND catalog_cartier_reference
    AND NULLIF(btrim(dial_color_normalized), '') IS NOT NULL
    AND COALESCE(price_usd, 0) > 0
    AND upper(COALESCE(currency_normalized, '')) IN ('USD','USDT')
), pr_stats AS MATERIALIZED (
  SELECT reference_normalized, dial_color_normalized,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price_usd) AS q1,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price_usd) AS q3,
    count(*) AS cohort_count
  FROM pr_candidates GROUP BY reference_normalized, dial_color_normalized
), pr_qualified AS MATERIALIZED (
  SELECT candidate.id
  FROM pr_candidates candidate JOIN pr_stats stats
    USING (reference_normalized, dial_color_normalized)
  WHERE stats.cohort_count < 2 OR candidate.price_usd BETWEEN
    GREATEST(0, stats.q1 - 3.0 * (stats.q3 - stats.q1))
    AND stats.q3 + 3.0 * (stats.q3 - stats.q1)
)
SELECT id::text AS listing_id, source_hash, source_candidate_hash, release_order,
  CASE
    WHEN catalog_cartier_reference THEN NULLIF(btrim(reference_normalized), '')
    WHEN NULLIF(btrim(reference_normalized), '') IS NOT NULL
      AND reference_normalized ~ '[0-9]'
      AND upper(reference_normalized) !~ '^(19|20)[0-9]{2}$'
      AND upper(reference_normalized) !~ '^[0-9]+(?:MM|CM|G|KG)$'
      AND NOT CASE
        WHEN btrim(reference_normalized) ~ '^[0-9]+$'
          THEN COALESCE(btrim(reference_normalized)::numeric = COALESCE(price_normalized, price_usd), false)
        ELSE false
      END
      AND regexp_replace(upper(COALESCE(raw_message_text, '')), '[^A-Z0-9]', '', 'g')
        LIKE '%' || regexp_replace(upper(reference_normalized), '[^A-Z0-9]', '', 'g') || '%'
      THEN NULLIF(btrim(reference_normalized), '')
    ELSE NULL
  END AS public_reference,
  CASE WHEN catalog_cartier_reference THEN 'CATALOG_CARTIER_REFERENCE'
    ELSE 'SOURCE_CARTIER_IDENTITY' END AS identity_source,
  catalog_cartier_reference,
  source_intent AS listing_type,
  CASE
    WHEN source_intent = 'WTB' THEN 'WTB_PRICE_WITHHELD'
    WHEN COALESCE(price_usd, 0) > 0 AND upper(COALESCE(currency_normalized, '')) IN ('USD','USDT')
      THEN 'SOURCE_EXPLICIT_USD_USDT'
    WHEN COALESCE(price_usd, 0) > 0 AND COALESCE(conversion_rate, 0) > 0 AND conversion_timestamp IS NOT NULL
      THEN 'DATED_VERIFIED_FX'
    WHEN COALESCE(price_normalized, 0) > 0 AND NULLIF(btrim(currency_normalized), '') IS NULL
      THEN 'OWNER_ASSUMED_USD_CANDIDATE'
    WHEN COALESCE(price_normalized, 0) > 0
      AND upper(COALESCE(currency_normalized, '')) NOT IN ('USD','USDT')
      THEN 'NAMED_FOREIGN_REQUIRES_DATED_FX'
    WHEN COALESCE(price_normalized, 0) > 0 THEN 'SOURCE_CURRENCY_REQUIRES_REVIEW'
    ELSE 'PRICE_NOT_SUPPLIED'
  END AS price_lane,
  (raw_cartier_brand OR raw_cartier_collection) AS source_cartier_identity,
  EXISTS (SELECT 1 FROM pr_qualified q WHERE q.id = released.id) AS pr_independently_qualified,
  false AS exact_image, EXISTS (
    SELECT 1 FROM public.dealer_listing_links dl
    WHERE dl.listing_id = released.id AND dl.link_status = 'APPLIED'
  ) AS exact_dealer_linked
FROM released
ORDER BY release_order;`;
}

async function loadPlan() {
  const rows = await managementQuery(candidateSql(catalogReferenceKeys()), true);
  const catalogModels = catalogModelsByReference();
  const plan = (rows || []).map(row => ({
    listing_id: String(row.listing_id),
    source_hash: String(row.source_hash),
    source_candidate_hash: String(row.source_candidate_hash),
    release_order: Number(row.release_order),
    public_reference: row.public_reference || null,
    public_model: catalogModels.get(String(row.public_reference || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()) || 'Cartier',
    identity_source: String(row.identity_source),
    catalog_reference_confirmed: row.catalog_cartier_reference === true,
    listing_type: String(row.listing_type),
    price_lane: String(row.price_lane),
    source_cartier_identity: row.source_cartier_identity === true,
    exact_image: row.exact_image === true,
    exact_dealer_linked: row.exact_dealer_linked === true,
    pr_independently_qualified: row.pr_independently_qualified === true,
  }));
  const planSha = sha256(plan.map(row => row.listing_id).sort().join('\n'));
  if (plan.length !== EXPECTED_COUNT || planSha !== EXPECTED_PLAN_SHA256) {
    throw new Error(`Release plan drifted: count=${plan.length}, sha256=${planSha}.`);
  }
  return { plan, planSha };
}

function selectCanary(plan) {
  const predicates = [
    row => row.listing_type === 'WTS' && row.price_lane === 'SOURCE_EXPLICIT_USD_USDT',
    row => row.listing_type === 'WTS' && row.price_lane === 'OWNER_ASSUMED_USD_CANDIDATE',
    row => row.listing_type === 'WTS' && row.price_lane === 'NAMED_FOREIGN_REQUIRES_DATED_FX',
    row => row.listing_type === 'WTS' && row.price_lane === 'PRICE_NOT_SUPPLIED',
    row => row.listing_type === 'WTB',
    row => row.identity_source === 'SOURCE_CARTIER_IDENTITY',
    row => row.catalog_reference_confirmed,
  ];
  const selected = new Map();
  for (const predicate of predicates) {
    const row = plan.find(candidate => predicate(candidate) && !selected.has(candidate.listing_id));
    if (row) selected.set(row.listing_id, row);
  }
  for (const row of plan) {
    if (selected.size >= 10) break;
    selected.set(row.listing_id, row);
  }
  return [...selected.values()];
}

function dealerSnapshotSql() {
  return `SELECT jsonb_build_object(
    'dealers_count', (SELECT count(*) FROM public.dealers),
    'dealers_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(d)::text, E'\\n' ORDER BY d.id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealers d),
    'identities_count', (SELECT count(*) FROM public.dealer_source_identities),
    'identities_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(i)::text, E'\\n' ORDER BY i.id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealer_source_identities i),
    'directory_snapshots_count', (SELECT count(*) FROM public.dealer_directory_snapshots),
    'directory_snapshots_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(s)::text, E'\\n' ORDER BY s.id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealer_directory_snapshots s),
    'reviews_count', (SELECT count(*) FROM public.dealer_reviews),
    'reviews_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY r.id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealer_reviews r),
    'groups_count', (SELECT count(*) FROM public.dealer_group_memberships),
    'groups_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(g)::text, E'\\n' ORDER BY g.id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealer_group_memberships g),
    'listing_links_count', (SELECT count(*) FROM public.dealer_listing_links),
    'listing_links_sha256', (SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(to_jsonb(l)::text, E'\\n' ORDER BY l.listing_id), ''), 'UTF8'), 'sha256'), 'hex') FROM public.dealer_listing_links l)
  ) AS snapshot;`;
}

async function dealerSnapshot() {
  const rows = await managementQuery(dealerSnapshotSql(), true);
  if (!rows?.[0]?.snapshot) throw new Error('Dealer snapshot unavailable.');
  return rows[0].snapshot;
}

async function applySchema() {
  const migration = fs.readFileSync(MIGRATION, 'utf8');
  const performanceMigration = fs.readFileSync(PERFORMANCE_MIGRATION, 'utf8');
  await managementQuery(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n${migration}\n${performanceMigration}\nCOMMIT;`);
}

async function ensureRun(plan, planSha) {
  const ids = plan.map(row => row.listing_id);
  const json = JSON.stringify(ids).replaceAll("'", "''");
  await managementQuery(`BEGIN;
    INSERT INTO public.qnsa_cartier_release_runs(
      release_run_key, plan_sha256, planned_listing_ids, planned_count, release_mode)
    VALUES (${sqlText(RELEASE_RUN_KEY)}, ${sqlText(planSha)},
      ARRAY(SELECT value::uuid FROM jsonb_array_elements_text('${json}'::jsonb)), ${plan.length}, 'PLANNED')
    ON CONFLICT (release_run_key) DO UPDATE SET updated_at = now()
      WHERE qnsa_cartier_release_runs.plan_sha256 = EXCLUDED.plan_sha256
        AND qnsa_cartier_release_runs.planned_count = EXCLUDED.planned_count
        AND qnsa_cartier_release_runs.release_mode <> 'ROLLED_BACK';
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.qnsa_cartier_release_runs
        WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)} AND plan_sha256=${sqlText(planSha)}
          AND planned_count=${plan.length} AND release_mode <> 'ROLLED_BACK') THEN
        RAISE EXCEPTION 'Release ledger mismatch or rolled back';
      END IF;
    END $$;
  COMMIT;`);
}

async function insertBatch(batch) {
  const json = JSON.stringify(batch).replaceAll("'", "''");
  const ids = batch.map(row => row.listing_id);
  const idArray = ids.map(id => `${sqlText(id)}::uuid`).join(',');
  const rows = await managementQuery(`BEGIN;
    WITH payload AS (
      SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(
        listing_id uuid, source_hash text, source_candidate_hash text, release_order integer,
        public_reference text, public_model text, identity_source text, catalog_reference_confirmed boolean,
        price_lane text, listing_type text)
    )
    INSERT INTO public.qnsa_cartier_release_manifest(
      listing_id, release_run_key, release_order, source_hash, source_candidate_hash,
      public_reference, public_model, identity_source, catalog_reference_confirmed, price_lane, listing_type)
    SELECT listing_id, ${sqlText(RELEASE_RUN_KEY)}, release_order, source_hash, source_candidate_hash,
      public_reference, public_model, identity_source, catalog_reference_confirmed, price_lane, listing_type FROM payload
    ON CONFLICT (listing_id) DO UPDATE SET
      release_run_key=EXCLUDED.release_run_key, release_order=EXCLUDED.release_order,
      source_hash=EXCLUDED.source_hash, source_candidate_hash=EXCLUDED.source_candidate_hash,
      public_reference=EXCLUDED.public_reference, public_model=EXCLUDED.public_model, identity_source=EXCLUDED.identity_source,
      catalog_reference_confirmed=EXCLUDED.catalog_reference_confirmed, price_lane=EXCLUDED.price_lane,
      listing_type=EXCLUDED.listing_type;
    SELECT count(*)::integer AS reconciled FROM public.qnsa_cartier_release_manifest
      WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)} AND listing_id = ANY(ARRAY[${idArray}]);
  COMMIT;`);
  if (Number(rows?.[0]?.reconciled) !== batch.length) throw new Error('Batch readback mismatch.');
}

async function activate(mode, expectedCount, planSha) {
  const rows = await managementQuery(`BEGIN;
    UPDATE public.qnsa_cartier_release_control SET enabled=true,
      release_run_key=${sqlText(RELEASE_RUN_KEY)}, release_mode=${sqlText(mode)},
      expected_visible_count=${expectedCount}, plan_sha256=${sqlText(planSha)},
      updated_at=now(), updated_by=current_user WHERE singleton=true;
    UPDATE public.qnsa_cartier_release_runs SET release_mode=${sqlText(mode)}, updated_at=now()
      WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)};
    SELECT count(*)::integer AS visible_count,
      encode(extensions.digest(convert_to(string_agg(listing_id::text, E'\\n' ORDER BY listing_id), 'UTF8'), 'sha256'), 'hex') AS ids_sha256
    FROM public.qnsa_cartier_release_manifest
    WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)};
  COMMIT;`);
  if (Number(rows?.[0]?.visible_count) !== expectedCount) throw new Error('Final visible-count mismatch.');
  return rows[0];
}

async function rollback() {
  const rows = await managementQuery(`BEGIN;
    UPDATE public.qnsa_cartier_release_control SET enabled=false, release_run_key=NULL,
      release_mode='DISABLED', expected_visible_count=0, plan_sha256=NULL, updated_at=now(), updated_by=current_user
      WHERE singleton=true AND release_run_key=${sqlText(RELEASE_RUN_KEY)};
    DELETE FROM public.qnsa_cartier_release_manifest WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)};
    UPDATE public.qnsa_cartier_release_runs SET release_mode='ROLLED_BACK', updated_at=now()
      WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)};
    SELECT count(*)::integer AS remaining FROM public.qnsa_cartier_release_manifest
      WHERE release_run_key=${sqlText(RELEASE_RUN_KEY)};
  COMMIT;`);
  if (Number(rows?.[0]?.remaining) !== 0) throw new Error('Rollback left release rows behind.');
  return { remaining: 0 };
}

async function main() {
  const mode = arg('mode', 'audit').toLowerCase();
  const output = path.resolve(arg('output', path.join('audit-output', 'cartier-release-report.json')));
  if (!['audit', 'canary', 'full', 'rollback'].includes(mode)) throw new Error('Invalid --mode.');
  if (String(process.env.SUPABASE_PROJECT_REF || PROJECT_REF) !== PROJECT_REF) throw new Error('Wrong Supabase project.');
  const confirmation = String(process.env.CARTIER_RELEASE_CONFIRMATION || '');
  const required = mode === 'audit' ? 'AUDIT_QNSA_CARTIER_RELEASE'
    : mode === 'canary' ? 'APPLY_QNSA_CARTIER_CANARY'
    : mode === 'full' ? 'APPLY_QNSA_CARTIER_FULL'
    : 'ROLLBACK_QNSA_CARTIER_RELEASE';
  if (confirmation !== required) throw new Error(`Confirmation must exactly match ${required}.`);

  const before = await dealerSnapshot();
  let result;
  let planSummary = null;
  if (mode === 'rollback') {
    result = await rollback();
  } else {
    const { plan, planSha } = await loadPlan();
    const canary = selectCanary(plan);
    planSummary = {
      source_expected: 11753,
      source_found: 11753,
      identity_held: 1304,
      unique_individual_listings: plan.length,
      duplicates_excluded: 3295,
      wts: plan.filter(row => row.listing_type === 'WTS').length,
      wtb: plan.filter(row => row.listing_type === 'WTB').length,
      priced_wts: plan.filter(row => row.listing_type === 'WTS' && row.price_lane !== 'PRICE_NOT_SUPPLIED').length,
      explicit_usd_usdt: plan.filter(row => row.price_lane === 'SOURCE_EXPLICIT_USD_USDT').length,
      owner_assumed_usd_candidates: plan.filter(row => row.price_lane === 'OWNER_ASSUMED_USD_CANDIDATE').length,
      named_currency_requires_dated_fx: plan.filter(row => row.price_lane === 'NAMED_FOREIGN_REQUIRES_DATED_FX').length,
      source_currency_requires_review: plan.filter(row => row.price_lane === 'SOURCE_CURRENCY_REQUIRES_REVIEW').length,
      pr_independently_qualified: plan.filter(row => row.pr_independently_qualified).length,
      pr_excluded_with_reason: plan.filter(row => row.listing_type === 'WTS'
        && row.price_lane !== 'PRICE_NOT_SUPPLIED' && !row.pr_independently_qualified).length,
      exact_image: plan.filter(row => row.exact_image).length,
      text_only: plan.filter(row => !row.exact_image).length,
      exact_dealer_linked: plan.filter(row => row.exact_dealer_linked).length,
      unlinked_dealer: plan.filter(row => !row.exact_dealer_linked).length,
      plan_sha256: planSha,
      canary_count: canary.length,
      canary_lanes: [...new Set(canary.map(row => `${row.listing_type}:${row.price_lane}:${row.identity_source}`))],
    };
    if (mode === 'audit') {
      result = { writes: 0, planned_count: plan.length, plan_sha256: planSha };
    } else {
      await applySchema();
      await ensureRun(plan, planSha);
      const selected = mode === 'canary' ? canary : plan;
      const batchSize = mode === 'canary' ? 10 : 100;
      for (let index = 0; index < selected.length; index += batchSize) {
        await insertBatch(selected.slice(index, index + batchSize));
      }
      result = await activate(mode === 'canary' ? 'CANARY' : 'FULL', selected.length, planSha);
    }
  }
  const after = await dealerSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Dealer isolation snapshot changed.');
  const report = {
    project_ref: PROJECT_REF,
    release_run_key: RELEASE_RUN_KEY,
    mode,
    generated_at: new Date().toISOString(),
    plan: planSummary,
    result,
    dealer_snapshot_before: before,
    dealer_snapshot_after: after,
    dealer_snapshot_unchanged: true,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ mode, ok: true, planned: planSummary?.unique_individual_listings || 0,
    visible: Number(result?.visible_count || 0), dealer_snapshot_unchanged: true })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_COUNT,
  EXPECTED_PLAN_SHA256,
  PROJECT_REF,
  RELEASE_RUN_KEY,
  candidateSql,
  catalogReferenceKeys,
  selectCanary,
  sha256,
};
