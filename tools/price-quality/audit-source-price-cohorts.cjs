'use strict';

// Checkpointed, read-only source audit. This is intentionally separate from
// the public endpoint audit: it measures all eligible source rows without
// making thousands of expensive Vercel requests.
const fs = require('node:fs');
const path = require('node:path');
const { lookupCatalog } = require('../../api/_lib/catalog');
const { normalizeMarketRow, referenceBlock } = require('../../api/_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('../../api/_lib/price-research-eligibility.cjs');
const { comparisonKey, normalizeDialValue } = require('../../api/_lib/dial-normalization.cjs');
const { segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');

function required(name) {
  const raw = String(process.env[name] || '').trim();
  const value = raw.replace(/^(['"])(.*)\1$/, '$2').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : fallback;
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function matchesReference(candidate, reference) {
  const candidateRef = compact(candidate?.reference);
  const targetRef = compact(reference);
  return candidateRef === targetRef || candidateRef.startsWith(targetRef) || targetRef.startsWith(candidateRef);
}

function cohortKey(row) {
  const dial = normalizeDialValue(row.dial_color);
  const condition = ['NEW', 'USED'].includes(String(row.condition || '').trim().toUpperCase())
    ? String(row.condition).trim()
    : 'Unspecified';
  return [
    compact(row.brand || 'Unknown'),
    compact(row.reference || 'Unknown'),
    comparisonKey(dial.known ? dial.value : 'Unspecified'),
    condition.toUpperCase(),
  ].join('|');
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + Number(value || 0);
}

function normalizeCheckpointState(state) {
  const normalized = { ...state, cohorts: {} };
  for (const cohort of Object.values(state.cohorts || {})) {
    const key = cohortKey(cohort);
    const existing = normalized.cohorts[key];
    if (!existing) {
      normalized.cohorts[key] = {
        ...cohort,
        gate_counts: { ...(cohort.gate_counts || {}) },
        currency_status_counts: { ...(cohort.currency_status_counts || {}) },
        price_normalization_counts: { ...(cohort.price_normalization_counts || {}) },
      };
      continue;
    }
    existing.scanned += Number(cohort.scanned || 0);
    existing.eligible += Number(cohort.eligible || 0);
    existing.excluded += Number(cohort.excluded || 0);
    mergeCounts(existing.gate_counts, cohort.gate_counts);
    mergeCounts(existing.currency_status_counts, cohort.currency_status_counts);
    mergeCounts(existing.price_normalization_counts, cohort.price_normalization_counts);
  }
  return normalized;
}

function evaluateSourceRow(row) {
  const candidates = segmentDealerMessage(row.raw_message || '');
  const matchingCandidates = candidates.filter(candidate => matchesReference(candidate, row.reference));
  const candidateCount = candidates.length;
  const normalized = normalizeMarketRow(row, row.reference);
  const catalog = lookupCatalog(row.reference, row.brand || null);
  const sourceIssues = [];
  if (candidateCount !== 1) sourceIssues.push(candidateCount > 1 ? 'BUNDLE_SOURCE_UNSPLIT' : 'REFERENCE_NOT_SEGMENTED');
  if (matchingCandidates.length !== 1) sourceIssues.push('REFERENCE_SEGMENT_AMBIGUOUS');
  const gate = sourceIssues.length
    ? sourceIssues[0]
    : classifyResearchEligibility({
      ...row,
      price_usd: normalized.analytics_price_usd,
      analytics_currency_status: normalized.analytics_currency_status,
      bundle_candidate_count: candidateCount,
    }, catalog);
  return {
    gate: gate || null,
    candidate_count: candidateCount,
    matching_candidate_count: matchingCandidates.length,
    currency_status: normalized.analytics_currency_status || 'UNKNOWN',
    derived_price_usd: normalized.analytics_price_usd ?? null,
    price_normalization: normalized.price_normalization || null,
    reference_line: referenceBlock(row.raw_message, row.reference),
  };
}

function addRow(state, row, result, sampleLimit) {
  state.scanned += 1;
  increment(state.currency_status_counts, result.currency_status);
  const key = cohortKey(row);
  const cohort = state.cohorts[key] || {
    brand: row.brand || 'Unknown', reference: row.reference || 'Unknown',
    dial_color: key.split('|')[2], condition: key.split('|')[3],
    scanned: 0, eligible: 0, excluded: 0, gate_counts: {},
    currency_status_counts: {}, price_normalization_counts: {},
  };
  cohort.scanned += 1;
  increment(cohort.currency_status_counts, result.currency_status);
  if (result.price_normalization) increment(cohort.price_normalization_counts, result.price_normalization);
  if (result.gate) {
    state.excluded += 1;
    cohort.excluded += 1;
    increment(state.gate_counts, result.gate);
    increment(cohort.gate_counts, result.gate);
    if (state.samples.excluded.length < sampleLimit) state.samples.excluded.push({
      id: row.id, brand: row.brand, reference: row.reference, dial_color: row.dial_color,
      condition: row.condition, stored_price_usd: row.price_usd, derived_price_usd: result.derived_price_usd,
      gate: result.gate, currency_status: result.currency_status, candidate_count: result.candidate_count,
      reference_line: result.reference_line,
    });
  } else {
    state.eligible += 1;
    cohort.eligible += 1;
    if (state.samples.eligible.length < sampleLimit) state.samples.eligible.push({
      id: row.id, brand: row.brand, reference: row.reference, dial_color: row.dial_color,
      condition: row.condition, stored_price_usd: row.price_usd, derived_price_usd: result.derived_price_usd,
      currency_status: result.currency_status, price_normalization: result.price_normalization,
      reference_line: result.reference_line,
    });
  }
  state.cohorts[key] = cohort;
}

async function rest(baseUrl, key, pathname) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

function summarize(state, meta) {
  const cohorts = Object.values(state.cohorts);
  return {
    generated_at: new Date().toISOString(), read_only: true, ...meta,
    scanned: state.scanned, eligible: state.eligible, excluded: state.excluded,
    currency_status_counts: state.currency_status_counts, gate_counts: state.gate_counts,
    cohort_count: cohorts.length,
    publication_candidate_cohorts: cohorts.filter(cohort => cohort.eligible >= 5).length,
    cohorts: cohorts.sort((a, b) => b.eligible - a.eligible || a.reference.localeCompare(b.reference)),
    samples: state.samples,
    watch_records_mutated: false,
  };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const maxRows = bounded('SOURCE_PRICE_AUDIT_MAX_ROWS', 10_000, 1, 2_700_000);
  const pageSize = bounded('SOURCE_PRICE_AUDIT_PAGE_SIZE', 500, 50, 1_000);
  const checkpointRows = bounded('SOURCE_PRICE_AUDIT_CHECKPOINT_ROWS', 25_000, pageSize, 100_000);
  const sampleLimit = bounded('SOURCE_PRICE_AUDIT_SAMPLE_LIMIT', 100, 1, 1_000);
  const outputDir = path.resolve(process.env.SOURCE_PRICE_AUDIT_OUTPUT || 'audit-output/price-research/source-cohorts');
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const reportPath = path.join(outputDir, 'report.json');
  const previous = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
  const state = normalizeCheckpointState(previous?.state || { scanned: 0, eligible: 0, excluded: 0, currency_status_counts: {}, gate_counts: {}, cohorts: {}, samples: { eligible: [], excluded: [] } });
  let lastId = previous?.last_id || String(process.env.SOURCE_PRICE_AUDIT_AFTER_ID || '');
  const startScanned = state.scanned;
  const targetScanned = startScanned + maxRows;
  let lastCheckpointAt = startScanned;

  while (state.scanned < targetScanned) {
    const limit = Math.min(pageSize, targetScanned - state.scanned);
    const params = new URLSearchParams({
      select: 'id,brand,reference,dial_color,condition,listing_type,verdict,listing_status,price_usd,currency,raw_message,flags,source',
      order: 'id.asc', limit: String(limit), verdict: 'eq.APPROVED', listing_type: 'eq.WTS',
      price_usd: 'gt.0', reference: 'not.is.null', raw_message: 'not.is.null',
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const rows = await rest(baseUrl, key, `watch_records?${params.toString()}`);
    if (!rows.length) break;
    for (const row of rows) addRow(state, row, evaluateSourceRow(row), sampleLimit);
    lastId = rows[rows.length - 1].id;
    if (state.scanned - lastCheckpointAt >= checkpointRows) {
      const checkpoint = { updated_at: new Date().toISOString(), last_id: lastId, state, watch_records_mutated: false };
      atomicJson(checkpointPath, checkpoint);
      lastCheckpointAt = state.scanned;
      process.stdout.write(`${JSON.stringify({ event: 'source_price_audit_checkpoint', scanned: state.scanned, eligible: state.eligible, excluded: state.excluded, lastId })}\n`);
    }
  }
  const report = summarize(state, { last_id: lastId || null, scanned_this_run: state.scanned - startScanned });
  atomicJson(reportPath, report);
  atomicJson(checkpointPath, { updated_at: new Date().toISOString(), last_id: lastId, state, watch_records_mutated: false });
  process.stdout.write(`${JSON.stringify({ event: 'source_price_audit_complete', scanned: report.scanned, eligible: report.eligible, excluded: report.excluded, cohortCount: report.cohort_count, publicationCandidateCohorts: report.publication_candidate_cohorts, watchRecordsMutated: false })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'source_price_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { addRow, evaluateSourceRow, cohortKey, matchesReference, normalizeCheckpointState };
