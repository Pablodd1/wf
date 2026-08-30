// tools/mariadb-live/run-full-frozen-snapshot-normalization.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildListingDisplayContract } = require('./listing-display-contract.cjs');

const FROZEN_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const BATCH_SIZE = 5000;
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live/normalization-snapshot');

async function runFullSnapshotNormalization(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const proposalsStream = fs.createWriteStream(path.join(OUTPUT_DIR, 'proposals.jsonl'), { flags: 'w', encoding: 'utf-8' });

  console.log('[Snapshot-Norm] Initializing full frozen snapshot normalization (Target: 951,743 distinct records)...');
  const startTime = Date.now();

  let totalProcessed = 0;
  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;

  let tradingFloorEligibleCount = 0;
  let priceResearchEligibleCount = 0;

  let imageCount = 0;
  let sellerContactCount = 0;
  let explicitPriceCount = 0;
  let bundleCount = 0;

  const reviewFlagsSummary = {};
  const exclusionSummary = {};
  const currencyStatusSummary = {};

  let lastCreatedOn = null;
  let lastSourceId = null;
  let hasMore = true;
  let batchIndex = 0;

  while (hasMore) {
    batchIndex++;
    const fetchStart = Date.now();

    const body = {
      p_limit: BATCH_SIZE,
      p_last_created_on: lastCreatedOn,
      p_last_source_id: lastSourceId
    };

    const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/get_mariadb_private_staged_rows_batch';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: 'Bearer ' + supabaseKey
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error('Batch fetch failed (' + res.status + '): ' + await res.text());
    }

    const batch = await res.json();
    if (!batch || batch.length === 0) {
      hasMore = false;
      break;
    }

    const fetchLatency = Date.now() - fetchStart;
    if (fetchLatency > 15000) {
      console.warn('[Latency-Warning] Batch fetch took ' + fetchLatency + 'ms (threshold: 15s)');
    }

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];

      // Check frozen boundary: do not process records after frozen cursor
      if (row.source_created_on > FROZEN_CURSOR.created_on || 
         (row.source_created_on === FROZEN_CURSOR.created_on && row.source_id > FROZEN_CURSOR.source_id)) {
        hasMore = false;
        break;
      }

      totalProcessed++;

      try {
        const contract = buildListingDisplayContract(row);
        proposalsStream.write(JSON.stringify(contract) + '\n');

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

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (totalProcessed % 50000 === 0 || !hasMore) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = Math.round(totalProcessed / ((Date.now() - startTime) / 1000));
      console.log('[Snapshot-Norm] Processed ' + totalProcessed.toLocaleString() + ' rows in ' + elapsedSec + 's (' + rate.toLocaleString() + ' rows/sec)...');
    }
  }

  proposalsStream.end();

  const totalDurationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedProposals + reviewRequired + normalizationErrors) === totalProcessed;

  const finalSummary = {
    contract: 'wf-snapshot-normalization-v1',
    run_key: 'snapshot-norm-full-' + Date.now(),
    timestamp: new Date().toISOString(),
    parser_version: 'deterministic-normalizer-v4-canonical-display',
    frozen_cursor_boundary: FROZEN_CURSOR,
    counts: {
      total_inputs: totalProcessed,
      normalized_proposals: normalizedProposals,
      review_required: reviewRequired,
      normalization_errors: normalizationErrors,
      exact_reconciliation: exactReconciliation
    },
    eligibility: {
      trading_floor_eligible_count: tradingFloorEligibleCount,
      trading_floor_eligible_pct: totalProcessed ? ((tradingFloorEligibleCount / totalProcessed) * 100).toFixed(2) + '%' : '0%',
      price_research_eligible_count: priceResearchEligibleCount,
      price_research_eligible_pct: totalProcessed ? ((priceResearchEligibleCount / totalProcessed) * 100).toFixed(2) + '%' : '0%'
    },
    coverage: {
      image_coverage_count: imageCount,
      image_coverage_pct: totalProcessed ? ((imageCount / totalProcessed) * 100).toFixed(2) + '%' : '0%',
      seller_contact_count: sellerContactCount,
      seller_contact_pct: totalProcessed ? ((sellerContactCount / totalProcessed) * 100).toFixed(2) + '%' : '0%',
      explicit_usd_price_count: explicitPriceCount,
      explicit_usd_price_pct: totalProcessed ? ((explicitPriceCount / totalProcessed) * 100).toFixed(2) + '%' : '0%',
      bundle_count: bundleCount,
      bundle_pct: totalProcessed ? ((bundleCount / totalProcessed) * 100).toFixed(2) + '%' : '0%'
    },
    performance: {
      duration_ms: totalDurationMs,
      duration_seconds: Math.round(totalDurationMs / 1000),
      throughput_rows_per_sec: totalDurationMs > 0 ? Math.round((totalProcessed / (totalDurationMs / 1000)) * 100) / 100 : 0
    },
    review_flags_breakdown: reviewFlagsSummary,
    exclusion_reasons_breakdown: exclusionSummary,
    currency_status_breakdown: currencyStatusSummary
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(finalSummary, null, 2), 'utf-8');

  console.log('============================================================');
  console.log('FULL FROZEN SNAPSHOT NORMALIZATION COMPLETE:');
  console.log('  Total Records Processed:', totalProcessed.toLocaleString());
  console.log('  Normalized Proposals:   ', normalizedProposals.toLocaleString());
  console.log('  Review Required:        ', reviewRequired.toLocaleString());
  console.log('  Normalization Errors:   ', normalizationErrors);
  console.log('  Exact Reconciliation:   ', exactReconciliation);
  console.log('  Trading Floor Eligible: ', tradingFloorEligibleCount.toLocaleString(), '(' + finalSummary.eligibility.trading_floor_eligible_pct + ')');
  console.log('  Price Research Eligible:', priceResearchEligibleCount.toLocaleString(), '(' + finalSummary.eligibility.price_research_eligible_pct + ')');
  console.log('  Duration:               ', finalSummary.performance.duration_seconds, 'seconds');
  console.log('  Throughput:             ', finalSummary.performance.throughput_rows_per_sec, 'rows/sec');
  console.log('============================================================');

  return finalSummary;
}

if (require.main === module) {
  runFullSnapshotNormalization().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runFullSnapshotNormalization };
