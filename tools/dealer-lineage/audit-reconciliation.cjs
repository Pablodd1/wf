'use strict';

const fs = require('node:fs');
const path = require('node:path');

const outputPath = path.resolve(process.env.DEALER_AUDIT_OUTPUT || 'audit-output/dealer-lineage/reconciliation.json');
const timeoutMs = Math.max(5000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 30000));
const maxAttempts = Math.max(1, Math.min(Number(process.env.SUPABASE_REQUEST_ATTEMPTS || 4), 8));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(baseUrl, key, resource, options = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          ...(options.headers || {}),
        },
      });
      const body = await response.text();
      if (response.ok) {
        return {
          data: body ? JSON.parse(body) : [],
          contentRange: response.headers.get('content-range'),
        };
      }
      if (response.status < 500 || attempt === maxAttempts) {
        throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
      }
    } catch (error) {
      if (attempt === maxAttempts || /^Supabase 4/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
  }
  throw new Error(`Request failed for ${resource.split('?')[0]}`);
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = String(row[key] || 'UNKNOWN');
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  async function optional(label, resource) {
    try {
      return { label, ...(await request(baseUrl, key, resource)), error: null };
    } catch (error) {
      return { label, data: [], contentRange: null, error: error.message };
    }
  }

  async function optionalPaged(label, resource, maxRows = 10000) {
    const rows = [];
    try {
      while (rows.length < maxRows) {
        const separator = resource.includes('?') ? '&' : '?';
        const page = await request(baseUrl, key, `${resource}${separator}limit=1000&offset=${rows.length}`);
        rows.push(...page.data);
        if (page.data.length < 1000) break;
      }
      return { label, data: rows, contentRange: null, error: null };
    } catch (error) {
      return { label, data: rows, contentRange: null, error: error.message };
    }
  }

  const [staging, dealers, identities, attributed] = await Promise.all([
    optionalPaged('staging', 'dealer_directory_import_staging?select=id,source_system,source_id,comparison_status,matched_dealer_id&order=id.asc'),
    optionalPaged('dealers', 'dealers?select=id,status,contact_consent,verified_at,directory_source_id,rating,review_count,whatsapp_group_count&order=id.asc'),
    optionalPaged('identities', 'dealer_source_identities?select=id,dealer_id,source_system,identity_type,verification_status&order=id.asc'),
    optional('attributed', 'watch_records?select=id,dealer_id&dealer_id=not.is.null&order=dealer_id.asc&limit=1'),
  ]);

  const verifiedDealers = dealers.data.filter(row => row.status === 'VERIFIED');
  const consentedDealers = verifiedDealers.filter(row => row.contact_consent);
  const verifiedContactIdentities = identities.data.filter(row =>
    row.verification_status === 'VERIFIED' && /^(PHONE|WHATSAPP)$/i.test(String(row.identity_type || ''))
  );
  const matchedStaging = staging.data.filter(row => row.matched_dealer_id);

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    queryErrors: [staging, dealers, identities, attributed]
      .filter(result => result.error)
      .map(result => ({ section: result.label, error: result.error })),
    sourceCandidates: {
      total: staging.data.length,
      bySourceSystem: countBy(staging.data, 'source_system'),
      byComparisonStatus: countBy(staging.data, 'comparison_status'),
      matchedToDealer: matchedStaging.length,
    },
    dealers: {
      total: dealers.data.length,
      byStatus: countBy(dealers.data, 'status'),
      verified: verifiedDealers.length,
      verifiedWithContactConsent: consentedDealers.length,
    },
    sourceIdentities: {
      total: identities.data.length,
      byVerificationStatus: countBy(identities.data, 'verification_status'),
      byIdentityType: countBy(identities.data, 'identity_type'),
      verifiedPhoneOrWhatsapp: verifiedContactIdentities.length,
    },
    listings: {
      attributedSampleRows: attributed.data.length,
      attributedSampleCapped: attributed.data.length >= 1000,
      attributedExactTotal: attributed.error || attributed.data.length ? null : 0,
      exactTotalReason: attributed.error
        ? 'Indexed presence query failed; no exact total claimed.'
        : attributed.data.length
          ? 'At least one attributed row exists; an unbounded production COUNT was intentionally avoided.'
          : 'Indexed dealer_id presence query returned no rows.',
    },
    customerContactGate: {
      requiresVerifiedDealer: true,
      requiresContactConsent: true,
      requiresVerifiedPhoneOrWhatsappIdentity: true,
      freeTextInferenceAllowed: false,
    },
    blockers: [
      'Staged source-company identities require comparison against an authenticated authoritative dealer directory export.',
      'A listing may receive dealer_id only through immutable source lineage and an approved source identity match.',
      'Phone or WhatsApp contact remains hidden until dealer verification and explicit contact consent are both present.',
    ],
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'dealer_reconciliation_audit_complete', outputPath, ...report }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'dealer_reconciliation_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});
