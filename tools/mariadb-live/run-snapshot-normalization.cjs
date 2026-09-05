// tools/mariadb-live/run-snapshot-normalization.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildListingDisplayContract } = require('./listing-display-contract.cjs');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Normalizes a cohort of staged MariaDB records into canonical ListingDisplayContracts.
 * Never modifies raw staging. Writes strictly local preview artifacts.
 */
function processNormalizationCohort(stagedRows, options = {}) {
  const startTime = Date.now();
  const runKey = options.runKey || 'norm-cohort-' + Date.now();
  const maxRows = options.maxRows || stagedRows.length;
  const targetRows = stagedRows.slice(0, maxRows);

  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;

  let tradingFloorEligibleCount = 0;
  let priceResearchEligibleCount = 0;

  let imageCount = 0;
  let sellerContactCount = 0;
  let explicitPriceCount = 0;
  let bundleCount = 0;

  const proposals = [];
  const reviewFlagsSummary = {};
  const exclusionSummary = {};
  const currencyStatusSummary = {};
  const readbackHashes = [];

  for (let i = 0; i < targetRows.length; i++) {
    const row = targetRows[i];
    try {
      const contract = buildListingDisplayContract(row, options);
      proposals.push(contract);

      readbackHashes.push({
        source_id: contract.source_id,
        source_hash: contract.source_hash,
        valid: Boolean(contract.source_hash && contract.source_hash.length === 64)
      });

      if (contract.image_key) imageCount++;
      if (contract.seller_contact) sellerContactCount++;
      if (contract.price_usd !== null && contract.price_usd > 0) explicitPriceCount++;
      if (contract.is_bundle) bundleCount++;

      if (contract.trading_floor_eligible) tradingFloorEligibleCount++;
      if (contract.price_research_eligible) priceResearchEligibleCount++;

      currencyStatusSummary[contract.currency_status] = (currencyStatusSummary[contract.currency_status] || 0) + 1;

      contract.review_flags.forEach(f => {
        reviewFlagsSummary[f] = (reviewFlagsSummary[f] || 0) + 1;
      });

      contract.exclusion_reasons.forEach(r => {
        exclusionSummary[r] = (exclusionSummary[r] || 0) + 1;
      });

      if (contract.trading_floor_eligible && !contract.review_flags.length) {
        normalizedProposals++;
      } else {
        reviewRequired++;
      }
    } catch (err) {
      normalizationErrors++;
      reviewFlagsSummary['NORMALIZATION_EXCEPTION: ' + err.message] = (reviewFlagsSummary['NORMALIZATION_EXCEPTION: ' + err.message] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedProposals + reviewRequired + normalizationErrors) === targetRows.length;

  const outputDir = path.resolve(options.outputDir || 'audit-output/mariadb-live/normalization-snapshot');
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Write proposals.jsonl
  const jsonlLines = proposals.map(p => JSON.stringify(p)).join('\n');
  fs.writeFileSync(path.join(outputDir, 'proposals.jsonl'), jsonlLines, 'utf-8');

  // 2. Write proposals.csv
  const csvHeaders = [
    'source_id', 'source_cursor', 'brand', 'model', 'reference', 'dial_color',
    'year', 'condition', 'intent', 'original_price_amount', 'original_price_currency',
    'price_usd', 'currency_status', 'seller_name', 'seller_contact', 'image_key',
    'trading_floor_eligible', 'price_research_eligible', 'is_bundle'
  ];
  const csvRows = [csvHeaders.join(',')];
  for (const p of proposals) {
    const vals = [
      JSON.stringify(p.source_id || ''),
      JSON.stringify(p.source_cursor || ''),
      JSON.stringify(p.brand || ''),
      JSON.stringify(p.model || ''),
      JSON.stringify(p.reference || ''),
      JSON.stringify(p.dial_color || ''),
      p.year !== null ? p.year : '',
      JSON.stringify(p.condition || ''),
      JSON.stringify(p.intent || ''),
      p.original_price_amount !== null ? p.original_price_amount : '',
      JSON.stringify(p.original_price_currency || ''),
      p.price_usd !== null ? p.price_usd : '',
      JSON.stringify(p.currency_status || ''),
      JSON.stringify(p.seller_name || ''),
      JSON.stringify(p.seller_contact || ''),
      JSON.stringify(p.image_key || ''),
      p.trading_floor_eligible ? 'true' : 'false',
      p.price_research_eligible ? 'true' : 'false',
      p.is_bundle ? 'true' : 'false'
    ];
    csvRows.push(vals.join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'proposals.csv'), csvRows.join('\n'), 'utf-8');

  // 3. Write summary report
  const summaryReport = {
    contract: 'wf-snapshot-normalization-v1',
    run_key: runKey,
    timestamp: new Date().toISOString(),
    parser_version: 'deterministic-normalizer-v4-canonical-display',
    frozen_cursor_boundary: options.frozenCursor || {
      created_on: '2026-04-28T15:50:43.000Z',
      source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
    },
    counts: {
      total_inputs: targetRows.length,
      normalized_proposals: normalizedProposals,
      review_required: reviewRequired,
      normalization_errors: normalizationErrors,
      exact_reconciliation: exactReconciliation
    },
    eligibility: {
      trading_floor_eligible_count: tradingFloorEligibleCount,
      trading_floor_eligible_pct: targetRows.length ? ((tradingFloorEligibleCount / targetRows.length) * 100).toFixed(2) + '%' : '0%',
      price_research_eligible_count: priceResearchEligibleCount,
      price_research_eligible_pct: targetRows.length ? ((priceResearchEligibleCount / targetRows.length) * 100).toFixed(2) + '%' : '0%'
    },
    coverage: {
      image_coverage_count: imageCount,
      image_coverage_pct: targetRows.length ? ((imageCount / targetRows.length) * 100).toFixed(2) + '%' : '0%',
      seller_contact_count: sellerContactCount,
      seller_contact_pct: targetRows.length ? ((sellerContactCount / targetRows.length) * 100).toFixed(2) + '%' : '0%',
      explicit_usd_price_count: explicitPriceCount,
      explicit_usd_price_pct: targetRows.length ? ((explicitPriceCount / targetRows.length) * 100).toFixed(2) + '%' : '0%',
      bundle_count: bundleCount,
      bundle_pct: targetRows.length ? ((bundleCount / targetRows.length) * 100).toFixed(2) + '%' : '0%'
    },
    performance: {
      duration_ms: durationMs,
      throughput_rows_per_sec: durationMs > 0 ? Math.round((targetRows.length / (durationMs / 1000)) * 100) / 100 : 0
    },
    review_flags_breakdown: reviewFlagsSummary,
    exclusion_reasons_breakdown: exclusionSummary,
    currency_status_breakdown: currencyStatusSummary,
    readback_hash_integrity: {
      total_checked: readbackHashes.length,
      all_valid: readbackHashes.every(h => h.valid)
    }
  };

  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summaryReport, null, 2), 'utf-8');

  return {
    summaryReport,
    proposals
  };
}

module.exports = {
  processNormalizationCohort
};
