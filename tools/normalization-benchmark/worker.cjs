'use strict';

const { parentPort } = require('node:worker_threads');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { catalogStats, lookupCatalog } = require('../../api/_lib/catalog.js');
const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const { buildPromotionDecision } = require('../shadow-reprocess/promotion-policy.cjs');

const ACCEPTED_CURRENCY_EVIDENCE = new Set([
  'explicit_line_currency',
  'section_context',
  'message_context',
]);

// Force all file-backed catalog data and curation aliases into this worker's
// module cache before timed row processing begins. The synthetic miss also
// initializes the alias map without changing any source data.
const loadedCatalogStats = catalogStats();
lookupCatalog('__BENCHMARK_CATALOG_WARMUP__', '__BENCHMARK_CATALOG_WARMUP__');

function catalogStatus(confirmations) {
  if (!confirmations.length) return 'CATALOG_IDENTITY_INCOMPLETE';
  if (confirmations.every(item => item.confirmed && item.dialReason !== 'CATALOG_DIAL_CONFLICT')) {
    return 'CATALOG_CONFIRMED';
  }
  const reasons = confirmations.map(item => (
    item.dialReason === 'CATALOG_DIAL_CONFLICT' ? item.dialReason : item.reason
  ));
  for (const priority of [
    'CATALOG_BRAND_CONFLICT',
    'CATALOG_DIAL_CONFLICT',
    'CATALOG_PARTIAL_MATCH',
    'CATALOG_NOT_FOUND',
    'CATALOG_IDENTITY_INCOMPLETE',
  ]) {
    if (reasons.includes(priority)) return priority;
  }
  return reasons.find(Boolean) || 'CATALOG_UNVERIFIED';
}

function currencyStatus(shadowRow) {
  const flags = new Set(shadowRow.change_flags || []);
  if (flags.has('CURRENCY_AMBIGUOUS') || flags.has('EMOJI_PRICE_AMBIGUOUS')) {
    return 'CURRENCY_AMBIGUOUS';
  }
  const prices = (shadowRow.proposed_candidates || [])
    .flatMap(candidate => candidate.prices || [])
    .filter(price => price.is_primary || price.price_type === 'ASK_PRICE');
  if (!prices.length) return 'CURRENCY_MISSING';
  const evidence = prices.map(price => price.currency_evidence).filter(Boolean);
  if (evidence.some(value => ACCEPTED_CURRENCY_EVIDENCE.has(value))) {
    return 'CURRENCY_EXPLICIT';
  }
  if (evidence.some(value => value === 'source_record' || value === 'source_record_currency')) {
    return 'CURRENCY_SOURCE_ONLY';
  }
  return 'CURRENCY_UNVERIFIED';
}

function bundleStatus(shadowRow) {
  if (shadowRow.candidate_count === 0) return 'NO_CANDIDATE';
  if (shadowRow.candidate_count > 1) return 'BUNDLE_SPLIT_REQUIRED';
  return 'SINGLE_CANDIDATE';
}

function compactResult(sourceIndex, source, shadowRow) {
  const confirmations = (shadowRow.proposed_candidates || []).map(confirmCatalogCandidate);
  const singleConfirmation = shadowRow.candidate_count === 1 ? confirmations[0] : null;
  const decision = buildPromotionDecision(shadowRow, singleConfirmation);
  const proposed = shadowRow.candidate_count === 1 ? shadowRow.proposed_candidates[0] : null;

  return {
    source_index: sourceIndex,
    source_record_id: shadowRow.source_record_id,
    normalization_version: shadowRow.normalization_version,
    candidate_count: shadowRow.candidate_count,
    change_flags: shadowRow.change_flags || [],
    catalog_status: catalogStatus(confirmations),
    currency_status: currencyStatus(shadowRow),
    bundle_status: bundleStatus(shadowRow),
    review_disposition: decision.disposition,
    review_reasons: decision.reasons || [],
    source_brand: source.brand || null,
    source_reference: source.reference || null,
    source_price_raw: source.price_raw ?? null,
    source_currency: source.currency || null,
    source_listing_type: source.listing_type || null,
    source_dial_color: source.dial_color || null,
    proposed_brand: proposed?.brand || null,
    proposed_reference: proposed?.reference || null,
    proposed_price_raw: proposed?.price_raw ?? null,
    proposed_currency: proposed?.currency || null,
    proposed_listing_type: proposed?.listing_type || null,
    proposed_dial_color: proposed?.dial_color || null,
  };
}

parentPort.on('message', message => {
  if (message.type !== 'batch') return;
  const started = process.hrtime.bigint();
  const results = [];
  const errors = [];

  for (const item of message.rows) {
    try {
      const shadowRow = analyzeRecord(item.record);
      results.push(compactResult(item.sourceIndex, item.record, shadowRow));
    } catch (error) {
      errors.push({
        source_index: item.sourceIndex,
        source_record_id: item.record?.id || null,
        error_name: error.name || 'Error',
        error_message: error.message || String(error),
      });
    }
  }

  const elapsedNs = Number(process.hrtime.bigint() - started);
  parentPort.postMessage({
    type: 'batch-complete',
    batchId: message.batchId,
    results,
    errors,
    metrics: {
      input_rows: message.rows.length,
      elapsed_ns: elapsedNs,
      heap_used_bytes: process.memoryUsage().heapUsed,
    },
  });
});

parentPort.postMessage({
  type: 'ready',
  catalog_stats: loadedCatalogStats,
  heap_used_bytes: process.memoryUsage().heapUsed,
});
