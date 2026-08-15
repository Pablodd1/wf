'use strict';

const { managementQuery, sqlLiteral } = require('../mariadb-live/run-two-brand-price-correction.cjs');

const EXPECTED_PROJECT = 'qnsafosakvonzgfcsphh';
const MODES = new Set(['canary', 'full']);
const RUN_KEY = 'qnsa-non-watch-exact-phone-v1';

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
  const pageSize = boundedInteger(env.NON_WATCH_LINKAGE_PAGE_SIZE, 1000, 1, 5000, 'NON_WATCH_LINKAGE_PAGE_SIZE');
  const canaryLimit = boundedInteger(env.NON_WATCH_LINKAGE_CANARY_LIMIT, 10, 1, 10, 'NON_WATCH_LINKAGE_CANARY_LIMIT');
  const maxPages = boundedInteger(env.NON_WATCH_LINKAGE_MAX_PAGES, 5000, 1, 10000, 'NON_WATCH_LINKAGE_MAX_PAGES');
  const delayMs = boundedInteger(env.NON_WATCH_LINKAGE_DELAY_MS, mode === 'full' ? 50 : 0, 0, 5000, 'NON_WATCH_LINKAGE_DELAY_MS');

  if (!MODES.has(mode)) throw new Error('NON_WATCH_LINKAGE_MODE must be canary or full');
  if (config.projectRef !== EXPECTED_PROJECT || !config.accessToken) {
    throw new Error('Pinned QNSA project credentials are unavailable');
  }

  const capacityRows = await managementQuery(config, `
    SELECT jsonb_build_object(
      'raw_versions_count', (SELECT count(*) FROM public.raw_message_versions),
      'raw_version_primary_key_valid', EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='raw_message_versions_pkey'
          AND i.indisvalid AND i.indisready
      ),
      'raw_version_lineage_index', to_regclass('staging.idx_staging_mariadb_raw_version') IS NOT NULL,
      'enabled_non_watch_run', (SELECT enabled_run_key FROM public.qnsa_market_feed_control
        WHERE singleton=true AND enabled=true),
      'enabled_non_watch_categories', (SELECT enabled_categories FROM public.qnsa_market_feed_control
        WHERE singleton=true AND enabled=true)
    ) AS capacity`, true, fetchImpl);
  const capacity = capacityRows?.[0]?.capacity;
  if (!capacity?.raw_version_primary_key_valid || !capacity?.raw_version_lineage_index
      || !capacity?.enabled_non_watch_run) {
    throw new Error('Required immutable lineage indexes or non-watch release control are unavailable');
  }

  const before = await reconciliation(config, fetchImpl);
  if (Number(before.duplicate_verified_phones) !== 0
      || Number(before.orphan_non_watch_links) !== 0
      || Number(before.non_applied_non_watch_links) !== 0) {
    throw new Error('Preflight reconciliation failed');
  }

  const totals = { pages: 0, scanned: 0, eligible: 0, applied: 0,
    already_linked: 0, conflicting_links: 0, dealers_matched: 0 };
  let cursor = null;
  let cursorExhausted = false;
  while (!cursorExhausted) {
    if (totals.pages >= maxPages) throw new Error('NON_WATCH_LINKAGE_MAX_PAGES reached before scan completed');
    const remainingCanary = mode === 'canary' ? canaryLimit - totals.applied : null;
    if (mode === 'canary' && remainingCanary <= 0) break;
    const rows = await managementQuery(config, `
      SELECT public.qnsa_non_watch_dealer_link_page(
        ${cursor ? `${sqlLiteral(cursor)}::uuid` : 'NULL::uuid'},
        ${pageSize}, true,
        ${mode === 'canary' ? remainingCanary : 'NULL::integer'}
      ) AS result`, false, fetchImpl);
    const result = rows?.[0]?.result;
    if (!result) throw new Error('Non-watch linkage page returned no result');
    totals.pages += 1;
    for (const field of ['scanned', 'eligible', 'applied', 'already_linked',
      'conflicting_links', 'dealers_matched']) totals[field] += Number(result[field] || 0);
    if (Number(result.conflicting_links || 0) !== 0) throw new Error('Conflicting dealer/listing link detected');
    if (!result.has_more) { cursorExhausted = true; break; }
    const next = safeUuid(result.next_raw_version_id);
    if (next === cursor) throw new Error('Raw-version cursor did not advance');
    cursor = next;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (mode === 'canary' && totals.applied > canaryLimit) throw new Error('Canary write cap was exceeded');
  if (mode === 'full') {
    if (!cursorExhausted) throw new Error('Full linkage cannot complete before cursor exhaustion');
    const snapshotRows = await managementQuery(config,
      'SELECT count(*)::bigint AS raw_versions_count FROM public.raw_message_versions', true, fetchImpl);
    const finalCount = Number(snapshotRows?.[0]?.raw_versions_count);
    if (!Number.isSafeInteger(finalCount) || finalCount !== Number(capacity.raw_versions_count)
        || totals.scanned !== finalCount) {
      throw new Error('Immutable raw-version snapshot changed or did not reconcile');
    }
  }
  if (totals.scanned === 0) throw new Error('Raw-version scan returned no evidence rows');

  const after = await reconciliation(config, fetchImpl);
  if (Number(after.duplicate_verified_phones) !== 0
      || Number(after.orphan_non_watch_links) !== 0
      || Number(after.non_applied_non_watch_links) !== 0) {
    throw new Error('Postflight reconciliation failed');
  }
  if (Number(after.applied_non_watch_links) - Number(before.applied_non_watch_links) !== totals.applied) {
    throw new Error('Applied non-watch link delta did not reconcile');
  }

  return { mode, run_key: RUN_KEY, project_ref: EXPECTED_PROJECT, capacity,
    cursor_exhausted: cursorExhausted, before, totals, after,
    raw_text_logged: false, pii_logged: false };
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'qnsa_non_watch_linkage_error',
      message: error.message, raw_text_logged: false, pii_logged: false })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_PROJECT, MODES, RUN_KEY, boundedInteger, safeUuid, run };
