'use strict';

const DEFAULT_JOB_NAME = 'normalization-v4-dial-production';
const DEFAULT_ARCHIVE_ESTIMATE = 2631468;
const DEFAULT_EVIDENCE_SAMPLE_LIMIT = 500;
const MAX_EVIDENCE_SAMPLE_LIMIT = 25000;

const FLAGS = [
  'BUNDLE_SPLIT_REQUIRED',
  'NO_CANDIDATE',
  'REFERENCE_CHANGED',
  'INTENT_CHANGED',
  'PRICE_CHANGED',
  'BRAND_CHANGED',
  'CURRENCY_CHANGED',
  'CURRENCY_AMBIGUOUS',
  'PRICE_PARSE_FAILED',
  'DIAL_CHANGED',
  'DIAL_AMBIGUOUS',
];

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const jobName = process.env.SHADOW_JOB_NAME || DEFAULT_JOB_NAME;
const archiveEstimate = Math.max(1, Number(process.env.WATCH_RECORDS_ESTIMATE || DEFAULT_ARCHIVE_ESTIMATE));
const evidenceSampleLimit = Math.max(
  100,
  Math.min(Number(process.env.EVIDENCE_SAMPLE_LIMIT || DEFAULT_EVIDENCE_SAMPLE_LIMIT), MAX_EVIDENCE_SAMPLE_LIMIT),
);

if (!baseUrl || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function bump(map, keyName) {
  const key = keyName || 'unresolved';
  map[key] = (map[key] || 0) + 1;
}

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

async function plannedCount(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=planned',
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const range = response.headers.get('content-range') || '';
  return Number.parseInt(range.split('/')[1] || '0', 10) || 0;
}

async function readCheckpoint() {
  const rows = await fetchJson(
    `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=rows_analyzed,last_source_record_id,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function readFlagCounts() {
  const entries = [];
  for (const flag of FLAGS) {
    try {
      const count = await plannedCount(
        `normalization_shadow_v4?select=source_record_id&change_flags=cs.{${flag}}`,
      );
      entries.push([flag, count]);
    } catch (error) {
      entries.push([flag, { error: error.message }]);
    }
  }
  return Object.fromEntries(entries);
}

async function readEvidenceSample(checkpoint) {
  const params = new URLSearchParams({
    select: [
      'source_record_id',
      'candidate_count',
      'review_status',
      'source_listing_type',
      'change_flags',
      'proposed_candidates',
      'analyzed_at',
    ].join(','),
    order: 'source_record_id.desc',
    limit: String(evidenceSampleLimit),
  });
  if (checkpoint?.last_source_record_id) {
    params.set('source_record_id', `lte.${checkpoint.last_source_record_id}`);
  }
  const rows = await fetchJson(`normalization_shadow_v4?${params.toString()}`);
  const sample = {
    rows: rows.length,
    reviewStatus: {},
    candidateCount: {},
    listingType: {},
    dialEvidence: {},
    currencyEvidence: {},
    changedRows: 0,
    dialAmbiguousRows: 0,
  };

  for (const row of rows) {
    const flags = Array.isArray(row.change_flags) ? row.change_flags : [];
    const candidates = Array.isArray(row.proposed_candidates) ? row.proposed_candidates : [];
    const primaryCandidate = candidates[0] || {};
    const prices = Array.isArray(primaryCandidate.prices) ? primaryCandidate.prices : [];
    const primaryPrice = prices.find(price => price && price.is_primary) || prices[0] || {};

    bump(sample.reviewStatus, row.review_status);
    bump(sample.candidateCount, String(row.candidate_count ?? 'unknown'));
    bump(sample.listingType, row.source_listing_type);
    bump(sample.dialEvidence, primaryCandidate.dial_evidence || (primaryCandidate.dial_ambiguous ? 'dial_ambiguous' : null));
    bump(sample.currencyEvidence, primaryPrice.currency_evidence);
    if (flags.length > 0) sample.changedRows += 1;
    if (flags.includes('DIAL_AMBIGUOUS')) sample.dialAmbiguousRows += 1;
  }

  return sample;
}

async function main() {
  const checkpoint = await readCheckpoint();
  const shadowRowsResult = await plannedCount('normalization_shadow_v4?select=source_record_id')
    .then(value => ({ value }))
    .catch(error => ({ error: error.message }));
  const changedRowsResult = await plannedCount('normalization_shadow_v4?select=source_record_id&change_flags=not.eq.{}')
    .then(value => ({ value }))
    .catch(error => ({ error: error.message }));
  const flagCountsEstimated = await readFlagCounts();
  const evidenceSample = await readEvidenceSample(checkpoint).catch(error => ({
    rows: 0,
    error: error.message,
  }));

  const rowsAnalyzed = Number(checkpoint?.rows_analyzed || 0);
  const shadowRowsEstimated = shadowRowsResult.value ?? null;
  const changedRowsEstimated = changedRowsResult.value ?? null;
  const report = {
    generatedAt: new Date().toISOString(),
    jobName,
    exactCheckpoint: {
      rowsAnalyzed,
      lastSourceRecordId: checkpoint?.last_source_record_id || null,
      updatedAt: checkpoint?.updated_at || null,
      ageSeconds: checkpoint?.updated_at
        ? Math.max(0, Math.round((Date.now() - new Date(checkpoint.updated_at).getTime()) / 1000))
        : null,
    },
    archiveProgress: {
      archiveEstimate,
      percentComplete: pct(rowsAnalyzed, archiveEstimate),
      remainingEstimate: Math.max(0, archiveEstimate - rowsAnalyzed),
    },
    plannerCounts: {
      countsAreEstimated: true,
      scope: 'table-wide normalization_shadow_v4; this table does not store job_name',
      partial: Boolean(shadowRowsResult.error || changedRowsResult.error || Object.values(flagCountsEstimated).some(value => value?.error)),
      shadowRowsEstimated,
      shadowRowsError: shadowRowsResult.error || null,
      changedRowsEstimated,
      changedRowsError: changedRowsResult.error || null,
      changedPercentOfShadowRows: pct(changedRowsEstimated, shadowRowsEstimated),
      flagCountsEstimated,
    },
    boundedEvidenceSample: {
      countsAreSampled: true,
      scope: 'source_record_id <= checkpoint.last_source_record_id; not job-scoped because shadow rows do not store job_name',
      sampleLimit: evidenceSampleLimit,
      ...evidenceSample,
    },
    safety: {
      readOnly: true,
      liveRowsMutated: false,
      promotionDecision: 'none',
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'shadow_progress_report_error', error: error.message }));
  process.exitCode = 1;
});
