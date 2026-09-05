'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CANARY_POLICY_VERSION } = require('./audit-price-normalization.cjs');

const inputPath = path.resolve(process.env.PRICE_CANARY_INPUT || 'audit-output/price-normalization/audit-100k-gated-20260719.json');
const write = String(process.env.PRICE_CANARY_WRITE || 'false').toLowerCase() === 'true';
const maxRows = Math.max(1, Math.min(Number(process.env.PRICE_CANARY_MAX_ROWS || 100), 100));
const version = String(process.env.PRICE_CANARY_VERSION || 'market-line-v1').trim();

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function buildRows(report) {
  if (!report?.readOnly || report?.canaryReleaseGate?.productionWrites !== false) {
    throw new Error('Input is not a read-only gated audit report');
  }
  if (report.canaryReleaseGate.policyVersion !== CANARY_POLICY_VERSION) {
    throw new Error(`Canary policy mismatch; expected ${CANARY_POLICY_VERSION}`);
  }
  return (report.canaryCandidates || []).slice(0, maxRows).map(candidate => {
    if (!candidate.canary_eligible || candidate.canary_exclusions?.length) {
      throw new Error(`Unsafe candidate in canary input: ${candidate.id}`);
    }
    return {
      source_record_id: candidate.id,
      normalization_version: version,
      stored_price_usd: candidate.stored_price_usd,
      proposed_price_usd: candidate.normalized_price_usd,
      normalization_reason: candidate.price_normalization,
      evidence_line: candidate.evidence_line,
      audit_flags: candidate.flags,
      review_status: 'PENDING',
      updated_at: new Date().toISOString(),
    };
  });
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`Canary report not found: ${inputPath}`);
  const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const rows = buildRows(report);
  if (!rows.length) throw new Error('Canary report has no eligible candidates');

  if (write) {
    const baseUrl = required('SUPABASE_URL');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
    const response = await fetch(`${baseUrl}/rest/v1/price_remediation_review?on_conflict=source_record_id,normalization_version`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  process.stdout.write(`${JSON.stringify({
    event: 'price_canary_staging_complete',
    mode: write ? 'review_table_write' : 'dry_run',
    inputPath,
    normalizationVersion: version,
    candidates: rows.length,
    target: 'price_remediation_review',
    watchRecordsMutated: false,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'price_canary_staging_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildRows };
