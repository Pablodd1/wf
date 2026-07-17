'use strict';

// Read-only bundle-review export. It never changes source records, shadow rows,
// or review decisions. Raw source text remains evidence, not an instruction to
// automatically split or delete a listing.
const fs = require('fs');
const path = require('path');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const pageSize = Math.max(10, Math.min(Number(process.env.BUNDLE_REPORT_PAGE_SIZE || 250), 500));
const maxRows = Math.max(0, Number(process.env.BUNDLE_REPORT_MAX_ROWS || 1000));
const outputDir = process.env.BUNDLE_REPORT_OUTPUT_DIR || path.join(process.cwd(), 'audit-output', 'bundle-evidence');

if (!baseUrl || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

function csv(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function summarizeCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    position: index + 1,
    raw_line: candidate?.raw_line || null,
    brand: candidate?.brand || null,
    reference: candidate?.reference || null,
    dial_color: candidate?.dial_color || null,
    listing_type: candidate?.listing_type || null,
    price_raw: candidate?.price_raw ?? null,
    currency: candidate?.currency || null,
    currency_evidence: candidate?.currency_evidence || null,
    dial_confidence: candidate?.dial_confidence ?? null,
    dial_ambiguous: Boolean(candidate?.dial_ambiguous),
  }));
}

function reviewDisposition(row, candidates, rawMessage) {
  const reasons = [];
  if (!rawMessage) reasons.push('MISSING_RAW_MESSAGE');
  if (Number(row.candidate_count) < 2) reasons.push('NOT_MULTI_CANDIDATE');
  if (candidates.some(candidate => !candidate.reference)) reasons.push('CANDIDATE_REFERENCE_MISSING');
  if (candidates.some(candidate => candidate.dial_ambiguous)) reasons.push('DIAL_AMBIGUOUS');
  if (candidates.some(candidate => candidate.price_raw && !candidate.currency)) reasons.push('CURRENCY_MISSING');
  return { disposition: reasons.length ? 'HUMAN_REVIEW_REQUIRED' : 'SAFE_SPLIT_CANDIDATE', reasons };
}

async function rest(pathname) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchSourceRecords(ids) {
  if (!ids.length) return new Map();
  const params = new URLSearchParams({
    select: 'id,raw_message,source,source_type,created_at,listing_date,has_images',
    id: `in.(${ids.join(',')})`,
  });
  const rows = await rest(`watch_records?${params.toString()}`);
  return new Map(rows.map(row => [row.id, row]));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(outputDir, `bundle-evidence-${stamp}.csv`);
  const summaryPath = path.join(outputDir, `bundle-evidence-${stamp}.json`);
  const writer = fs.createWriteStream(csvPath, { encoding: 'utf8' });
  writer.write([
    'source_record_id', 'source', 'source_type', 'created_at', 'listing_date',
    'source_brand', 'source_reference', 'source_listing_type', 'candidate_count',
    'disposition', 'review_reasons', 'has_images', 'raw_message', 'proposed_candidates',
  ].join(',') + '\n');

  let lastId = '';
  let written = 0;
  let rawMessagePresent = 0;
  let safeSplitCandidates = 0;
  let humanReviewRequired = 0;
  const reasonCounts = {};

  while (maxRows === 0 || written < maxRows) {
    const limit = maxRows === 0 ? pageSize : Math.min(pageSize, maxRows - written);
    const params = new URLSearchParams({
      select: 'source_record_id,source_brand,source_reference,source_listing_type,candidate_count,proposed_candidates,change_flags,analyzed_at',
      change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
      order: 'source_record_id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('source_record_id', `gt.${lastId}`);
    const rows = await rest(`normalization_shadow_v4?${params.toString()}`);
    if (!rows.length) break;
    const sourceById = await fetchSourceRecords(rows.map(row => row.source_record_id));

    for (const row of rows) {
      const source = sourceById.get(row.source_record_id) || {};
      const candidates = summarizeCandidates(row.proposed_candidates);
      const rawMessage = source.raw_message || '';
      const decision = reviewDisposition(row, candidates, rawMessage);
      if (rawMessage) rawMessagePresent += 1;
      if (decision.disposition === 'SAFE_SPLIT_CANDIDATE') safeSplitCandidates += 1;
      else humanReviewRequired += 1;
      for (const reason of decision.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;

      writer.write([
        row.source_record_id, source.source, source.source_type, source.created_at, source.listing_date,
        row.source_brand, row.source_reference, row.source_listing_type, row.candidate_count,
        decision.disposition, decision.reasons.join('|'), Boolean(source.has_images), rawMessage, candidates,
      ].map(csv).join(',') + '\n');
      written += 1;
    }
    lastId = rows.at(-1).source_record_id;
    console.error(JSON.stringify({ event: 'bundle_evidence_page', written, lastSourceRecordId: lastId }));
    if (rows.length < limit) break;
  }

  await new Promise((resolve, reject) => writer.end(error => (error ? reject(error) : resolve())));
  const summary = {
    generatedAt: new Date().toISOString(), readOnly: true, reportLimit: maxRows || 'unbounded', rowsWritten: written,
    rawMessageCoveragePercent: written ? Number(((rawMessagePresent / written) * 100).toFixed(2)) : 0,
    safeSplitCandidates, humanReviewRequired, reviewReasonCounts: reasonCounts, csvPath,
    safety: 'No source messages, live listings, shadow proposals, or review decisions were changed.',
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ event: 'bundle_evidence_report_error', error: error.message })); process.exitCode = 1; });
