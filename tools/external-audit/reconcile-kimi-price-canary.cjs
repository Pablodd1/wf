'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const {
  auditRow,
  CANARY_POLICY_VERSION,
} = require('../price-quality/audit-price-normalization.cjs');

const DEFAULT_INPUT_LIMIT = 1000;
const DEFAULT_CANARY_LIMIT = 100;

function required(name) {
  const raw = String(process.env[name] || '').trim();
  const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2').trim();
  const value = unquoted.replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : fallback;
}

function truthy(value) {
  return /^(?:true|1|yes)$/i.test(String(value || '').trim());
}

function hasExplicitUsdEvidence(value) {
  return /(?:\bUSD\b|USD\s*\$|US\$)/i.test(String(value || ''))
    && !/\bUSDT\b/i.test(String(value || ''));
}

function eligibleExternalRow(row) {
  return row.recommendation === 'APPLY_CANDIDATE'
    && truthy(row.stored_value_correction_candidate)
    && row.source_currency_status === 'VERIFIED'
    && Number(row.stored_price_usd) > 0
    && Number(row.proposed_price_usd) > 0
    && Number(row.stored_price_usd) !== Number(row.proposed_price_usd);
}

function buildReviewCandidate(external, source, options = {}) {
  if (!eligibleExternalRow(external) || !source) return null;
  const finding = auditRow(source, { minDeltaPct: 0.01 });
  if (!finding?.canary_eligible) return null;

  // Dated FX evidence is not in Kimi's handoff. Keep HKD candidates out of this
  // first source-verified USD canary unless the operator explicitly opts in.
  if (!options.allowHkd && finding.price_normalization !== 'EXPLICIT_USD_FROM_REFERENCE_LINE') return null;
  if (Math.abs(Number(finding.normalized_price_usd) - Number(external.proposed_price_usd)) > 0.01) return null;
  if (Math.abs(Number(source.price_usd) - Number(external.stored_price_usd)) > 0.01) return null;

  return {
    source_record_id: external.source_record_id,
    normalization_version: options.version,
    stored_price_usd: Number(external.stored_price_usd),
    proposed_price_usd: Number(external.proposed_price_usd),
    normalization_reason: finding.price_normalization,
    evidence_line: external.raw_evidence_line,
    audit_flags: [...new Set(['KIMI_EXTERNAL_AUDIT', ...finding.flags])],
    review_status: 'PENDING',
    updated_at: new Date().toISOString(),
  };
}

async function readCandidates(inputPath, limit, options = {}) {
  const candidates = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(csv({ strict: true }))
      .on('data', row => {
        if (
          candidates.length < limit
          && eligibleExternalRow(row)
          && (options.allowHkd || hasExplicitUsdEvidence(row.raw_evidence_line))
        ) candidates.push(row);
      })
      .on('error', reject)
      .on('end', resolve);
  });
  return candidates;
}

async function rest(baseUrl, key, pathname) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchSources(baseUrl, key, ids) {
  const result = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const params = new URLSearchParams({
      select: 'id,brand,reference,dial_color,condition,listing_type,created_at,listing_date,currency,price_usd,raw_message',
      id: `in.(${batch.join(',')})`,
      limit: String(batch.length),
    });
    const rows = await rest(baseUrl, key, `watch_records?${params.toString()}`);
    for (const row of rows) result.set(row.id, row);
  }
  return result;
}

async function main() {
  const inputPath = path.resolve(required('KIMI_PRICE_INPUT'));
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const inputLimit = bounded('KIMI_CANARY_INPUT_LIMIT', DEFAULT_INPUT_LIMIT, 1, 5000);
  const canaryLimit = bounded('KIMI_CANARY_LIMIT', DEFAULT_CANARY_LIMIT, 1, 100);
  const version = String(process.env.KIMI_CANARY_VERSION || 'kimi-price-evidence-20260722').trim();
  const allowHkd = String(process.env.KIMI_CANARY_ALLOW_HKD || 'false').toLowerCase() === 'true';
  const outputPath = path.resolve(process.env.KIMI_CANARY_OUTPUT || 'audit-output/external-ai/kimi-price-canary.json');

  const externalCandidates = await readCandidates(inputPath, inputLimit, { allowHkd });
  const sourceById = await fetchSources(baseUrl, key, externalCandidates.map(row => row.source_record_id));
  const counts = { externalCandidates: externalCandidates.length, sourceMissing: 0, sourceStoredMismatch: 0, sourcePolicyBlocked: 0, proposalMismatch: 0, eligible: 0 };
  const canaryCandidates = [];

  for (const external of externalCandidates) {
    const source = sourceById.get(external.source_record_id);
    if (!source) {
      counts.sourceMissing += 1;
      continue;
    }
    if (Math.abs(Number(source.price_usd) - Number(external.stored_price_usd)) > 0.01) {
      counts.sourceStoredMismatch += 1;
      continue;
    }
    const candidate = buildReviewCandidate(external, source, { version, allowHkd });
    if (!candidate) {
      const finding = auditRow(source, { minDeltaPct: 0.01 });
      if (finding && Math.abs(Number(finding.normalized_price_usd) - Number(external.proposed_price_usd)) > 0.01) counts.proposalMismatch += 1;
      else counts.sourcePolicyBlocked += 1;
      continue;
    }
    counts.eligible += 1;
    if (canaryCandidates.length < canaryLimit) canaryCandidates.push(candidate);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    source: { inputPath, inputLimit, canaryLimit, allowHkd, externalAudit: 'Kimi corrected handoff' },
    counts,
    canaryCandidates,
    canaryReleaseGate: {
      policyVersion: CANARY_POLICY_VERSION,
      mode: 'READ_ONLY_SOURCE_RECONCILIATION',
      productionWrites: false,
      requiredBeforeWrite: [
        'Stage only these source-verified candidates into price_remediation_review.',
        'Review each raw message and source record in the human-review queue.',
        'Apply only an explicit human-approved decision through the audited RPC.',
      ],
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'kimi_price_canary_reconciled', outputPath, ...counts, stagedCandidates: canaryCandidates.length, watchRecordsMutated: false }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'kimi_price_canary_reconciliation_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { eligibleExternalRow, buildReviewCandidate, hasExplicitUsdEvidence };
