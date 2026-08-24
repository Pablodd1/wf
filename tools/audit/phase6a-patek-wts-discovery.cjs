#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extractPriceCandidates, extractPriceObservations, segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { applyCurrencyPolicy } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { fetchFxSnapshot } = require('../mariadb-live/fetch-fx-snapshot.cjs');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { classifyResearchEligibility, classifySaleEvidenceEligibility } = require('../../api/_lib/price-research-eligibility.cjs');

const SAFE = new Set(['SAFE_EXPLICIT_USD', 'SAFE_EXPLICIT_USDT', 'SAFE_VERIFIED_FX']);
const REVIEW = new Set(['REVIEW_CURRENCY', 'REVIEW_MULTIPLE_PRICE', 'REVIEW_BUNDLE']);
const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const catalogByExact = new Map(listCanonicalCatalogReferences('Patek Philippe').map(row => [String(row.reference).trim().toUpperCase(), row]));

function base(row, catalog) {
  return {
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    raw_message_version_id: row.raw_message_version_id,
    source_hash: row.source_hash,
    source_candidate_hash: row.source_candidate_hash,
    brand: 'Patek Philippe',
    model: catalog?.model || null,
    reference: row.reference_normalized,
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
  const catalog = catalogByExact.get(String(row.reference_normalized || '').trim().toUpperCase());
  const output = base(row, catalog);
  if (!catalog) return { ...output, classification: 'UNRESOLVED', reason: 'NOT_VALID_PUNCTUATION_SENSITIVE_EXACT_REFERENCE' };
  if (row.intent !== 'WTS' || positive(row.price_usd)) return { ...output, classification: 'UNRESOLVED', reason: 'OUT_OF_SCOPE_OR_TARGET_NOT_NULL' };
  if (!row.exact_raw_match || !row.source_record_id || !row.raw_message_version_id || !SHA256.test(row.source_hash || '') || !SHA256.test(row.source_candidate_hash || '')) {
    return { ...output, classification: 'UNRESOLVED', reason: 'INCOMPLETE_IMMUTABLE_LINEAGE' };
  }

  const raw = String(row.raw_message || '');
  if (!raw || !refKey(raw).includes(refKey(catalog.reference))) {
    return { ...output, classification: 'UNRESOLVED', reason: 'EXACT_REFERENCE_NOT_PROVEN_IN_IMMUTABLE_RAW' };
  }
  const segments = segmentDealerMessage(raw);
  if (row.parent_id || row.is_bundle === true || row.bundle_status !== 'SINGLE_CANDIDATE' || segments.length !== 1) {
    return { ...output, classification: 'REVIEW_BUNDLE', reason: 'MULTIPLE_OR_BUNDLE_SOURCE_CONTEXT' };
  }

  const candidates = extractPriceCandidates(raw);
  if (candidates.some(item => item.review_reason === 'BUNDLE_PRICE_AMBIGUITY')) {
    return { ...output, classification: 'REVIEW_BUNDLE', reason: 'PARSER_BUNDLE_PRICE_AMBIGUITY' };
  }
  if (candidates.some(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY') || candidates.length > 1) {
    return { ...output, classification: 'REVIEW_MULTIPLE_PRICE', reason: 'MULTIPLE_PRICE_CANDIDATES' };
  }

  const observations = extractPriceObservations(raw);
  if (observations.length !== 1 || observations[0].evidence_status !== 'AUTO_APPROVED') {
    const needsReview = candidates.some(item => item.evidence_status === 'REVIEW_REQUIRED' || item.review_reason);
    return {
      ...output,
      classification: needsReview ? 'REVIEW_CURRENCY' : 'UNRESOLVED',
      reason: needsReview ? 'PRICE_OR_CURRENCY_REQUIRES_REVIEW' : 'NO_EXACT_AUTO_APPROVED_PRICE',
    };
  }

  const observation = observations[0];
  if (positive(row.price_original) && positive(row.price_original) !== positive(observation.amount_original)) {
    return { ...output, classification: 'REVIEW_CURRENCY', reason: 'EXISTING_ORIGINAL_PRICE_CONFLICT' };
  }
  if (row.currency_original && String(row.currency_original).toUpperCase() !== String(observation.currency_original).toUpperCase()) {
    return { ...output, classification: 'REVIEW_CURRENCY', reason: 'EXISTING_ORIGINAL_CURRENCY_CONFLICT' };
  }

  const converted = applyCurrencyPolicy(observation, fxSnapshot);
  const currency = String(converted.currency_original || '').toUpperCase();
  let classification;
  if (currency === 'USD') classification = 'SAFE_EXPLICIT_USD';
  else if (currency === 'USDT') classification = 'SAFE_EXPLICIT_USDT';
  else if (positive(converted.amount_usd) && positive(converted.conversion_rate) && converted.conversion_timestamp && converted.conversion_source) {
    classification = 'SAFE_VERIFIED_FX';
  } else {
    return { ...output, classification: 'REVIEW_CURRENCY', reason: currency === 'HKD' && positive(observation.amount_original) <= 3 ? 'IMPLAUSIBLE_HKD_1_TO_3' : 'DATED_FX_UNAVAILABLE' };
  }

  const parserEvidence = {
    source_amount: positive(observation.amount_original),
    source_currency: observation.currency_original,
    proposed_price_usd: positive(converted.amount_usd),
    currency_evidence: observation.currency_evidence,
    parser_rule: observation.parser_rule,
    parser_version: observation.parser_version || 'price-parser-v5',
    conversion_rate: positive(converted.conversion_rate),
    conversion_timestamp: converted.conversion_timestamp || null,
    conversion_source: converted.conversion_source || null,
  };
  const eligibilityRow = {
    brand: 'Patek Philippe', model: catalog.model, reference: catalog.reference,
    dial_color: row.dial_color_normalized, condition: row.condition_normalized,
    listing_type: 'WTS', verdict: row.verdict,
    listing_status: row.trading_floor_status, trading_floor_status: row.trading_floor_status,
    normalization_status: row.normalization_status, price_usd: parserEvidence.proposed_price_usd,
    analytics_currency_status: 'VERIFIED', source_currency: parserEvidence.source_currency,
    analytics_fx_rate: parserEvidence.conversion_rate, analytics_fx_date: parserEvidence.conversion_timestamp,
    analytics_fx_source: parserEvidence.conversion_source, raw_message: raw,
  };
  const saleReason = classifySaleEvidenceEligibility(eligibilityRow);
  const researchReason = saleReason || classifyResearchEligibility(eligibilityRow, catalog);
  return {
    ...output,
    classification,
    reason: 'EXACT_AUTO_APPROVED_SOURCE_PRICE_AND_IMMUTABLE_LINEAGE',
    parser_evidence: parserEvidence,
    expected_pr_eligibility: researchReason ? 'SAFE_PRICE_NOT_PR_QUALIFIED' : 'EXPECTED_PR_QUALIFIED',
    pr_exclusion_reason: researchReason || null,
  };
}

function selectCohort(safeRows, cap = 25) {
  const ordered = [
    ...safeRows.filter(row => row.expected_pr_eligibility === 'EXPECTED_PR_QUALIFIED'),
    ...safeRows.filter(row => row.expected_pr_eligibility !== 'EXPECTED_PR_QUALIFIED'),
  ];
  const groups = new Map();
  for (const row of ordered) {
    if (!groups.has(row.reference)) groups.set(row.reference, []);
    groups.get(row.reference).push(row);
  }
  const selected = [];
  while (selected.length < cap && [...groups.values()].some(rows => rows.length)) {
    for (const rows of groups.values()) {
      if (selected.length >= cap) break;
      if (rows.length) selected.push(rows.shift());
    }
  }
  return selected;
}

async function main() {
  const inputPath = path.resolve(process.env.PHASE6A_PRIVATE_COHORT || '');
  const outputPath = path.resolve(process.env.PHASE6A_DISCOVERY_OUTPUT || '');
  if (!process.env.PHASE6A_PRIVATE_COHORT || !process.env.PHASE6A_DISCOVERY_OUTPUT) {
    throw new Error('PHASE6A_PRIVATE_COHORT and PHASE6A_DISCOVERY_OUTPUT are required');
  }
  const bytes = fs.readFileSync(inputPath);
  const input = JSON.parse(bytes);
  if (input.read_only !== true || input.transaction_read_only !== 'on' || !Array.isArray(input.rows) || input.rows.length !== input.count) {
    throw new Error('Invalid read-only Patek discovery envelope');
  }
  const fxSnapshot = await fetchFxSnapshot();
  const ids = new Set();
  const rows = input.rows.map(row => {
    if (ids.has(row.listing_id)) throw new Error(`Duplicate listing ${row.listing_id}`);
    ids.add(row.listing_id);
    return classify(row, fxSnapshot);
  });
  const counts = { SAFE_EXPLICIT_USD: 0, SAFE_EXPLICIT_USDT: 0, SAFE_VERIFIED_FX: 0, REVIEW_CURRENCY: 0, REVIEW_MULTIPLE_PRICE: 0, REVIEW_BUNDLE: 0, UNRESOLVED: 0 };
  const reasons = {};
  const references = {};
  for (const row of rows) {
    counts[row.classification] = (counts[row.classification] || 0) + 1;
    reasons[row.reason] = (reasons[row.reason] || 0) + 1;
    references[row.reference] ||= { screened: 0, safe: 0, review: 0, unresolved: 0, expected_pr_qualified: 0, reasons: {} };
    const bucket = references[row.reference];
    bucket.screened += 1;
    bucket.reasons[row.reason] = (bucket.reasons[row.reason] || 0) + 1;
    if (SAFE.has(row.classification)) {
      bucket.safe += 1;
      if (row.expected_pr_eligibility === 'EXPECTED_PR_QUALIFIED') bucket.expected_pr_qualified += 1;
    } else if (REVIEW.has(row.classification)) bucket.review += 1;
    else bucket.unresolved += 1;
  }
  const safeRows = rows.filter(row => SAFE.has(row.classification));
  const selected = selectCohort(safeRows, 25);
  const parserQuality = input.rows.reduce((out, row) => {
    const candidates = extractPriceCandidates(String(row.raw_message || ''));
    const observations = extractPriceObservations(String(row.raw_message || ''));
    if (candidates.length > 0) out.rows_with_price_candidate += 1;
    if (candidates.some(candidate => candidate.currency_original && candidate.currency_evidence === 'explicit_line_currency')) out.rows_with_explicit_currency += 1;
    if (observations.length === 1 && observations[0].evidence_status === 'AUTO_APPROVED') out.parser_auto_approved_rows += 1;
    return out;
  }, { rows_with_price_candidate: 0, rows_with_explicit_currency: 0, parser_auto_approved_rows: 0 });
  parserQuality.contract_auto_approved_rows = safeRows.length
    + Number(reasons.DATED_FX_UNAVAILABLE || 0)
    + Number(reasons.IMPLAUSIBLE_HKD_1_TO_3 || 0);
  parserQuality.multiple_price_rows = Number(counts.REVIEW_MULTIPLE_PRICE || 0);
  parserQuality.bundle_rows = Number(counts.REVIEW_BUNDLE || 0);
  parserQuality.fx_blocked_rows = Number(reasons.DATED_FX_UNAVAILABLE || 0) + Number(reasons.IMPLAUSIBLE_HKD_1_TO_3 || 0);
  const report = {
    contract: 'watchfacts-phase6a-patek-wts-discovery-v1',
    read_only: true,
    production_writes: 0,
    generated_at: new Date().toISOString(),
    input: { rows: rows.length, private_cohort_sha256: sha256(bytes), production_generated_at: input.generated_at },
    fx_snapshot: fxSnapshot,
    counts,
    summary: {
      safe: safeRows.length,
      review: rows.filter(row => REVIEW.has(row.classification)).length,
      unresolved: rows.filter(row => row.classification === 'UNRESOLVED').length,
    },
    reasons,
    references,
    parser_quality: parserQuality,
    eligibility: {
      EXPECTED_PR_QUALIFIED: safeRows.filter(row => row.expected_pr_eligibility === 'EXPECTED_PR_QUALIFIED').length,
      SAFE_PRICE_NOT_PR_QUALIFIED: safeRows.filter(row => row.expected_pr_eligibility !== 'EXPECTED_PR_QUALIFIED').length,
    },
    safe_by_currency: safeRows.reduce((out, row) => {
      const currency = row.parser_evidence.source_currency;
      out[currency] = (out[currency] || 0) + 1;
      return out;
    }, {}),
    selected_rows: selected,
    selected_rows_sha256: sha256(JSON.stringify(selected)),
    safe_rows_sha256: sha256(JSON.stringify(safeRows)),
    review_samples: rows.filter(row => REVIEW.has(row.classification)).slice(0, 25).map(row => ({ listing_id: row.listing_id, reference: row.reference, classification: row.classification, reason: row.reason })),
    unresolved_samples: rows.filter(row => row.classification === 'UNRESOLVED').slice(0, 25).map(row => ({ listing_id: row.listing_id, reference: row.reference, reason: row.reason })),
    raw_messages_exported: false,
    contact_values_exported: false,
    evidence_standard_relaxed: false,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ counts, summary: report.summary, reasons, references, eligibility: report.eligibility, safe_by_currency: report.safe_by_currency, selected_rows: selected.length, selected_rows_sha256: report.selected_rows_sha256 }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { classify, selectCohort };
