'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const RUN_ID = '17d6d831-86cd-5e67-9830-c881bcf16e0d';
const EXPECTED = Object.freeze({
  Rolex: { total: 1535763, wts: 1386508, wtb: 149255, priceResearch: 38521 },
  'Patek Philippe': { total: 937001, wts: 884326, wtb: 52675, priceResearch: 45638 },
});

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeError(error) {
  const message = String(error?.message || error || 'unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED_JWT]');
  return { message: message.slice(0, 800) };
}

async function managementQuery(accessToken, name, sql, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${name} returned non-JSON evidence`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} returned an unexpected payload`);
  return parsed;
}

const QUERIES = Object.freeze({
  contracts: `
    SELECT jsonb_build_object(
      'run_table',to_regclass('public.curated_luxury_shadow_runs') IS NOT NULL,
      'current_table',to_regclass('public.curated_luxury_current_listings_shadow') IS NOT NULL,
      'offer_states_table',to_regclass('public.curated_luxury_offer_states_shadow') IS NOT NULL,
      'references_table',to_regclass('public.curated_luxury_observed_references_shadow') IS NOT NULL,
      'parent_lineage_table',to_regclass('public.curated_luxury_raw_parent_lineage_shadow') IS NOT NULL,
      'version_lineage_table',to_regclass('public.curated_luxury_raw_version_lineage_shadow') IS NOT NULL,
      'dealer_lineage_table',to_regclass('public.curated_luxury_dealer_lineage_shadow') IS NOT NULL,
      'image_assets_table',to_regclass('public.curated_luxury_child_image_assets_shadow') IS NOT NULL,
      'image_links_table',to_regclass('public.curated_luxury_child_image_links_shadow') IS NOT NULL,
      'rolex_price_evidence_table',to_regclass('public.curated_luxury_rolex_price_evidence_shadow') IS NOT NULL,
      'page_keys_v7',to_regprocedure('public.curated_luxury_shadow_customer_page_keys_v7(uuid,text,text[],text[],boolean,boolean,text,text,smallint,smallint,timestamptz,text,boolean,integer)') IS NOT NULL,
      'cards_v3',to_regprocedure('public.curated_luxury_shadow_customer_cards_v3(uuid,text[])') IS NOT NULL,
      'rolex_cards_v4',to_regprocedure('public.curated_luxury_rolex_customer_cards_v4(uuid,text[])') IS NOT NULL
    ) AS evidence;`,

  run_state: `
    SELECT jsonb_build_object(
      'run_id',run_id,'contract',contract,'status',status,'decision',decision,
      'created_at',created_at,'completed_at',completed_at,
      'reconciliation',reconciliation
    ) AS evidence
    FROM public.curated_luxury_shadow_runs
    WHERE run_id='${RUN_ID}'::uuid;`,

  inventory_coverage: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT brand,
        count(*)::bigint AS total,
        count(*) FILTER (WHERE intent='WTS')::bigint AS wts,
        count(*) FILTER (WHERE intent='WTB')::bigint AS wtb,
        count(*) FILTER (WHERE current_status='CURRENT_ACTIVE')::bigint AS current_active,
        count(*) FILTER (WHERE current_status='CURRENT_LATEST_STATE')::bigint AS current_latest_state,
        count(*) FILTER (WHERE cohort_status='CONFIRMED_CURRENT')::bigint AS confirmed_current,
        count(*) FILTER (WHERE cohort_status='LATEST_OBSERVED')::bigint AS latest_observed,
        count(*) FILTER (WHERE current_status NOT IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE'))::bigint AS invalid_customer_status,
        count(*) FILTER (WHERE cohort_status='CONFIRMED_CURRENT' AND current_status<>'CURRENT_ACTIVE')::bigint AS invalid_confirmed_mapping,
        count(*) FILTER (WHERE cohort_status='LATEST_OBSERVED' AND current_status<>'CURRENT_LATEST_STATE')::bigint AS invalid_latest_mapping,
        count(*) FILTER (WHERE source_timestamp IS NULL)::bigint AS missing_source_timestamp,
        count(*) FILTER (WHERE nullif(btrim(observed_reference),'') IS NULL)::bigint AS missing_observed_reference,
        count(*) FILTER (WHERE nullif(btrim(observed_reference_key),'') IS NULL)::bigint AS missing_reference_key,
        count(*) FILTER (WHERE nullif(btrim(source_identity_key),'') IS NULL)::bigint AS missing_source_identity_key,
        count(*) FILTER (WHERE nullif(btrim(search_text),'') IS NULL)::bigint AS missing_search_text,
        count(*) FILTER (WHERE price_verified)::bigint AS base_verified_price,
        count(*) FILTER (WHERE image_linked)::bigint AS raw_image_linked,
        count(*) FILTER (WHERE dealer_key IS NOT NULL)::bigint AS dealer_key_present,
        count(*) FILTER (WHERE dealer_rating_qualified)::bigint AS dealer_rating_qualified,
        count(*) FILTER (WHERE country_code IS NOT NULL)::bigint AS country_present,
        count(*) FILTER (WHERE parent_raw_text_sha256 IS NOT NULL
          AND exact_child_text_sha256=parent_raw_text_sha256)::bigint AS single_input,
        count(*) FILTER (WHERE parent_raw_text_sha256 IS NULL
          OR exact_child_text_sha256 IS DISTINCT FROM parent_raw_text_sha256)::bigint AS deterministic_multi_child,
        count(*) FILTER (WHERE current_listing_key IS NULL OR offer_family_key IS NULL
          OR offer_state_key IS NULL OR latest_raw_occurrence_key IS NULL
          OR unique_observation_key IS NULL OR parent_key IS NULL OR version_key IS NULL
          OR source_key IS NULL OR exact_child_text_sha256 IS NULL)::bigint AS missing_required_lineage_key
      FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
      GROUP BY brand
    ) summary;`,

  uniqueness_contracts: `
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'constraint_name',conname,'constraint_type',contype,
      'definition',pg_get_constraintdef(oid,true)
    ) ORDER BY conname),'[]'::jsonb) AS evidence
    FROM pg_constraint
    WHERE conrelid='public.curated_luxury_current_listings_shadow'::regclass
      AND contype IN ('p','u');`,

  duplicate_identities: `
    WITH offer_state_duplicates AS (
      SELECT brand,count(*)::bigint group_size
      FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
        AND current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      GROUP BY brand,offer_state_key HAVING count(*)>1
    ), observation_duplicates AS (
      SELECT brand,count(*)::bigint group_size
      FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
        AND current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      GROUP BY brand,unique_observation_key HAVING count(*)>1
    )
    SELECT jsonb_build_object(
      'duplicate_offer_state_groups',(SELECT count(*) FROM offer_state_duplicates),
      'duplicate_offer_state_extra_rows',(SELECT coalesce(sum(group_size-1),0) FROM offer_state_duplicates),
      'duplicate_observation_groups',(SELECT count(*) FROM observation_duplicates),
      'duplicate_observation_extra_rows',(SELECT coalesce(sum(group_size-1),0) FROM observation_duplicates)
    ) AS evidence;`,

  lineage_resolution: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT c.brand,count(*)::bigint AS total,
        count(*) FILTER (WHERE parent_bridge.parent_key IS NULL)::bigint AS missing_parent_bridge,
        count(*) FILTER (WHERE version_bridge.version_key IS NULL)::bigint AS missing_version_bridge,
        count(*) FILTER (WHERE rm.id IS NULL)::bigint AS missing_raw_parent,
        count(*) FILTER (WHERE rv.id IS NULL)::bigint AS missing_raw_version,
        count(*) FILTER (WHERE rm.id IS NOT NULL AND rv.id IS NOT NULL
          AND rv.raw_message_id<>rm.id)::bigint AS version_parent_mismatch
      FROM public.curated_luxury_current_listings_shadow c
      LEFT JOIN public.curated_luxury_raw_parent_lineage_shadow parent_bridge
        ON parent_bridge.parent_key=c.parent_key
      LEFT JOIN public.raw_messages rm ON rm.id=parent_bridge.raw_message_id
      LEFT JOIN public.curated_luxury_raw_version_lineage_shadow version_bridge
        ON version_bridge.version_key=c.version_key
      LEFT JOIN public.raw_message_versions rv ON rv.id=version_bridge.raw_version_id
      WHERE c.run_id='${RUN_ID}'::uuid AND c.brand IN ('Rolex','Patek Philippe')
        AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      GROUP BY c.brand
    ) summary;`,

  price_integrity: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT brand,
        count(*) FILTER (WHERE price_verified)::bigint AS base_verified,
        count(*) FILTER (WHERE price_verified AND (normalized_usd_amount IS NULL OR normalized_usd_amount<=0))::bigint AS invalid_verified_usd,
        count(*) FILTER (WHERE price_verified AND (source_price_amount IS NULL OR source_price_amount<=0))::bigint AS verified_missing_source_amount,
        count(*) FILTER (WHERE price_verified AND nullif(btrim(source_currency),'') IS NULL)::bigint AS verified_missing_source_currency,
        count(*) FILTER (WHERE price_verified AND upper(source_currency) IN ('USD','USDT'))::bigint AS direct_usd_usdt,
        count(*) FILTER (WHERE price_verified AND upper(source_currency) NOT IN ('USD','USDT'))::bigint AS verified_foreign_fx,
        count(*) FILTER (WHERE NOT price_verified)::bigint AS requires_price_review
      FROM public.curated_luxury_current_listings_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
        AND current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      GROUP BY brand
    ) summary;`,

  rolex_price_sidecar: `
    SELECT jsonb_build_object(
      'latest_evidence_rows',count(*),
      'verified_display',count(*) FILTER (WHERE decision='VERIFIED' AND display_price_verified),
      'price_research_eligible',count(*) FILTER (WHERE decision='VERIFIED' AND price_research_eligible),
      'review_required',count(*) FILTER (WHERE decision='REVIEW_REQUIRED'),
      'invalid_verified_usd',count(*) FILTER (WHERE decision='VERIFIED' AND display_price_verified
        AND (normalized_usd_amount IS NULL OR normalized_usd_amount<=0)),
      'verified_missing_source',count(*) FILTER (WHERE decision='VERIFIED' AND display_price_verified
        AND (source_price_amount IS NULL OR source_price_amount<=0 OR nullif(btrim(source_currency),'') IS NULL))
    ) AS evidence
    FROM public.curated_luxury_rolex_latest_price_evidence_v2
    WHERE run_id='${RUN_ID}'::uuid;`,

  price_research: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT brand,
        count(*) FILTER (WHERE qualified_price_research)::bigint AS qualified,
        count(*) FILTER (WHERE qualified_price_research
          AND (normalized_usd_amount IS NULL OR normalized_usd_amount<=0))::bigint AS invalid_qualified_usd,
        count(*) FILTER (WHERE qualified_price_research
          AND (source_price_amount IS NULL OR source_price_amount<=0
            OR nullif(btrim(source_currency),'') IS NULL))::bigint AS qualified_missing_original_price,
        coalesce(sum(repost_same_offer_count) FILTER (WHERE qualified_price_research),0)::bigint AS preserved_repost_evidence
      FROM public.curated_luxury_offer_states_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
      GROUP BY brand
    ) summary;`,

  observed_references: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT brand,count(*)::bigint AS distinct_observed_references,
        count(*) FILTER (WHERE catalog_status='OBSERVED_ONLY')::bigint AS observed_only,
        count(*) FILTER (WHERE catalog_status='CATALOG_CONFIRMED')::bigint AS catalog_confirmed,
        count(*) FILTER (WHERE qualified_comparable_states>=2)::bigint AS rating_ready_references,
        sum(current_listing_count)::bigint AS indexed_current_listings,
        sum(qualified_comparable_states)::bigint AS indexed_qualified_comparables
      FROM public.curated_luxury_observed_references_shadow
      WHERE run_id='${RUN_ID}'::uuid AND brand IN ('Rolex','Patek Philippe')
      GROUP BY brand
    ) summary;`,

  image_integrity: `
    WITH linked AS (
      SELECT c.brand,l.current_listing_key,l.raw_occurrence_key,l.image_evidence_type,
        a.customer_safe,a.source_url,
        (c.current_listing_key IS NOT NULL AND c.latest_raw_occurrence_key=l.raw_occurrence_key) AS exact_current_occurrence
      FROM public.curated_luxury_child_image_links_shadow l
      JOIN public.curated_luxury_child_image_assets_shadow a USING(source_image_key)
      LEFT JOIN public.curated_luxury_current_listings_shadow c
        ON c.run_id=l.run_id AND c.current_listing_key=l.current_listing_key
      WHERE l.run_id='${RUN_ID}'::uuid
    )
    SELECT jsonb_build_object(
      'by_brand',coalesce((SELECT jsonb_agg(to_jsonb(summary) ORDER BY brand) FROM (
        SELECT brand,count(DISTINCT current_listing_key) FILTER (WHERE exact_current_occurrence
          AND image_evidence_type='SELLER_LISTING_IMAGE' AND customer_safe)::bigint AS verified_image_listings,
          count(*) FILTER (WHERE exact_current_occurrence AND image_evidence_type='SELLER_LISTING_IMAGE'
            AND customer_safe)::bigint AS verified_image_urls
        FROM linked WHERE brand IN ('Rolex','Patek Philippe') GROUP BY brand
      ) summary),'[]'::jsonb),
      'orphan_or_wrong_occurrence_links',(SELECT count(*) FROM linked WHERE NOT exact_current_occurrence),
      'customer_safe_non_seller_links',(SELECT count(*) FROM linked
        WHERE customer_safe AND image_evidence_type<>'SELLER_LISTING_IMAGE'),
      'invalid_urls',(SELECT count(*) FROM linked WHERE customer_safe
        AND nullif(btrim(source_url),'') IS NULL)
    ) AS evidence;`,

  dealer_integrity: `
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT c.brand,
        count(*) FILTER (WHERE c.dealer_key IS NOT NULL)::bigint AS dealer_key_present,
        count(*) FILTER (WHERE c.dealer_key IS NOT NULL AND bridge.dealer_id IS NULL)::bigint AS missing_dealer_bridge,
        count(*) FILTER (WHERE bridge.dealer_id IS NOT NULL AND d.id IS NULL)::bigint AS missing_dealer_profile,
        count(*) FILTER (WHERE c.dealer_rating_qualified)::bigint AS rating_qualified_flag,
        count(*) FILTER (WHERE c.dealer_rating_qualified AND d.status='VERIFIED'
          AND d.rating IS NOT NULL AND d.review_count>0)::bigint AS evidence_backed_rating,
        count(*) FILTER (WHERE c.dealer_rating_qualified AND NOT coalesce(d.status='VERIFIED'
          AND d.rating IS NOT NULL AND d.review_count>0,false))::bigint AS invalid_rating_qualification
      FROM public.curated_luxury_current_listings_shadow c
      LEFT JOIN public.curated_luxury_dealer_lineage_shadow bridge ON bridge.dealer_key=c.dealer_key
      LEFT JOIN public.dealers d ON d.id=bridge.dealer_id
      WHERE c.run_id='${RUN_ID}'::uuid AND c.brand IN ('Rolex','Patek Philippe')
        AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
      GROUP BY c.brand
    ) summary;`,

  customer_card_canary: `
    WITH selected AS MATERIALIZED (
      (SELECT c.brand,c.current_listing_key,c.source_timestamp
       FROM public.curated_luxury_current_listings_shadow c
       WHERE c.run_id='${RUN_ID}'::uuid AND c.brand='Rolex'
         AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
         AND c.parent_raw_text_sha256 IS NOT NULL
         AND c.exact_child_text_sha256=c.parent_raw_text_sha256
       ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC LIMIT 24)
      UNION ALL
      (SELECT c.brand,c.current_listing_key,c.source_timestamp
       FROM public.curated_luxury_current_listings_shadow c
       WHERE c.run_id='${RUN_ID}'::uuid AND c.brand='Patek Philippe'
         AND c.current_status IN ('CURRENT_ACTIVE','CURRENT_LATEST_STATE')
         AND c.parent_raw_text_sha256 IS NOT NULL
         AND c.exact_child_text_sha256=c.parent_raw_text_sha256
       ORDER BY c.source_timestamp DESC NULLS LAST,c.current_listing_key DESC LIMIT 24)
    ), key_sets AS (
      SELECT brand,array_agg(current_listing_key ORDER BY source_timestamp DESC NULLS LAST,
        current_listing_key DESC) AS listing_keys
      FROM selected GROUP BY brand
    ), cards AS (
      SELECT keys.brand,card.value AS card
      FROM key_sets keys
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN keys.brand='Rolex'
          THEN public.curated_luxury_rolex_customer_cards_v4('${RUN_ID}'::uuid,keys.listing_keys)
          ELSE public.curated_luxury_shadow_customer_cards_v3('${RUN_ID}'::uuid,keys.listing_keys)
        END
      ) card
    )
    SELECT coalesce(jsonb_agg(to_jsonb(summary) ORDER BY brand),'[]'::jsonb) AS evidence
    FROM (
      SELECT brand,count(*)::bigint AS returned_cards,
        count(*) FILTER (WHERE nullif(btrim(card->>'reference'),'') IS NULL)::bigint AS missing_reference,
        count(*) FILTER (WHERE nullif(btrim(card->>'listing_type'),'') IS NULL)::bigint AS missing_intent,
        count(*) FILTER (WHERE nullif(btrim(card->>'created_at'),'') IS NULL)::bigint AS missing_posting_date,
        count(*) FILTER (WHERE nullif(btrim(card->>'raw_message'),'') IS NULL)::bigint AS missing_raw_message,
        count(*) FILTER (WHERE nullif(btrim(card->>'source_identity_key'),'') IS NULL
          AND nullif(btrim(card->>'dealer_name'),'') IS NULL)::bigint AS missing_poster_or_dealer_evidence,
        count(*) FILTER (WHERE (card->>'price_verified')::boolean
          AND ((card->>'price_usd') IS NULL OR (card->>'price_usd')::numeric<=0))::bigint AS invalid_verified_price,
        count(*) FILTER (WHERE card->>'current_status' NOT IN
          ('CURRENT_ACTIVE','CURRENT_LATEST_STATE'))::bigint AS invalid_availability,
        count(*) FILTER (WHERE card->>'image_state'='VERIFIED_CHILD_IMAGE'
          AND jsonb_array_length(coalesce(card->'verified_child_media','[]'::jsonb))=0)::bigint AS invalid_verified_image_state,
        count(*) FILTER (WHERE (card->>'dealer_rating') IS NOT NULL
          AND ((card->>'dealer_review_count') IS NULL
            OR (card->>'dealer_review_count')::integer<=0))::bigint AS invalid_dealer_rating
      FROM cards GROUP BY brand
    ) summary;`,
});

function firstEvidence(rows) {
  return rows?.[0]?.evidence ?? null;
}

function byBrand(value) {
  return new Map((Array.isArray(value) ? value : []).map(row => [row.brand, row]));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assess(results) {
  const blockers = [];
  const run = results.run_state?.evidence;
  if (!run || run.status !== 'COMPLETE') blockers.push('SHADOW_RUN_NOT_COMPLETE');

  const inventory = byBrand(results.inventory_coverage?.evidence);
  const priceResearch = byBrand(results.price_research?.evidence);
  for (const [brand, expected] of Object.entries(EXPECTED)) {
    const row = inventory.get(brand);
    if (!row) {
      blockers.push(`MISSING_${brand.toUpperCase().replace(/\W+/g, '_')}_INVENTORY`);
      continue;
    }
    for (const field of ['total', 'wts', 'wtb']) {
      if (numeric(row[field]) !== expected[field]) {
        blockers.push(`${brand}:${field.toUpperCase()}_COUNT_MISMATCH`);
      }
    }
    for (const field of ['invalid_customer_status', 'invalid_confirmed_mapping',
      'invalid_latest_mapping', 'missing_required_lineage_key']) {
      if (numeric(row[field]) !== 0) blockers.push(`${brand}:${field.toUpperCase()}`);
    }
    const pr = priceResearch.get(brand);
    if (!pr || numeric(pr.qualified) !== expected.priceResearch) {
      blockers.push(`${brand}:PRICE_RESEARCH_COUNT_MISMATCH`);
    }
    if (pr && (numeric(pr.invalid_qualified_usd) !== 0
      || numeric(pr.qualified_missing_original_price) !== 0)) {
      blockers.push(`${brand}:INVALID_PRICE_RESEARCH_EVIDENCE`);
    }
  }

  const duplicates = results.duplicate_identities?.evidence;
  if (!duplicates || numeric(duplicates.duplicate_offer_state_extra_rows) !== 0
    || numeric(duplicates.duplicate_observation_extra_rows) !== 0) {
    blockers.push('DUPLICATE_CUSTOMER_IDENTITIES');
  }

  for (const row of results.lineage_resolution?.evidence || []) {
    for (const field of ['missing_parent_bridge', 'missing_version_bridge', 'missing_raw_parent',
      'missing_raw_version', 'version_parent_mismatch']) {
      if (numeric(row[field]) !== 0) blockers.push(`${row.brand}:${field.toUpperCase()}`);
    }
  }

  const images = results.image_integrity?.evidence;
  if (!images || numeric(images.orphan_or_wrong_occurrence_links) !== 0
    || numeric(images.customer_safe_non_seller_links) !== 0
    || numeric(images.invalid_urls) !== 0) blockers.push('UNSAFE_IMAGE_EVIDENCE');

  for (const row of results.dealer_integrity?.evidence || []) {
    if (numeric(row.invalid_rating_qualification) !== 0) {
      blockers.push(`${row.brand}:INVALID_DEALER_RATING_QUALIFICATION`);
    }
  }

  for (const row of results.customer_card_canary?.evidence || []) {
    if (numeric(row.returned_cards) !== 24) blockers.push(`${row.brand}:CARD_CANARY_SHORT_PAGE`);
    for (const field of ['missing_reference', 'missing_intent', 'missing_posting_date',
      'missing_raw_message', 'missing_poster_or_dealer_evidence', 'invalid_verified_price',
      'invalid_availability', 'invalid_verified_image_state', 'invalid_dealer_rating']) {
      if (numeric(row[field]) !== 0) blockers.push(`${row.brand}:CARD_${field.toUpperCase()}`);
    }
  }

  for (const [name, result] of Object.entries(results)) {
    if (result.error) blockers.push(`QUERY_FAILED:${name}`);
  }
  return [...new Set(blockers)];
}

async function main() {
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const projectRef = String(process.env.SUPABASE_PROJECT_REF || PROJECT_REF).trim();
  if (projectRef !== PROJECT_REF) throw new Error('Refusing non-canonical Supabase project');
  const outputPath = path.resolve(process.env.QNSA_COMPLETION_AUDIT_OUTPUT
    || 'audit-output/qnsa-rolex-patek-completion-audit.json');
  const results = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    try {
      const rows = await managementQuery(accessToken, name, sql);
      results[name] = { status: 'PASS', evidence: firstEvidence(rows) };
    } catch (error) {
      results[name] = { status: 'ERROR', error: safeError(error) };
    }
  }
  const blockers = assess(results);
  const report = {
    contract: 'qnsa-rolex-patek-completion-audit-v1',
    project_ref: PROJECT_REF,
    run_id: RUN_ID,
    audited_at: new Date().toISOString(),
    read_only: true,
    raw_rows_returned: 0,
    credentials_returned: 0,
    expected: EXPECTED,
    status: blockers.length ? 'NOT_READY' : 'PASS',
    blockers,
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    contract: report.contract,
    status: report.status,
    blocker_count: blockers.length,
    query_count: Object.keys(results).length,
    query_errors: Object.values(results).filter(result => result.error).length,
    output: outputPath,
  })}\n`);
  if (blockers.length) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'AUDIT_FAILED', error: safeError(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED, PROJECT_REF, QUERIES, RUN_ID, assess, managementQuery, safeError };
