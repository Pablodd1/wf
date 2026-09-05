'use strict';

const { buildCanonicalDirectory } = require('./build-canonical-directory.cjs');
const { jsonSql, managementQuery } = require('../mariadb-live/run-two-brand-price-correction.cjs');

const EXPECTED_PROJECT = 'qnsafosakvonzgfcsphh';

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function run({ env = process.env, fetchImpl = fetch } = {}) {
  const config = { projectRef: env.SUPABASE_PROJECT_REF, accessToken: env.SUPABASE_ACCESS_TOKEN };
  if (config.projectRef !== EXPECTED_PROJECT || !config.accessToken) {
    throw new Error('Pinned QNSA project credentials are unavailable');
  }
  const directory = buildCanonicalDirectory();
  for (const batch of chunks(directory.records, 20)) {
    await managementQuery(config,
      `SELECT public.apply_qnsa_dealer_directory_snapshot(${jsonSql(batch)}) AS result`,
      false,
      fetchImpl,
    );
  }
  const rows = await managementQuery(config, `
    SELECT jsonb_build_object(
      'verified_dealers', (SELECT count(*) FROM public.dealers WHERE status='VERIFIED'),
      'verified_phone_identities', (SELECT count(*) FROM public.dealer_source_identities
        WHERE verification_status='VERIFIED' AND upper(identity_type) IN ('PHONE','WHATSAPP')
          AND public.normalize_seller_phone_identity(source_identity) IS NOT NULL),
      'dealers_with_verified_phone', (SELECT count(DISTINCT dealer_id) FROM public.dealer_source_identities
        WHERE verification_status='VERIFIED' AND upper(identity_type) IN ('PHONE','WHATSAPP')
          AND public.normalize_seller_phone_identity(source_identity) IS NOT NULL),
      'duplicate_verified_phones', (SELECT count(*) FROM (
        SELECT public.normalize_seller_phone_identity(source_identity)
        FROM public.dealer_source_identities
        WHERE verification_status='VERIFIED' AND upper(identity_type) IN ('PHONE','WHATSAPP')
        GROUP BY 1 HAVING count(DISTINCT dealer_id)>1
      ) duplicate)
    ) AS evidence`, true, fetchImpl);
  const evidence = rows?.[0]?.evidence;
  if (!evidence || Number(evidence.verified_phone_identities) < 1
    || Number(evidence.dealers_with_verified_phone) < 1
    || Number(evidence.duplicate_verified_phones) !== 0) {
    throw new Error('Canonical private identity import did not reconcile');
  }
  return {
    project_ref: EXPECTED_PROJECT,
    source_records: directory.report.records,
    source_unique_verified_phones: directory.report.unique_verified_phones,
    evidence,
    pii_logged: false,
  };
}

if (require.main === module) {
  run().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'canonical_snapshot_import_error', message: error.message, pii_logged: false })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_PROJECT, chunks, run };
