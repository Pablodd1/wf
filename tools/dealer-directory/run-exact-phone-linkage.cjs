'use strict';

const { managementQuery, sqlLiteral } = require('../mariadb-live/run-two-brand-price-correction.cjs');

const EXPECTED_PROJECT = 'qnsafosakvonzgfcsphh';
const MODES = new Set(['audit', 'canary', 'full']);
const LINKAGE_RUN_KEY = 'qnsa-six-brand-exact-phone-v1';

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
    throw new Error('Database returned an invalid dealer/cursor UUID');
  }
  return text;
}

function isTransientManagementFailure(error) {
  return /Supabase management query failed \((?:502|503|504)\)/i.test(String(error?.message || error));
}

async function reconciliation(config, fetchImpl) {
  const rows = await managementQuery(config,
    // The function is intentionally service-only. The Management API's
    // read-only execution role has no EXECUTE grant, so run the SELECT through
    // its privileged execution role; the SQL itself remains non-mutating.
    'SELECT public.qnsa_dealer_linkage_reconciliation() AS result', false, fetchImpl);
  const result = rows?.[0]?.result;
  if (!result) throw new Error('Dealer linkage reconciliation is unavailable');
  return result;
}

async function run(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = {
    projectRef: env.SUPABASE_PROJECT_REF,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
  };
  const mode = String(env.LINKAGE_MODE || 'audit').toLowerCase();
  const pageSize = boundedInteger(env.LINKAGE_PAGE_SIZE, 1000, 1, 5000, 'LINKAGE_PAGE_SIZE');
  const canaryLimit = boundedInteger(env.LINKAGE_CANARY_LIMIT, 10, 1, 10, 'LINKAGE_CANARY_LIMIT');
  const maxPages = boundedInteger(env.LINKAGE_MAX_PAGES, 5000, 1, 10000, 'LINKAGE_MAX_PAGES');
  const delayMs = boundedInteger(env.LINKAGE_DELAY_MS, mode === 'full' ? 50 : 0, 0, 5000, 'LINKAGE_DELAY_MS');

  if (!MODES.has(mode)) throw new Error('LINKAGE_MODE must be audit, canary, or full');
  if (config.projectRef !== EXPECTED_PROJECT || !config.accessToken) {
    throw new Error('Pinned QNSA project credentials are unavailable');
  }

  const capacityRows = await managementQuery(config, `
    SELECT jsonb_build_object(
      'database_gib', round(pg_database_size(current_database())::numeric / 1073741824, 3),
      'raw_versions_count', (SELECT count(*) FROM public.raw_message_versions),
      'raw_version_primary_key_valid', EXISTS (
        SELECT 1 FROM pg_index AS index_state
        JOIN pg_class AS index_relation ON index_relation.oid=index_state.indexrelid
        JOIN pg_namespace AS index_namespace ON index_namespace.oid=index_relation.relnamespace
        WHERE index_namespace.nspname='public'
          AND index_relation.relname='raw_message_versions_pkey'
          AND index_state.indisvalid AND index_state.indisready
      ),
      'raw_version_lineage_index', to_regclass('staging.idx_staging_mariadb_raw_version') IS NOT NULL
    ) AS capacity`, true, fetchImpl);
  const capacity = capacityRows?.[0]?.capacity;
  if (!capacity?.raw_version_primary_key_valid || !capacity?.raw_version_lineage_index) {
    throw new Error('Required immutable raw-version/lineage indexes are unavailable');
  }

  const rawPlanRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    SELECT raw_version.id
    FROM public.raw_message_versions AS raw_version
    WHERE raw_version.id > COALESCE(
      NULL::uuid, '00000000-0000-0000-0000-000000000000'::uuid
    )
    ORDER BY raw_version.id
    LIMIT ${pageSize + 1}`, true, fetchImpl);
  const lineagePlanRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    SELECT listing.id FROM staging.listings AS listing
    WHERE listing.raw_message_version_id = '00000000-0000-0000-0000-000000000000'::uuid`, true, fetchImpl);
  const boundedJoinPlanRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    WITH raw_page AS MATERIALIZED (
      SELECT raw_version.id, raw_version.source_record_id, raw_version.source_hash
      FROM public.raw_message_versions AS raw_version
      WHERE raw_version.id > COALESCE(
        NULL::uuid, '00000000-0000-0000-0000-000000000000'::uuid
      )
      ORDER BY raw_version.id
      LIMIT ${pageSize}
    )
    SELECT listing.id
    FROM raw_page AS page
    JOIN LATERAL (
      SELECT candidate_listing.id
      FROM staging.listings AS candidate_listing
      WHERE candidate_listing.raw_message_version_id=page.id
        AND candidate_listing.source_record_id=page.source_record_id
        AND candidate_listing.source_hash=page.source_hash
      OFFSET 0
    ) AS listing ON true`, true, fetchImpl);
  const rawPlan = (rawPlanRows || []).map(row => String(row['QUERY PLAN'] || row['query plan'] || '')).join('\n');
  const lineagePlan = (lineagePlanRows || []).map(row => String(row['QUERY PLAN'] || row['query plan'] || '')).join('\n');
  const boundedJoinPlan = (boundedJoinPlanRows || [])
    .map(row => String(row['QUERY PLAN'] || row['query plan'] || '')).join('\n');
  if (!/raw_message_versions_pkey/i.test(rawPlan)
      || !/idx_staging_mariadb_raw_version/i.test(lineagePlan)
      || !/Nested Loop/i.test(boundedJoinPlan)
      || !/raw_message_versions_pkey/i.test(boundedJoinPlan)
      || !/idx_staging_mariadb_raw_version/i.test(boundedJoinPlan)) {
    throw new Error('EXPLAIN did not preserve the bounded raw-page-first lineage plan; linkage is blocked');
  }

  const before = await reconciliation(config, fetchImpl);
  if (Number(before.duplicate_verified_phones) !== 0 || Number(before.orphan_links) !== 0) {
    throw new Error('Preflight failed: duplicate verified phones or orphan links exist');
  }
  if (mode !== 'audit' && Number(before.dealers_with_verified_phone) === 0) {
    throw new Error('No canonical dealer has an exact verified phone; canary/full linkage is blocked');
  }

  const totals = {
    dealers_scanned: Number(before.dealers_with_verified_phone || 0),
    pages: 0, scanned: 0, eligible: 0, applied: 0,
    already_linked: 0, conflicting_links: 0, dealers_matched: 0,
  };
  if (mode === 'full') {
    await managementQuery(config, `
        INSERT INTO public.dealer_listing_linkage_checkpoints (
          dealer_id, run_key, status, started_at, completed_at, updated_at, evidence
        )
        SELECT DISTINCT dealer.id, ${sqlLiteral(LINKAGE_RUN_KEY)}, 'RUNNING',
          now(), NULL::timestamptz, now(), jsonb_build_object(
            'bounded_keyset', true, 'global_raw_version_scan', true
          )
        FROM public.dealers AS dealer
        JOIN public.dealer_source_identities AS identity ON identity.dealer_id=dealer.id
        WHERE dealer.status='VERIFIED'
          AND identity.verification_status='VERIFIED'
          AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
          AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
        ON CONFLICT (dealer_id) DO UPDATE SET
          run_key = EXCLUDED.run_key, status = 'RUNNING', completed_at = NULL,
          updated_at = now(), evidence = EXCLUDED.evidence`, false, fetchImpl);
  }

  let cursor = null;
  let cursorExhausted = false;
  while (!cursorExhausted) {
    if (totals.pages >= maxPages) throw new Error('LINKAGE_MAX_PAGES reached before global raw scan completed');
    let remainingCanary = mode === 'canary' ? canaryLimit - totals.applied : null;
    if (mode === 'canary' && remainingCanary <= 0) break;
    const apply = mode !== 'audit';
    let resultRows;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        resultRows = await managementQuery(config, `
        SELECT public.qnsa_dealer_global_raw_phone_link_page(
          ${cursor ? `${sqlLiteral(cursor)}::uuid` : 'NULL::uuid'},
          ${pageSize}, ${apply ? 'true' : 'false'},
          ${mode === 'canary' ? remainingCanary : 'NULL::integer'}
        ) AS result`, false, fetchImpl);
        break;
      } catch (error) {
        if (!isTransientManagementFailure(error) || attempt === 2) throw error;

        // A gateway may lose the response after PostgreSQL committed the
        // idempotent page. Reconcile before replaying it so a canary can never
        // exceed its global write cap. Full mode can safely replay the same
        // immutable cursor page because listing_id is conflict-protected.
        const uncertain = await reconciliation(config, fetchImpl);
        if (Number(uncertain.duplicate_verified_phones) !== 0 || Number(uncertain.orphan_links) !== 0) {
          throw new Error('Transient page recovery found duplicate verified phones or orphan links');
        }
        const observedApplied = Number(uncertain.applied_links) - Number(before.applied_links);
        if (!Number.isSafeInteger(observedApplied) || observedApplied < 0) {
          throw new Error('Transient page recovery returned an invalid applied-link delta');
        }
        if (mode === 'canary') {
          totals.applied = observedApplied;
          remainingCanary = canaryLimit - observedApplied;
          if (remainingCanary <= 0) break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    if (!resultRows && mode === 'canary' && remainingCanary <= 0) break;
    const result = resultRows?.[0]?.result;
    if (!result) throw new Error('Global raw linkage page returned no reconciliation');
    totals.pages += 1;
    for (const field of ['scanned', 'eligible', 'applied', 'already_linked',
      'conflicting_links', 'dealers_matched']) {
      totals[field] += Number(result[field] || 0);
    }
    if (Number(result.conflicting_links || 0) !== 0) throw new Error('Conflicting dealer/listing link detected');
    if (!result.has_more) { cursorExhausted = true; break; }
    const next = safeUuid(result.next_raw_version_id);
    if (next === cursor) throw new Error('Global raw-version cursor did not advance');
    cursor = next;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (mode === 'full') {
    if (!cursorExhausted) throw new Error('Full linkage cannot complete before global cursor exhaustion');
    const snapshotRows = await managementQuery(config,
      'SELECT count(*)::bigint AS raw_versions_count FROM public.raw_message_versions', true, fetchImpl);
    const finalRawVersionCount = Number(snapshotRows?.[0]?.raw_versions_count);
    if (!Number.isSafeInteger(finalRawVersionCount)
        || finalRawVersionCount !== Number(capacity.raw_versions_count)
        || totals.scanned !== finalRawVersionCount) {
      throw new Error('Immutable raw-version snapshot changed or did not reconcile; completion is blocked');
    }
    await managementQuery(config, `
        WITH eligible_dealers AS (
          SELECT DISTINCT dealer.id AS dealer_id
          FROM public.dealers AS dealer
          JOIN public.dealer_source_identities AS identity ON identity.dealer_id=dealer.id
          WHERE dealer.status='VERIFIED'
            AND identity.verification_status='VERIFIED'
            AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
            AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
        ), link_counts AS (
          SELECT dealer_id, count(*) FILTER (WHERE link_status='APPLIED') AS applied_links
          FROM public.dealer_listing_links GROUP BY dealer_id
        ), dealer_counts AS (
          SELECT eligible_dealers.dealer_id, COALESCE(link_counts.applied_links, 0) AS applied_links
          FROM eligible_dealers
          LEFT JOIN link_counts ON link_counts.dealer_id=eligible_dealers.dealer_id
        )
        UPDATE public.dealer_listing_linkage_checkpoints AS checkpoint SET
          status = 'COMPLETE', scanned_count = ${totals.scanned},
          eligible_count = dealer_counts.applied_links,
          applied_count = dealer_counts.applied_links,
          conflicting_count = 0,
          completed_at = now(), updated_at = now(),
          evidence = checkpoint.evidence || jsonb_build_object(
            'cursor_exhausted', true, 'global_raw_version_scan', true,
            'immutable_release_gate', 'QNSA_SIX_BRAND_EXACT_V1'
          )
        FROM dealer_counts
        WHERE checkpoint.dealer_id = dealer_counts.dealer_id
          AND checkpoint.run_key = ${sqlLiteral(LINKAGE_RUN_KEY)}
          AND checkpoint.status = 'RUNNING'`, false, fetchImpl);

    const checkpointRows = await managementQuery(config, `
      WITH eligible_dealers AS (
        SELECT DISTINCT dealer.id AS dealer_id
        FROM public.dealers AS dealer
        JOIN public.dealer_source_identities AS identity ON identity.dealer_id=dealer.id
        WHERE dealer.status='VERIFIED'
          AND identity.verification_status='VERIFIED'
          AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
          AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
      )
      SELECT jsonb_build_object(
        'running', count(*) FILTER (WHERE status='RUNNING'),
        'complete', count(*) FILTER (WHERE status='COMPLETE')
      ) AS result
      FROM public.dealer_listing_linkage_checkpoints AS checkpoint
      JOIN eligible_dealers ON eligible_dealers.dealer_id=checkpoint.dealer_id
      WHERE checkpoint.run_key=${sqlLiteral(LINKAGE_RUN_KEY)}`, true, fetchImpl);
    const checkpointResult = checkpointRows?.[0]?.result;
    if (!checkpointResult || Number(checkpointResult.running) !== 0
        || Number(checkpointResult.complete) !== totals.dealers_scanned) {
      throw new Error('Dealer completion checkpoint reconciliation failed');
    }
  }

  const after = await reconciliation(config, fetchImpl);
  if (Number(after.duplicate_verified_phones) !== 0 || Number(after.orphan_links) !== 0) {
    throw new Error('Postflight failed: duplicate verified phones or orphan links exist');
  }
  if (mode === 'audit' && Number(after.applied_links) !== Number(before.applied_links)) {
    throw new Error('Audit mode changed applied linkage state');
  }
  if (mode !== 'audit') {
    const observedApplied = Number(after.applied_links) - Number(before.applied_links);
    if (!Number.isSafeInteger(observedApplied) || observedApplied < 0) {
      throw new Error('Postflight returned an invalid applied-link delta');
    }
    totals.applied = observedApplied;
  }
  if (mode === 'canary' && totals.applied > canaryLimit) throw new Error('Canary write cap was exceeded');
  if (totals.scanned === 0 && totals.applied === 0) {
    throw new Error('Global raw-version scan returned no evidence rows');
  }

  return {
    mode,
    project_ref: EXPECTED_PROJECT,
    capacity,
    explain: {
      required_indexes: ['raw_message_versions_pkey', 'idx_staging_mariadb_raw_version'],
      index_scan_verified: true,
    },
    cursor_exhausted: cursorExhausted,
    before,
    totals,
    after,
    raw_text_logged: false,
    pii_logged: false,
  };
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'qnsa_dealer_exact_phone_linkage_error',
      message: error.message,
      raw_text_logged: false,
      pii_logged: false,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_PROJECT, LINKAGE_RUN_KEY, boundedInteger, isTransientManagementFailure, run, safeUuid,
};
