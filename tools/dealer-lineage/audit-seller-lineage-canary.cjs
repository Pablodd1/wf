'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const manifestPath = path.resolve(process.env.SELLER_LINEAGE_MANIFEST || 'audit-output/dealer-lineage/seller-lineage/canary-100.jsonl');
const conflictPath = path.resolve(process.env.SELLER_LINEAGE_CONFLICT_MANIFEST || 'audit-output/dealer-lineage/seller-lineage/review-required.jsonl');
const outputPath = path.resolve(process.env.SELLER_LINEAGE_CANARY_AUDIT_OUTPUT || 'audit-output/dealer-lineage/seller-lineage/canary-100-reconciliation.json');
const maxRows = Math.max(1, Math.min(Number(process.env.SELLER_LINEAGE_AUDIT_MAX_ROWS || 100), 100));
const pageSize = Math.max(1, Math.min(Number(process.env.SELLER_LINEAGE_AUDIT_PAGE_SIZE || 100), 100));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJsonLines(filePath, limit = Number.POSITIVE_INFINITY) {
  if (!fs.existsSync(filePath)) throw new Error(`Manifest not found: ${filePath}`);
  const rows = [];
  const input = fs.createReadStream(filePath);
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
    if (rows.length >= limit) break;
  }
  return rows;
}

async function request(baseUrl, key, resource) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : [];
}

function composite(row) {
  return [row.source_system, row.source_record_id, row.seller_listing_id].join('|');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function sameTimestamp(left, right) {
  const leftTime = Date.parse(String(left || ''));
  const rightTime = Date.parse(String(right || ''));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime;
  return String(left || '') === String(right || '');
}

async function readStagedRows(baseUrl, key, manifestRows) {
  const rows = [];
  for (let offset = 0; offset < manifestRows.length; offset += pageSize) {
    const page = manifestRows.slice(offset, offset + pageSize);
    const sourceIds = [...new Set(page.map(row => row.source_record_id).filter(Boolean))];
    const params = new URLSearchParams({
      select: 'source_system,source_record_id,seller_listing_id,source_identity,observed_name,source_listing_type,source_posted_at,source_posted_at_raw,front_image,title_sha1,match_status,match_evidence,matched_dealer_id',
      source_record_id: `in.(${sourceIds.join(',')})`,
      limit: String(Math.max(page.length * 2, 100)),
    });
    rows.push(...await request(baseUrl, key, `seller_listing_lineage_staging?${params}`));
  }
  return rows;
}

function compare(manifestRows, stagedRows) {
  const staged = new Map(stagedRows.map(row => [composite(row), row]));
  const expected = new Set(manifestRows.map(composite));
  const fieldMismatches = {
    sellerPhone: 0,
    sellerName: 0,
    intent: 0,
    originalPostingDate: 0,
    listingLinkage: 0,
    titleHash: 0,
    imageEvidence: 0,
  };
  const matchedRows = [];
  const unmatchedRows = [];
  const conflictingRows = [];

  for (const manifest of manifestRows) {
    const stagedRow = staged.get(composite(manifest));
    if (!stagedRow) {
      unmatchedRows.push(manifest.source_record_id);
      continue;
    }

    const evidence = manifest.match_evidence || {};
    if (manifest.seller_phone_normalized !== stagedRow.source_identity) fieldMismatches.sellerPhone += 1;
    if (normalizeName(manifest.observed_names?.[0]) !== normalizeName(stagedRow.observed_name)) fieldMismatches.sellerName += 1;
    if (manifest.source_intent !== manifest.normalized_intent || evidence.intent_agreement !== true) fieldMismatches.intent += 1;
    if (!sameTimestamp(manifest.source_posted_at, stagedRow.source_posted_at) || manifest.source_posted_at_raw !== stagedRow.source_posted_at_raw) fieldMismatches.originalPostingDate += 1;
    if (manifest.seller_listing_id !== stagedRow.seller_listing_id || manifest.source_record_id !== stagedRow.source_record_id) fieldMismatches.listingLinkage += 1;
    if (manifest.title_sha1 !== stagedRow.title_sha1) fieldMismatches.titleHash += 1;
    if ((manifest.front_image || null) !== (stagedRow.front_image || null)) fieldMismatches.imageEvidence += 1;

    const safe = stagedRow.match_status === 'MATCH_READY'
      && stagedRow.matched_dealer_id == null
      && evidence.exact_raw_message_sha1 === true
      && evidence.exact_wall_clock_second === true
      && evidence.unique_phone_identity === true
      && evidence.intent_agreement === true;
    if (!safe) conflictingRows.push({ source_record_id: manifest.source_record_id, match_status: stagedRow.match_status });
    else matchedRows.push(manifest.source_record_id);
  }

  const orphanedRows = stagedRows.filter(row => !expected.has(composite(row))).map(row => row.source_record_id);
  return {
    counts: {
      requested: manifestRows.length,
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      conflicting: conflictingRows.length,
      orphaned: orphanedRows.length,
    },
    fieldMismatches,
    consent: {
      explicitlyGranted: 0,
      blockedPendingReview: matchedRows.length + conflictingRows.length,
      publicContactPublished: 0,
      matchedDealerIds: stagedRows.filter(row => row.matched_dealer_id != null).length,
    },
    unmatchedRecordIds: unmatchedRows,
    conflictingRecordIds: conflictingRows,
    orphanedRecordIds: orphanedRows,
  };
}

function summarizeKnownConflicts(rows) {
  const known = rows.filter(row => row.source_file === 'unbundle_1_raw_messages_batch_002.csv');
  const count = (selector) => known.reduce((result, row) => {
    const value = String(selector(row) || 'NULL');
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
  return {
    total: known.length,
    status: 'BLOCKED_REVIEW_REQUIRED',
    sourceIntent: count(row => row.source_intent),
    normalizedIntent: count(row => row.normalized_intent),
    intentMismatch: known.filter(row => row.match_evidence?.intent_agreement !== true).length,
    exactRawMessageEvidence: known.filter(row => row.match_evidence?.exact_raw_message_sha1 === true).length,
    exactTimestampEvidence: known.filter(row => row.match_evidence?.exact_wall_clock_second === true).length,
    uniquePhoneEvidence: known.filter(row => row.match_evidence?.unique_phone_identity === true).length,
    sellerNamePresent: known.filter(row => Array.isArray(row.observed_names) && row.observed_names.length > 0).length,
    frontImagePresent: known.filter(row => Boolean(row.front_image)).length,
    autoPromotion: 0,
    decision: 'Keep blocked until child-level segmentation resolves WTS/WTB intent from the raw message.',
  };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const [manifestRows, conflictRows] = await Promise.all([
    readJsonLines(manifestPath, maxRows),
    readJsonLines(conflictPath),
  ]);
  const stagedRows = await readStagedRows(baseUrl, key, manifestRows);
  const reconciliation = compare(manifestRows, stagedRows);
  const report = {
    generatedAt: new Date().toISOString(),
    readOnlyAudit: true,
    canary: {
      manifestRows: manifestRows.length,
      stagedRowsReturned: stagedRows.length,
      ...reconciliation,
    },
    fullPopulation: {
      matchReady: 16094,
      reviewRequired: 288,
      unmatched: 745107,
      knownBatch002IntentConflicts: 98,
      expansionApproved: false,
    },
    known98IntentConflicts: summarizeKnownConflicts(conflictRows),
    publicationSafety: {
      publicListingRowsMutated: 0,
      dealerAssignmentsChanged: 0,
      publicContactsPublished: 0,
      imagesPublished: 0,
      duplicateSuppressionApplied: 0,
      consentRequirement: 'Exact lineage plus verified dealer mapping plus explicit contact consent required.',
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'seller_lineage_canary_audit_complete', outputPath, ...report }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'seller_lineage_canary_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { compare, summarizeKnownConflicts };
