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
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE = new Set(['SAFE_EXPLICIT_USD', 'SAFE_EXPLICIT_USDT', 'SAFE_VERIFIED_FX']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function refKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function classify(row, fxSnapshot) {
  const raw = String(row.raw_message || '');
  const reference = refKey(row.reference_normalized);
  const base = {
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    raw_message_version_id: row.raw_message_version_id,
    source_hash: row.source_hash,
    source_candidate_hash: row.source_candidate_hash || null,
    normalized_reference: row.reference_normalized,
    intent: row.intent,
    bundle_state: {
      parent_id: row.parent_id || null,
      is_bundle: row.is_bundle === true,
      bundle_status: row.bundle_status || null,
    },
    source_posted_at: row.source_posted_at_text || row.first_posted_at || null,
    seller_lineage: {
      seller_name_sha256: row.seller_name ? sha256(row.seller_name) : null,
      seller_location: row.seller_location || null,
      dealer_id: row.dealer_id || null,
      dealer_name: row.dealer_name || null,
      dealer_link_method: row.dealer_link_method || null,
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
    parser_version: 'price-parser-v5-shadow',
  };

  if (!raw || !reference || !refKey(raw).includes(reference)) {
    return { ...base, classification: 'UNRESOLVED', reason: 'REFERENCE_NOT_PROVEN_IN_IMMUTABLE_RAW' };
  }
  const segments = segmentDealerMessage(raw);
  if (row.is_bundle === true || row.parent_id || row.bundle_status !== 'SINGLE_CANDIDATE' || segments.length !== 1) {
    return { ...base, classification: 'REVIEW_BUNDLE', reason: 'MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT' };
  }

  const candidates = extractPriceCandidates(raw);
  if (candidates.some(item => item.review_reason === 'BUNDLE_PRICE_AMBIGUITY')) {
    return { ...base, classification: 'REVIEW_BUNDLE', reason: 'PARSER_BUNDLE_PRICE_AMBIGUITY' };
  }
  if (candidates.some(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY') || candidates.length > 1) {
    return { ...base, classification: 'REVIEW_MULTIPLE_PRICE', reason: 'MULTIPLE_PRICE_CANDIDATES' };
  }

  const observations = extractPriceObservations(raw);
  if (observations.length !== 1) {
    const reviewCurrency = candidates.some(item => item.evidence_status === 'REVIEW_REQUIRED'
      || !item.currency_original || item.currency_evidence === 'currency_unresolved');
    return {
      ...base,
      classification: reviewCurrency ? 'REVIEW_CURRENCY' : 'UNRESOLVED',
      reason: reviewCurrency ? 'CURRENCY_EVIDENCE_NOT_AUTO_APPROVED' : 'NO_EXACT_PRICE_OBSERVATION',
    };
  }

  const observation = observations[0];
  if (positive(row.price_original) !== positive(observation.amount_original)) {
    return {
      ...base,
      classification: 'REVIEW_MULTIPLE_PRICE',
      reason: 'STRUCTURED_ORIGINAL_PRICE_DIFFERS_FROM_EXACT_SOURCE_SPAN',
      parser_observation: {
        source_span: observation.raw_price_text,
        span_start: observation.index,
        span_end: observation.end,
        source_amount: observation.amount_original,
        source_currency: observation.currency_original,
        parser_rule: observation.parser_rule,
      },
    };
  }

  const converted = applyCurrencyPolicy(observation, fxSnapshot);
  const currency = String(converted.currency_original || '').toUpperCase();
  let classification = 'UNRESOLVED';
  if (currency === 'USD') classification = 'SAFE_EXPLICIT_USD';
  else if (currency === 'USDT') classification = 'SAFE_EXPLICIT_USDT';
  else if (positive(converted.amount_usd) && positive(converted.conversion_rate)
    && converted.conversion_timestamp && converted.conversion_source) classification = 'SAFE_VERIFIED_FX';
  else classification = 'REVIEW_CURRENCY';

  return {
    ...base,
    classification,
    reason: SAFE.has(classification) ? 'EXACT_SOURCE_SPAN_AND_IMMUTABLE_LINEAGE_MATCH' : 'DATED_FX_UNAVAILABLE',
    parser_observation: {
      source_span: observation.raw_price_text,
      span_start: observation.index,
      span_end: observation.end,
      source_amount: observation.amount_original,
      source_currency: observation.currency_original,
      proposed_price_usd: positive(converted.amount_usd),
      parser_rule: observation.parser_rule,
      parser_version: observation.parser_version,
      currency_evidence: observation.currency_evidence,
      fx_source: converted.conversion_source || null,
      fx_date: converted.conversion_timestamp || null,
      fx_rate: positive(converted.conversion_rate),
    },
  };
}

function validateInput(value) {
  if (value?.read_only !== true || value?.transaction_read_only !== 'on') throw new Error('read-only envelope missing');
  if (!Array.isArray(value.rows) || value.rows.length !== Number(value.count)) throw new Error('cohort count mismatch');
  const keys = new Set();
  for (const row of value.rows) {
    if (!REFERENCES.has(String(row.reference_normalized))) throw new Error(`out-of-scope reference ${row.reference_normalized}`);
    if (!row.listing_id || !row.source_record_id || !row.raw_message_version_id || !SHA256.test(row.source_hash)) {
      throw new Error(`incomplete immutable lineage for ${row.listing_id || 'unknown row'}`);
    }
    if (row.source_candidate_hash && !SHA256.test(row.source_candidate_hash)) throw new Error(`invalid candidate hash ${row.listing_id}`);
    const key = `${row.listing_id}|${row.source_record_id}|${row.raw_message_version_id}|${row.source_hash}`;
    if (keys.has(key)) throw new Error(`duplicate immutable cohort key ${row.listing_id}`);
    keys.add(key);
  }
}

async function main() {
  const inputPath = path.resolve(process.env.P3_RLX_PRIVATE_COHORT || '');
  const outputDir = path.resolve(process.env.P3_RLX_SHADOW_OUTPUT || 'audit-output/phase3-rolex-canary-shadow');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('P3_RLX_PRIVATE_COHORT is required');
  const inputBytes = fs.readFileSync(inputPath);
  const input = JSON.parse(inputBytes);
  validateInput(input);
  const fxSnapshot = await fetchFxSnapshot();
  const rows = input.rows.map(row => classify(row, fxSnapshot));
  const byReference = {};
  const byClassification = {};
  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    const bucket = byReference[row.normalized_reference] || { SAFE_NULL_ONLY: 0, REVIEW_REQUIRED: 0, UNRESOLVED: 0 };
    if (SAFE.has(row.classification)) bucket.SAFE_NULL_ONLY += 1;
    else if (row.classification === 'UNRESOLVED') bucket.UNRESOLVED += 1;
    else bucket.REVIEW_REQUIRED += 1;
    byReference[row.normalized_reference] = bucket;
  }
  const safeRows = rows.filter(row => SAFE.has(row.classification));
  const reviewRows = rows.filter(row => !SAFE.has(row.classification) && row.classification !== 'UNRESOLVED');
  const unresolvedRows = rows.filter(row => row.classification === 'UNRESOLVED');
  const report = {
    contract: 'watchfacts-phase3-rolex-five-reference-shadow-v1',
    read_only: true,
    production_writes: 0,
    generated_at: new Date().toISOString(),
    input: {
      rows: rows.length,
      private_cohort_sha256: sha256(inputBytes),
      production_generated_at: input.generated_at,
      expected_rows: 49,
      drift: rows.length - 49,
    },
    fx_snapshot: fxSnapshot,
    counts: {
      SAFE_NULL_ONLY: safeRows.length,
      REVIEW_REQUIRED: reviewRows.length,
      UNRESOLVED: unresolvedRows.length,
      by_classification: byClassification,
      by_reference: byReference,
    },
    rows,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'shadow-classification.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify({
    contract: report.contract,
    read_only: true,
    production_writes: 0,
    generated_at: report.generated_at,
    input: report.input,
    fx_snapshot: report.fx_snapshot,
    counts: report.counts,
    classification_sha256: sha256(JSON.stringify(rows)),
    raw_messages_exported: false,
    contact_values_exported: false,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report.counts, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { classify, validateInput };
