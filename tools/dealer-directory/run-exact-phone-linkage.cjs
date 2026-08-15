'use strict';

const { managementQuery, sqlLiteral } = require('../mariadb-live/run-two-brand-price-correction.cjs');

const EXPECTED_PROJECT = 'qnsafosakvonzgfcsphh';
const MODES = new Set(['audit', 'canary', 'full']);

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

async function reconciliation(config, fetchImpl) {
  const rows = await managementQuery(config,
    'SELECT public.qnsa_dealer_linkage_reconciliation() AS result', true, fetchImpl);
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
  const pageSize = boundedInteger(env.LINKAGE_PAGE_SIZE, mode === 'canary' ? 10 : 200, 1, 500, 'LINKAGE_PAGE_SIZE');
  const canaryLimit = boundedInteger(env.LINKAGE_CANARY_LIMIT, 10, 1, 10, 'LINKAGE_CANARY_LIMIT');
  const maxPages = boundedInteger(env.LINKAGE_MAX_PAGES, mode === 'full' ? 10000 : 100, 1, 10000, 'LINKAGE_MAX_PAGES');
  const delayMs = boundedInteger(env.LINKAGE_DELAY_MS, mode === 'full' ? 250 : 0, 0, 5000, 'LINKAGE_DELAY_MS');

  if (!MODES.has(mode)) throw new Error('LINKAGE_MODE must be audit, canary, or full');
  if (config.projectRef !== EXPECTED_PROJECT || !config.accessToken) {
    throw new Error('Pinned QNSA project credentials are unavailable');
  }

  const capacityRows = await managementQuery(config, `
    SELECT jsonb_build_object(
      'database_gib', round(pg_database_size(current_database())::numeric / 1073741824, 3),
      'existing_contact_index', to_regclass('staging.idx_staging_contact') IS NOT NULL
    ) AS capacity`, true, fetchImpl);
  const capacity = capacityRows?.[0]?.capacity;
  if (!capacity?.existing_contact_index) throw new Error('Required idx_staging_contact is unavailable');

  const planRows = await managementQuery(config, `
    EXPLAIN (FORMAT TEXT, COSTS TRUE)
    SELECT listing.id
    FROM staging.listings AS listing
    WHERE listing.contact_number = (
      SELECT identity.source_identity
      FROM public.dealer_source_identities AS identity
      WHERE identity.verification_status = 'VERIFIED'
        AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
      LIMIT 1
    )
      AND listing.id > '00000000-0000-0000-0000-000000000000'::uuid
    LIMIT ${pageSize + 1}`, true, fetchImpl);
  const plan = (planRows || []).map(row => String(row['QUERY PLAN'] || row['query plan'] || '')).join('\n');
  if (!/idx_staging_contact/i.test(plan)) {
    throw new Error('EXPLAIN did not select idx_staging_contact; linkage is blocked');
  }

  const before = await reconciliation(config, fetchImpl);
  if (Number(before.duplicate_verified_phones) !== 0 || Number(before.orphan_links) !== 0) {
    throw new Error('Preflight failed: duplicate verified phones or orphan links exist');
  }
  if (mode !== 'audit' && Number(before.dealers_with_verified_phone) === 0) {
    throw new Error('No canonical dealer has an exact verified phone; canary/full linkage is blocked');
  }

  const dealerRows = await managementQuery(config, `
    SELECT DISTINCT dealer.id::text AS dealer_id
    FROM public.dealers AS dealer
    JOIN public.dealer_source_identities AS identity ON identity.dealer_id = dealer.id
    WHERE dealer.status = 'VERIFIED'
      AND identity.verification_status = 'VERIFIED'
      AND upper(identity.identity_type) IN ('PHONE','WHATSAPP')
      AND public.normalize_seller_phone_identity(identity.source_identity) IS NOT NULL
    ORDER BY dealer.id::text`, true, fetchImpl);

  const totals = { dealers_scanned: 0, pages: 0, scanned: 0, eligible: 0, applied: 0,
    already_linked: 0, conflicting_links: 0, no_verified_phone: 0 };
  let stop = false;
  for (const row of dealerRows || []) {
    if (stop) break;
    const dealerId = safeUuid(row.dealer_id);
    let cursor = null;
    totals.dealers_scanned += 1;
    do {
      if (totals.pages >= maxPages) throw new Error('LINKAGE_MAX_PAGES reached before reconciliation completed');
      const remainingCanary = mode === 'canary' ? canaryLimit - totals.applied : pageSize;
      if (mode === 'canary' && remainingCanary <= 0) { stop = true; break; }
      const batchLimit = Math.min(pageSize, remainingCanary);
      const apply = mode !== 'audit';
      const resultRows = await managementQuery(config, `
        SELECT public.qnsa_dealer_exact_phone_link_page(
          ${sqlLiteral(dealerId)}::uuid,
          ${cursor ? `${sqlLiteral(cursor)}::uuid` : 'NULL::uuid'},
          ${batchLimit}, ${apply ? 'true' : 'false'}
        ) AS result`, !apply, fetchImpl);
      const result = resultRows?.[0]?.result;
      if (!result) throw new Error('Linkage page returned no reconciliation');
      totals.pages += 1;
      for (const field of ['scanned', 'eligible', 'applied', 'already_linked', 'conflicting_links']) {
        totals[field] += Number(result[field] || 0);
      }
      if (result.status === 'NO_VERIFIED_PHONE') totals.no_verified_phone += 1;
      if (Number(result.conflicting_links || 0) !== 0) throw new Error('Conflicting dealer/listing link detected');
      if (!result.has_more) break;
      const next = safeUuid(result.next_id);
      if (next === cursor) throw new Error('Linkage cursor did not advance');
      cursor = next;
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (mode === 'audit') break;
    } while (true);
  }

  const after = await reconciliation(config, fetchImpl);
  if (Number(after.duplicate_verified_phones) !== 0 || Number(after.orphan_links) !== 0) {
    throw new Error('Postflight failed: duplicate verified phones or orphan links exist');
  }
  if (mode === 'audit' && Number(after.applied_links) !== Number(before.applied_links)) {
    throw new Error('Audit mode changed applied linkage state');
  }
  if (mode === 'canary' && totals.applied > canaryLimit) throw new Error('Canary write cap was exceeded');

  return {
    mode,
    project_ref: EXPECTED_PROJECT,
    capacity,
    explain: { required_index: 'idx_staging_contact', index_scan_verified: true },
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

module.exports = { EXPECTED_PROJECT, boundedInteger, run, safeUuid };
