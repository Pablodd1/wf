'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { managementQuery, sqlLiteral } = require('../mariadb-live/run-two-brand-price-correction.cjs');

const EXPECTED_PROJECT = 'qnsafosakvonzgfcsphh';
const MODES = new Set(['canary', 'full']);
const RUN_KEY = 'qnsa-non-watch-exact-phone-v1';
const CATEGORIES = ['HANDBAG', 'JEWELRY', 'ACCESSORY'];

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function safeUuid(value) {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error('Database returned an invalid raw-version cursor UUID');
  }
  return text;
}

function safeTimestamp(value) {
  const text = String(value || '');
  const parsed = Date.parse(text);
  if (!text || !Number.isFinite(parsed)) throw new Error('Database returned an invalid category timestamp');
  return new Date(parsed).toISOString();
}

function allCategoryCursorsExhausted(categoryTotals = {}) {
  return CATEGORIES.every(category => categoryTotals[category]?.exhausted === true);
}

function appliedDeltaReconciles(before, after, applied) {
  return Number(after?.applied_non_watch_links) - Number(before?.applied_non_watch_links)
    === Number(applied);
}

function populationEvidenceMatches(before = {}, observed = {}, after = {}) {
  return CATEGORIES.every(category => {
    const first = before[category];
    const middle = observed[category];
    const last = after[category];
    return first?.exhausted === true && middle?.exhausted === true && last?.exhausted === true
      && Number(first.scanned) === Number(middle.scanned)
      && Number(first.scanned) === Number(last.scanned)
      && first.digest === middle.digest && first.digest === last.digest;
  });
}

async function linkageLease(config, ownerId, action, mode, fetchImpl) {
  const rows = await managementQuery(config, `
    SELECT public.qnsa_non_watch_linkage_lease_action(
      ${sqlLiteral(ownerId)}::uuid,${sqlLiteral(action)},${sqlLiteral(mode)},900
    ) AS result`, false, fetchImpl);
  const result = rows?.[0]?.result;
  if (!result || (action !== 'release' && result.acquired !== true)) {
    throw new Error(action === 'acquire'
      ? 'Another non-watch linkage run owns the database lease'
      : `Non-watch linkage lease ${action} failed`);
  }
  return result;
}

async function reconciliation(config, fetchImpl) {
  const rows = await managementQuery(config,
    'SELECT public.qnsa_non_watch_dealer_linkage_reconciliation() AS result', false, fetchImpl);
  const result = rows?.[0]?.result;
  if (!result) throw new Error('Non-watch dealer linkage reconciliation is unavailable');
  return result;
}

async function run(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = { projectRef: env.SUPABASE_PROJECT_REF, accessToken: env.SUPABASE_ACCESS_TOKEN };
  const mode = String(env.NON_WATCH_LINKAGE_MODE || '').toLowerCase();
  const pageSize = boundedInteger(env.NON_WATCH_LINKAGE_PAGE_SIZE, 500, 1, 1000, 'NON_WATCH_LINKAGE_PAGE_SIZE');
  const canaryLimit = boundedInteger(env.NON_WATCH_LINKAGE_CANARY_LIMIT, 10, 1, 10, 'NON_WATCH_LINKAGE_CANARY_LIMIT');
  const maxPages = boundedInteger(env.NON_WATCH_LINKAGE_MAX_PAGES, 5000, 1, 10000, 'NON_WATCH_LINKAGE_MAX_PAGES');
  const delayMs = boundedInteger(env.NON_WATCH_LINKAGE_DELAY_MS, mode === 'full' ? 50 : 0, 0, 5000, 'NON_WATCH_LINKAGE_DELAY_MS');

  if (!MODES.has(mode)) throw new Error('NON_WATCH_LINKAGE_MODE must be canary or full');
  if (config.projectRef !== EXPECTED_PROJECT || !config.accessToken) {
    throw new Error('Pinned QNSA project credentials are unavailable');
  }

  const capacityRows = await managementQuery(config, `
    SELECT jsonb_build_object(
      'raw_version_primary_key_valid', EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='raw_message_versions_pkey'
          AND i.indisvalid AND i.indisready
      ),
      'non_watch_category_index_valid', EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='staging' AND c.relname='idx_staging_qnsa_market_feed_page'
          AND i.indisvalid AND i.indisready
      ),
      'bounded_reconciliation_contract', COALESCE((SELECT
        position('QNSA_NON_WATCH_RELEASE_GATED_RAW_LINEAGE' in definition)>0
          AND position('eligible_released_non_watch' in definition)=0
          AND position('qnsa_market_feed_control' in definition)=0
        FROM (SELECT pg_get_functiondef(to_regprocedure(
          'public.qnsa_non_watch_dealer_linkage_reconciliation()'
        )) AS definition) contract),false),
      'enabled_non_watch_run', (SELECT enabled_run_key FROM public.qnsa_market_feed_control
        WHERE singleton=true AND enabled=true),
      'enabled_non_watch_categories', (SELECT enabled_categories FROM public.qnsa_market_feed_control
        WHERE singleton=true AND enabled=true)
    ) AS capacity`, true, fetchImpl);
  const capacity = capacityRows?.[0]?.capacity;
  if (!capacity?.raw_version_primary_key_valid || !capacity?.non_watch_category_index_valid
      || !capacity?.bounded_reconciliation_contract
      || !capacity?.enabled_non_watch_run) {
    throw new Error('Required category/raw indexes or non-watch release control are unavailable');
  }

  if (!CATEGORIES.every(category => capacity.enabled_non_watch_categories?.includes(category))) {
    throw new Error('All released non-watch categories must remain enabled');
  }
  const boundaryRows = await managementQuery(config, `
    WITH categories(category) AS (VALUES ('HANDBAG'),('JEWELRY'),('ACCESSORY'))
    SELECT jsonb_object_agg(categories.category, jsonb_build_object(
      'created_at', boundary.created_at, 'id', boundary.id)) AS boundaries
    FROM categories
    JOIN LATERAL (
      SELECT listing.created_at,listing.id
      FROM staging.listings AS listing
      WHERE listing.normalization_run_key=${sqlLiteral(capacity.enabled_non_watch_run)}
        AND listing.category=categories.category
        AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle,false)=false
        AND listing.provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'
        AND upper(COALESCE(listing.listing_type,listing.intent,'')) IN ('WTS','WTB')
        AND listing.raw_message_version_id IS NOT NULL
        AND COALESCE(listing.source_record_id,'')<>''
        AND listing.source_hash ~ '^[0-9a-f]{64}$'
        AND listing.source_candidate_hash ~ '^[0-9a-f]{64}$'
        AND lower(COALESCE(listing.trading_floor_status,'')) NOT IN (
          'bundle_child_pending_review','bundle_pending_separation','suppressed_exact_duplicate',
          'withdrawn','rejected','hidden','deleted','archived')
        AND upper(COALESCE(listing.verdict,'')) NOT IN (
          'WITHDRAWN','REJECTED','HIDDEN','DELETED','ARCHIVED')
      ORDER BY listing.created_at DESC,listing.id DESC LIMIT 1
    ) AS boundary ON true`, true, fetchImpl);
  const rawBoundaries = boundaryRows?.[0]?.boundaries || {};
  const boundaries = Object.fromEntries(CATEGORIES.map(category => {
    const boundary = rawBoundaries[category];
    if (!boundary) throw new Error(`Released ${category} boundary is unavailable`);
    return [category, { createdAt: safeTimestamp(boundary.created_at), id: safeUuid(boundary.id) }];
  }));

  const sampleBoundary = boundaries.HANDBAG;
  const categoryPlanRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    SELECT listing.id FROM staging.listings AS listing
    WHERE listing.normalization_run_key=${sqlLiteral(capacity.enabled_non_watch_run)}
      AND listing.category='HANDBAG'
      AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle,false)=false
      AND upper(COALESCE(listing.listing_type,listing.intent,'')) IN ('WTS','WTB')
      AND (listing.created_at,listing.id)<=(${sqlLiteral(sampleBoundary.createdAt)}::timestamptz,
        ${sqlLiteral(sampleBoundary.id)}::uuid)
    ORDER BY listing.created_at DESC,listing.id DESC LIMIT ${pageSize + 1}`, true, fetchImpl);
  const boundedJoinPlanRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    WITH candidate_page AS MATERIALIZED (
      SELECT listing.id,listing.raw_message_version_id,listing.source_record_id,listing.source_hash
      FROM staging.listings AS listing
      WHERE listing.normalization_run_key=${sqlLiteral(capacity.enabled_non_watch_run)}
        AND listing.category='HANDBAG'
        AND listing.parent_id IS NULL AND COALESCE(listing.is_bundle,false)=false
        AND upper(COALESCE(listing.listing_type,listing.intent,'')) IN ('WTS','WTB')
        AND (listing.created_at,listing.id)<=(${sqlLiteral(sampleBoundary.createdAt)}::timestamptz,
          ${sqlLiteral(sampleBoundary.id)}::uuid)
      ORDER BY listing.created_at DESC,listing.id DESC LIMIT ${pageSize}
    )
    SELECT raw_version.id FROM candidate_page AS page
    JOIN LATERAL (
      SELECT candidate_raw.id
      FROM public.raw_message_versions AS candidate_raw
      WHERE candidate_raw.id=page.raw_message_version_id
        AND candidate_raw.source_record_id=page.source_record_id
        AND candidate_raw.source_hash=page.source_hash
      OFFSET 0
    ) AS raw_version ON true`, true, fetchImpl);
  const planText = rows => (rows || [])
    .map(row => String(row['QUERY PLAN'] || row['query plan'] || '')).join('\n');
  const categoryPlan = planText(categoryPlanRows);
  const boundedJoinPlan = planText(boundedJoinPlanRows);
  if (!/idx_staging_qnsa_market_feed_page/i.test(categoryPlan)
      || !/Nested Loop/i.test(boundedJoinPlan)
      || !/raw_message_versions_pkey/i.test(boundedJoinPlan)
      || !/idx_staging_qnsa_market_feed_page/i.test(boundedJoinPlan)) {
    throw new Error('EXPLAIN did not preserve bounded category-first immutable-raw plan');
  }

  const leaseOwner = randomUUID();
  let leaseAcquired = false;
  try {
    await linkageLease(config, leaseOwner, 'acquire', mode, fetchImpl);
    leaseAcquired = true;
    const before = await reconciliation(config, fetchImpl);
    if (Number(before.duplicate_verified_phones) !== 0
        || Number(before.orphan_non_watch_links) !== 0
        || Number(before.non_applied_non_watch_links) !== 0) {
      throw new Error('Preflight reconciliation failed');
    }

    const scanStreams = async ({ apply, canaryCap = null }) => {
      const totals = { pages: 0, scanned: 0, eligible: 0, applied: 0,
        already_linked: 0, conflicting_links: 0, dealers_matched: 0, categories: {} };
      let canaryComplete = false;
      for (const category of CATEGORIES) {
        let cursor = null;
        let exhausted = false;
        const digest = createHash('sha256');
        digest.update(`${capacity.enabled_non_watch_run}:${category}:`);
        const categoryTotals = { pages: 0, scanned: 0, eligible: 0,
          applied: 0, exhausted: false, digest: null };
        while (!exhausted) {
          if (totals.pages >= maxPages) throw new Error('NON_WATCH_LINKAGE_MAX_PAGES reached before categories completed');
          const remainingCanary = canaryCap === null ? null : canaryCap - totals.applied;
          if (remainingCanary !== null && remainingCanary <= 0) { canaryComplete = true; break; }
          await linkageLease(config, leaseOwner, 'renew', mode, fetchImpl);
          const rows = await managementQuery(config, `
            SELECT public.qnsa_non_watch_dealer_candidate_link_page(
              ${sqlLiteral(capacity.enabled_non_watch_run)},${sqlLiteral(category)},
              ${sqlLiteral(boundaries[category].createdAt)}::timestamptz,
              ${sqlLiteral(boundaries[category].id)}::uuid,
              ${cursor ? `${sqlLiteral(cursor.createdAt)}::timestamptz` : 'NULL::timestamptz'},
              ${cursor ? `${sqlLiteral(cursor.id)}::uuid` : 'NULL::uuid'},
              ${pageSize},${apply ? 'true' : 'false'},
              ${remainingCanary === null ? 'NULL::integer' : `${remainingCanary}::integer`}
            ) AS result`, false, fetchImpl);
          const result = rows?.[0]?.result;
          if (!result || result.run_key !== capacity.enabled_non_watch_run || result.category !== category
              || !/^[0-9a-f]{32}$/i.test(String(result.candidate_page_digest || ''))) {
            throw new Error('Candidate linkage page returned a mismatched release stream');
          }
          digest.update(String(result.candidate_page_digest));
          totals.pages += 1; categoryTotals.pages += 1;
          for (const field of ['scanned','eligible','applied','already_linked','conflicting_links','dealers_matched']) {
            totals[field] += Number(result[field] || 0);
            if (field in categoryTotals) categoryTotals[field] += Number(result[field] || 0);
          }
          if (!apply && Number(result.applied || 0) !== 0) throw new Error('Read-only population census changed linkage state');
          if (Number(result.conflicting_links || 0) !== 0) throw new Error('Conflicting dealer/listing link detected');
          if (!result.has_more) { exhausted = true; categoryTotals.exhausted = true; break; }
          const next = { createdAt: safeTimestamp(result.next_created_at), id: safeUuid(result.next_id) };
          if (cursor && next.createdAt === cursor.createdAt && next.id === cursor.id) {
            throw new Error(`${category} category cursor did not advance`);
          }
          cursor = next;
          if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        categoryTotals.digest = categoryTotals.exhausted ? digest.digest('hex') : null;
        totals.categories[category] = categoryTotals;
        if (canaryComplete) break;
      }
      return totals;
    };

    const frozenPopulation = mode === 'full' ? await scanStreams({ apply: false }) : null;
    const totals = await scanStreams({ apply: true,
      canaryCap: mode === 'canary' ? canaryLimit : null });
    if (mode === 'canary' && totals.applied > canaryLimit) throw new Error('Canary write cap was exceeded');
    const allCategoriesExhausted = allCategoryCursorsExhausted(totals.categories);
    let finalPopulation = null;
    if (mode === 'full') {
      if (!allCategoriesExhausted) throw new Error('Full linkage cannot complete before all category cursors exhaust');
      finalPopulation = await scanStreams({ apply: false });
      if (!populationEvidenceMatches(frozenPopulation.categories, totals.categories,
        finalPopulation.categories)) {
        throw new Error('Frozen non-watch category population changed or did not reconcile');
      }
      const controlRows = await managementQuery(config, `SELECT enabled_run_key,enabled_categories
        FROM public.qnsa_market_feed_control WHERE singleton=true AND enabled=true`, true, fetchImpl);
      if (controlRows?.[0]?.enabled_run_key !== capacity.enabled_non_watch_run
          || !CATEGORIES.every(category => controlRows[0].enabled_categories?.includes(category))) {
        throw new Error('Frozen non-watch release control changed during full linkage');
      }
    }
    if (totals.scanned === 0) throw new Error('Released category scan returned no evidence rows');

    const after = await reconciliation(config, fetchImpl);
    if (Number(after.duplicate_verified_phones) !== 0
        || Number(after.orphan_non_watch_links) !== 0
        || Number(after.non_applied_non_watch_links) !== 0) {
      throw new Error('Postflight reconciliation failed');
    }
    if (!appliedDeltaReconciles(before, after, totals.applied)) {
      throw new Error('Applied non-watch link delta did not reconcile');
    }

    return { mode, run_key: RUN_KEY, project_ref: EXPECTED_PROJECT, capacity,
      explain: { required_indexes: ['raw_message_versions_pkey',
        'idx_staging_qnsa_market_feed_page'], bounded_nested_loop_verified: true },
      boundaries, frozen_population: frozenPopulation,
      final_population: finalPopulation, all_categories_exhausted: allCategoriesExhausted,
      before, totals, after, raw_text_logged: false, pii_logged: false };
  } finally {
    if (leaseAcquired) await linkageLease(config, leaseOwner, 'release', mode, fetchImpl);
  }
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'qnsa_non_watch_linkage_error',
      message: error.message, raw_text_logged: false, pii_logged: false })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { CATEGORIES, EXPECTED_PROJECT, MODES, RUN_KEY,
  allCategoryCursorsExhausted, appliedDeltaReconciles,
  boundedInteger, populationEvidenceMatches, safeTimestamp, safeUuid, run };
