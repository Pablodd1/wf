#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractPriceCandidates,
  extractPriceObservations,
  segmentDealerMessage,
} = require('../../api/_lib/normalization-v4.cjs');
const { applyCurrencyPolicy } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { fetchFxSnapshot } = require('../mariadb-live/fetch-fx-snapshot.cjs');

const REFERENCES = new Set(['126334', '126300', '228235', '228238', '126333']);
const SAFE = new Set(['SAFE_EXPLICIT_USD', 'SAFE_EXPLICIT_USDT', 'SAFE_VERIFIED_FX']);
const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

function base(row) {
  return {
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    raw_message_version_id: row.raw_message_version_id,
    source_hash: row.source_hash,
    source_candidate_hash: row.source_candidate_hash,
    normalized_reference: row.reference_normalized,
    intent: row.intent,
    publication_state: {
      normalization_status: row.normalization_status || null,
      publication_review_status: row.publication_review_status || null,
      trading_floor_status: row.trading_floor_status || null,
      price_research_status: row.price_research_status || null,
      verdict: row.verdict || null,
    },
    existing_price: {
      price_original: positive(row.price_original),
      currency_original: row.currency_original || null,
      price_normalized: positive(row.price_normalized),
      currency_normalized: row.currency_normalized || null,
      price_usd: positive(row.price_usd),
      currency_evidence: row.currency_evidence || null,
      conversion_rate: positive(row.conversion_rate),
      conversion_timestamp: row.conversion_timestamp || null,
      conversion_source: row.conversion_source || null,
    },
  };
}

function classify(row, fxSnapshot) {
  const output = base(row);
  const raw = String(row.raw_message || '');
  const reference = refKey(row.reference_normalized);
  if (!REFERENCES.has(reference) || row.intent !== 'WTS' || positive(row.price_usd)) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'OUT_OF_SCOPE_OR_TARGET_NOT_NULL' };
  }
  if (!raw || !refKey(raw).includes(reference)) {
    return { ...output, classification: 'UNRESOLVED', reason: 'REFERENCE_NOT_PROVEN_IN_IMMUTABLE_RAW' };
  }
  if (!row.source_record_id || !row.raw_message_version_id || !SHA256.test(row.source_hash || '')
    || !SHA256.test(row.source_candidate_hash || '')) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'INCOMPLETE_IMMUTABLE_LINEAGE' };
  }
  const segments = segmentDealerMessage(raw);
  if (row.parent_id || row.is_bundle === true || row.bundle_status !== 'SINGLE_CANDIDATE' || segments.length !== 1) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT' };
  }
  const candidates = extractPriceCandidates(raw);
  if (candidates.some(item => item.review_reason === 'BUNDLE_PRICE_AMBIGUITY')) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'PARSER_BUNDLE_PRICE_AMBIGUITY' };
  }
  if (candidates.some(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY') || candidates.length > 1) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'MULTIPLE_PRICE_CANDIDATES' };
  }
  const observations = extractPriceObservations(raw);
  if (observations.length !== 1 || observations[0].evidence_status !== 'AUTO_APPROVED') {
    const needsReview = candidates.some(item => item.evidence_status === 'REVIEW_REQUIRED' || item.review_reason);
    return {
      ...output,
      classification: needsReview ? 'REVIEW_REQUIRED' : 'UNRESOLVED',
      reason: needsReview ? 'PRICE_OR_CURRENCY_REQUIRES_REVIEW' : 'NO_EXACT_AUTO_APPROVED_PRICE',
    };
  }
  const observation = observations[0];
  if (positive(row.price_original) && positive(row.price_original) !== positive(observation.amount_original)) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'EXISTING_ORIGINAL_PRICE_CONFLICT' };
  }
  if (row.currency_original && String(row.currency_original).toUpperCase() !== String(observation.currency_original).toUpperCase()) {
    return { ...output, classification: 'REVIEW_REQUIRED', reason: 'EXISTING_ORIGINAL_CURRENCY_CONFLICT' };
  }
  const converted = applyCurrencyPolicy(observation, fxSnapshot);
  const currency = String(converted.currency_original || '').toUpperCase();
  let classification;
  if (currency === 'USD') classification = 'SAFE_EXPLICIT_USD';
  else if (currency === 'USDT') classification = 'SAFE_EXPLICIT_USDT';
  else if (positive(converted.amount_usd) && positive(converted.conversion_rate)
    && converted.conversion_timestamp && converted.conversion_source) classification = 'SAFE_VERIFIED_FX';
  else return { ...output, classification: 'REVIEW_REQUIRED', reason: 'DATED_FX_UNAVAILABLE' };

  return {
    ...output,
    classification,
    reason: 'EXACT_AUTO_APPROVED_SOURCE_PRICE_AND_IMMUTABLE_LINEAGE',
    parser_version: observation.parser_version || 'price-parser-v5',
    parser_evidence: {
      source_amount: positive(observation.amount_original),
      source_currency: observation.currency_original,
      proposed_price_usd: positive(converted.amount_usd),
      currency_evidence: observation.currency_evidence,
      parser_rule: observation.parser_rule,
      conversion_rate: Math.round(Number(converted.conversion_rate) * 1e6) / 1e6,
      conversion_timestamp: converted.conversion_timestamp || null,
      conversion_source: converted.conversion_source || null,
    },
  };
}

async function discover(input, fxSnapshot) {
  if (input?.read_only !== true || input?.transaction_read_only !== 'on') throw new Error('Read-only envelope missing');
  if (!Array.isArray(input.rows) || input.rows.length !== input.count) throw new Error('Discovery count mismatch');
  const ids = new Set();
  const rows = input.rows.map(row => {
    if (ids.has(row.listing_id)) throw new Error(`Duplicate listing ${row.listing_id}`);
    ids.add(row.listing_id);
    return classify(row, fxSnapshot);
  });
  const counts = { SAFE_EXPLICIT_USD: 0, SAFE_EXPLICIT_USDT: 0, SAFE_VERIFIED_FX: 0, REVIEW_REQUIRED: 0, UNRESOLVED: 0 };
  const reasons = {};
  const references = {};
  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] || 0) + 1;
    reasons[row.reason] = (reasons[row.reason] || 0) + 1;
    const bucket = references[row.normalized_reference] || { safe: 0, review_required: 0, unresolved: 0 };
    if (SAFE.has(row.classification)) bucket.safe += 1;
    else if (row.classification === 'UNRESOLVED') bucket.unresolved += 1;
    else bucket.review_required += 1;
    references[row.normalized_reference] = bucket;
  }
  const safeRows = rows.filter(row => SAFE.has(row.classification));
  return {
    contract: 'watchfacts-phase4b-rolex-wts-discovery-v1',
    read_only: true,
    production_writes: 0,
    generated_at: new Date().toISOString(),
    input: { rows: rows.length, private_cohort_sha256: input.private_cohort_sha256, production_generated_at: input.generated_at },
    fx_snapshot: fxSnapshot,
    counts,
    reasons,
    references,
    safe_rows: safeRows,
    safe_rows_sha256: sha256(JSON.stringify(safeRows)),
    review_samples: rows.filter(row => row.classification === 'REVIEW_REQUIRED').slice(0, 25)
      .map(({ listing_id, normalized_reference, reason }) => ({ listing_id, normalized_reference, reason })),
    raw_messages_exported: false,
    contact_values_exported: false,
  };
}

async function main() {
  if (!process.env.PHASE4B_PRIVATE_COHORT || !process.env.PHASE4B_DISCOVERY_OUTPUT) {
    throw new Error('PHASE4B_PRIVATE_COHORT and PHASE4B_DISCOVERY_OUTPUT are required');
  }
  const inputPath = path.resolve(process.env.PHASE4B_PRIVATE_COHORT);
  const outputPath = path.resolve(process.env.PHASE4B_DISCOVERY_OUTPUT);
  const bytes = fs.readFileSync(inputPath);
  const input = JSON.parse(bytes);
  input.private_cohort_sha256 = sha256(bytes);
  const report = await discover(input, await fetchFxSnapshot());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ counts: report.counts, reasons: report.reasons,
    references: report.references, safe_rows_sha256: report.safe_rows_sha256 }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { classify, discover };
