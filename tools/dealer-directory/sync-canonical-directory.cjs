'use strict';

const { buildCanonicalDirectory } = require('./build-canonical-directory.cjs');
const { jsonSql, managementQuery } = require('../mariadb-live/run-two-brand-price-correction.cjs');

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function run({ env = process.env, fetchImpl = fetch } = {}) {
  const config = {
    projectRef: env.SUPABASE_PROJECT_REF,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
  };
  if (config.projectRef !== 'qnsafosakvonzgfcsphh') throw new Error('Unexpected Supabase project');
  if (!config.accessToken) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable');

  const directory = buildCanonicalDirectory();
  for (const batch of chunks(directory.records, 20)) {
    await managementQuery(config, `SELECT public.apply_qnsa_dealer_directory_snapshot(${jsonSql(batch)}) AS result`, false, fetchImpl);
  }

  const linkSync = await managementQuery(config,
    'SELECT public.sync_qnsa_dealer_public_listing_links() AS result', false, fetchImpl);

  const reconciliation = await managementQuery(config, `
    SELECT jsonb_build_object(
      'dealers', (SELECT count(*) FROM public.dealers WHERE status = 'VERIFIED'),
      'source_identities', (SELECT count(*) FROM public.dealer_source_identities),
      'snapshots', (SELECT count(*) FROM public.dealer_directory_snapshots),
      'reviews', (SELECT count(*) FROM public.dealer_reviews),
      'listing_links', (SELECT count(*) FROM public.dealer_listing_links WHERE link_status = 'APPLIED'),
      'duplicate_verified_phones', (SELECT count(*) FROM (
        SELECT public.normalize_seller_phone_identity(source_identity)
        FROM public.dealer_source_identities WHERE verification_status = 'VERIFIED'
          AND upper(identity_type) IN ('PHONE','WHATSAPP')
        GROUP BY 1 HAVING count(DISTINCT dealer_id) > 1
      ) duplicates),
      'orphan_listing_links', (SELECT count(*) FROM public.dealer_listing_links link
        LEFT JOIN staging.listings l ON l.id = link.listing_id WHERE l.id IS NULL)
    ) AS reconciliation
  `, true, fetchImpl);
  const result = reconciliation?.[0]?.reconciliation;
  if (!result || Number(result.duplicate_verified_phones) !== 0 || Number(result.orphan_listing_links) !== 0) {
    throw new Error('Canonical dealer reconciliation failed');
  }
  return { directory: directory.report, links: linkSync?.[0]?.result || null, reconciliation: result };
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'canonical_dealer_sync_error', message: error.message, pii_logged: false })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { chunks, run };
