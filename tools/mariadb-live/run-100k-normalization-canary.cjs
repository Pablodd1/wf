// tools/mariadb-live/run-100k-normalization-canary.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeAuthoritativeRow, sha256 } = require('./authoritative-evidence-normalizer.cjs');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const TARGET_ROW_COUNT = 100000;
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live/normalization-canary-100k');

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function redactSeller(name) {
  if (!name) return null;
  return '[REDACTED_SELLER_HANDLE:' + sha256(name) + ']';
}

function redactObjectKey(key) {
  if (!key) return null;
  return '[REDACTED_IMAGE_KEY:' + sha256(key) + ']';
}

async function run100kCanary(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[Canary-100k] Starting 100,000-row authoritative normalization canary...');
  console.log('[Canary-100k] Upper Cursor Boundary:', FROZEN_UPPER_CURSOR.created_on, '/', FROZEN_UPPER_CURSOR.source_id);

  const startTime = Date.now();
  let totalInputsProcessed = 0;
  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;

  let tradingFloorEligibleCount = 0;
  let priceResearchEligibleCount = 0;

  let resolvedFromDescCount = 0;
  let resolvedFromTitleCount = 0;
  let resolvedFromCommentsCount = 0;
  let missingSourceTextCount = 0;

  let explicitUsdPriceCount = 0;
  let explicitUsdtCount = 0;
  let explicitHkdCount = 0;
  let bareDollarHeldCount = 0;
  let unknownIntentCount = 0;
  let multiOfferBundleCount = 0;
  let imageKeysPresentCount = 0;

  const tradingFloorStatusBreakdown = {};
  const priceResearchStatusBreakdown = {};
  const currencyStatusBreakdown = {};
  const reviewFlagsBreakdown = {};
  const exclusionReasonsBreakdown = {};
  const textClustersMap = new Map();

  let lastCreatedOn = null;
  let lastSourceId = null;
  const seenIds = new Set();

  const BATCH_SIZE = 2000;
  const checkpoint = {
    job_name: 'canary-100k-mariadb-norm-' + Date.now(),
    frozen_cursor: FROZEN_UPPER_CURSOR,
    target_rows: TARGET_ROW_COUNT,
    status: 'IN_PROGRESS',
    started_at: new Date().toISOString()
  };

  while (totalInputsProcessed < TARGET_ROW_COUNT) {
    const fetchLimit = Math.min(BATCH_SIZE, TARGET_ROW_COUNT - totalInputsProcessed);
    const body = {
      p_limit: fetchLimit,
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

    if (!res.ok) throw new Error('RPC batch fetch failed (' + res.status + '): ' + (await res.text()));
    const batch = await res.json();
    if (!batch || !batch.length) {
      console.log('[Canary-100k] Reached end of available staged rows at ' + totalInputsProcessed.toLocaleString() + ' rows.');
      break;
    }

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];

      // Enforce frozen cursor boundary
      if (r.source_created_on > FROZEN_UPPER_CURSOR.created_on ||
         (r.source_created_on === FROZEN_UPPER_CURSOR.created_on && r.source_id > FROZEN_UPPER_CURSOR.source_id)) {
        continue;
      }

      // Enforce namespace
      if (r.source_system !== 'OceanDigital MariaDB' ||
          r.source_database !== 'thecollective_inventory' ||
          r.source_table !== 'auctions') {
        continue;
      }

      if (seenIds.has(r.source_id)) continue;
      seenIds.add(r.source_id);
      totalInputsProcessed++;

      try {
        const contract = normalizeAuthoritativeRow(r);

        if (contract.listing_text_source === 'description') resolvedFromDescCount++;
        else if (contract.listing_text_source === 'title') resolvedFromTitleCount++;
        else if (contract.listing_text_source === 'comments') resolvedFromCommentsCount++;
        else missingSourceTextCount++;

        // Track text cluster duplicate distribution
        if (contract.listing_text_sha256) {
          textClustersMap.set(contract.listing_text_sha256, (textClustersMap.get(contract.listing_text_sha256) || 0) + 1);
        }

        if (contract.image_key) imageKeysPresentCount++;
        if (contract.is_bundle) multiOfferBundleCount++;
        if (contract.intent === null) unknownIntentCount++;
        if (contract.currency_status === 'VERIFIED_EXPLICIT_USD') explicitUsdPriceCount++;
        if (contract.currency_status === 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX') explicitUsdtCount++;
        if (contract.currency_status === 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX') explicitHkdCount++;
        if (contract.currency_status === 'AMBIGUOUS_BARE_DOLLAR_HELD') bareDollarHeldCount++;

        if (contract.trading_floor_eligible) tradingFloorEligibleCount++;
        if (contract.price_research_eligible) priceResearchEligibleCount++;

        tradingFloorStatusBreakdown[contract.trading_floor_status] = (tradingFloorStatusBreakdown[contract.trading_floor_status] || 0) + 1;
        priceResearchStatusBreakdown[contract.price_research_status] = (priceResearchStatusBreakdown[contract.price_research_status] || 0) + 1;
        currencyStatusBreakdown[contract.currency_status] = (currencyStatusBreakdown[contract.currency_status] || 0) + 1;

        contract.review_flags.forEach(f => {
          reviewFlagsBreakdown[f] = (reviewFlagsBreakdown[f] || 0) + 1;
        });

        contract.exclusion_reasons.forEach(re => {
          exclusionReasonsBreakdown[re] = (exclusionReasonsBreakdown[re] || 0) + 1;
        });

        if (contract.reconciliation_category === 'NORMALIZED_PROPOSAL') {
          normalizedProposals++;
        } else {
          reviewRequired++;
        }
      } catch (err) {
        normalizationErrors++;
        reviewFlagsBreakdown['NORMALIZATION_EXCEPTION: ' + err.message] = (reviewFlagsBreakdown['NORMALIZATION_EXCEPTION: ' + err.message] || 0) + 1;
      }

      if (totalInputsProcessed === TARGET_ROW_COUNT) break;
    }

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (totalInputsProcessed % 20000 === 0 || totalInputsProcessed === TARGET_ROW_COUNT) {
      console.log('[Canary-100k] Processed ' + totalInputsProcessed.toLocaleString() + ' / ' + TARGET_ROW_COUNT.toLocaleString() + ' rows (' + Math.round((totalInputsProcessed / TARGET_ROW_COUNT) * 100) + '%)...');
    }
  }

  const durationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedProposals + reviewRequired + normalizationErrors) === totalInputsProcessed;

  checkpoint.status = 'COMPLETED_DIAGNOSTIC';
  checkpoint.completed_at = new Date().toISOString();
  checkpoint.last_processed_created_on = lastCreatedOn;
  checkpoint.last_processed_source_id = lastSourceId;
  checkpoint.total_inputs_processed = totalInputsProcessed;
  checkpoint.normalized_proposals_count = normalizedProposals;
  checkpoint.review_required_count = reviewRequired;
  checkpoint.normalization_errors_count = normalizationErrors;
  checkpoint.trading_floor_eligible_count = tradingFloorEligibleCount;
  checkpoint.price_research_eligible_count = priceResearchEligibleCount;

  // Text cluster breakdown
  let singletons = 0;
  let pairs = 0;
  let clusters3To5 = 0;
  let clusters6Plus = 0;
  for (const count of textClustersMap.values()) {
    if (count === 1) singletons++;
    else if (count === 2) pairs++;
    else if (count <= 5) clusters3To5++;
    else clusters6Plus++;
  }

  const clusterReport = {
    contract: 'wf-100k-text-clusters-v1',
    total_cohort_rows: totalInputsProcessed,
    distinct_listing_text_hashes: textClustersMap.size,
    distinct_listing_text_hash_pct: ((textClustersMap.size / totalInputsProcessed) * 100).toFixed(2) + '%',
    cluster_size_distribution: {
      singletons_unique: singletons,
      pair_reposts_2x: pairs,
      clusters_3_to_5x: clusters3To5,
      clusters_6x_plus: clusters6Plus
    },
    classification_policy: 'All duplicate text clusters classified as SOURCE_REPOST_CANDIDATE pending seller/reference/image lineage resolution'
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'duplicate-text-cluster-report.json'), JSON.stringify(clusterReport, null, 2), 'utf-8');

  const summary = {
    contract: 'wf-authoritative-100k-canary-summary-v1',
    job_name: checkpoint.job_name,
    timestamp: new Date().toISOString(),
    parser_version: 'authoritative-normalizer-v9-separated-status',
    frozen_upper_cursor: FROZEN_UPPER_CURSOR,
    checkpoint,
    counts: {
      total_inputs_processed: totalInputsProcessed,
      normalized_proposals: normalizedProposals,
      review_required: reviewRequired,
      normalization_errors: normalizationErrors,
      exact_reconciliation: exactReconciliation
    },
    source_text_precedence_census: {
      resolved_from_description_count: resolvedFromDescCount,
      resolved_from_description_pct: ((resolvedFromDescCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      resolved_from_title_count: resolvedFromTitleCount,
      resolved_from_title_pct: ((resolvedFromTitleCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      resolved_from_comments_count: resolvedFromCommentsCount,
      resolved_from_comments_pct: ((resolvedFromCommentsCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      total_source_text_coverage_count: (resolvedFromDescCount + resolvedFromTitleCount + resolvedFromCommentsCount),
      total_source_text_coverage_pct: (((resolvedFromDescCount + resolvedFromTitleCount + resolvedFromCommentsCount) / totalInputsProcessed) * 100).toFixed(2) + '%',
      missing_source_text_count: missingSourceTextCount,
      missing_source_text_pct: ((missingSourceTextCount / totalInputsProcessed) * 100).toFixed(2) + '%'
    },
    eligibility: {
      trading_floor_eligible_count: tradingFloorEligibleCount,
      trading_floor_eligible_pct: ((tradingFloorEligibleCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      price_research_eligible_count: priceResearchEligibleCount,
      price_research_eligible_pct: ((priceResearchEligibleCount / totalInputsProcessed) * 100).toFixed(2) + '%'
    },
    coverage: {
      source_image_keys_present_count: imageKeysPresentCount,
      source_image_keys_present_pct: ((imageKeysPresentCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      image_urls_published_count: 0,
      image_urls_published_pct: '0.00% (URLs held as null pending lineage proof)',
      seller_contact_exposed_count: 0,
      seller_contact_exposed_pct: '0.00% (Strictly private)',
      dealer_ratings_published_count: 0,
      dealer_ratings_published_pct: '0.00% (Held without explicit source review evidence)',
      explicit_usd_price_count: explicitUsdPriceCount,
      explicit_usd_price_pct: ((explicitUsdPriceCount / totalInputsProcessed) * 100).toFixed(2) + '%',
      explicit_usdt_held_for_fx_count: explicitUsdtCount,
      explicit_hkd_held_for_fx_count: explicitHkdCount,
      bare_dollar_held_count: bareDollarHeldCount,
      unknown_intent_held_count: unknownIntentCount,
      multi_offer_bundle_count: multiOfferBundleCount
    },
    status_distributions: {
      trading_floor_status: tradingFloorStatusBreakdown,
      price_research_status: priceResearchStatusBreakdown,
      currency_status: currencyStatusBreakdown
    },
    performance: {
      duration_ms: durationMs,
      throughput_rows_per_sec: durationMs > 0 ? Math.round((totalInputsProcessed / (durationMs / 1000)) * 100) / 100 : 0
    },
    review_flags_breakdown: reviewFlagsBreakdown,
    exclusion_reasons_breakdown: exclusionReasonsBreakdown
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const manifest = {
    contract: 'wf-authoritative-100k-canary-manifest-v1',
    timestamp: new Date().toISOString(),
    classification: 'CANARY_EVIDENCE_100K_CHECKPOINTED_READONLY',
    disclaimer: 'Committed artifacts contain aggregate summaries, cluster distributions, and status matrices. Zero raw seller text or media keys committed.',
    summary,
    artifact_checksums: {
      'summary.json': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'summary.json')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'summary.json')).size
      },
      'duplicate-text-cluster-report.json': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'duplicate-text-cluster-report.json')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'duplicate-text-cluster-report.json')).size
      }
    }
  };

  const manifestPath = path.join(OUTPUT_DIR, 'canary-100k-authoritative-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('============================================================');
  console.log('AUTHORITATIVE 100,000-ROW NORMALIZATION CANARY COMPLETE:');
  console.log('  Total Inputs Processed: ', totalInputsProcessed.toLocaleString());
  console.log('  Source Text Coverage:   ', summary.source_text_precedence_census.total_source_text_coverage_count.toLocaleString(), '(' + summary.source_text_precedence_census.total_source_text_coverage_pct + ')');
  console.log('  Normalized Proposals:   ', summary.counts.normalized_proposals.toLocaleString(), '(' + ((summary.counts.normalized_proposals / totalInputsProcessed) * 100).toFixed(2) + '%)');
  console.log('  Review Required:        ', summary.counts.review_required.toLocaleString(), '(' + ((summary.counts.review_required / totalInputsProcessed) * 100).toFixed(2) + '%)');
  console.log('  Normalization Errors:   ', summary.counts.normalization_errors);
  console.log('  Exact Reconciliation:   ', summary.counts.exact_reconciliation, '(' + totalInputsProcessed.toLocaleString() + ' = ' + normalizedProposals.toLocaleString() + ' + ' + reviewRequired.toLocaleString() + ' + ' + normalizationErrors + ')');
  console.log('  Trading Floor Eligible: ', summary.eligibility.trading_floor_eligible_count.toLocaleString(), '(' + summary.eligibility.trading_floor_eligible_pct + ')');
  console.log('  Price Research Eligible:', summary.eligibility.price_research_eligible_count.toLocaleString(), '(' + summary.eligibility.price_research_eligible_pct + ')');
  console.log('  Distinct Text Hashes:   ', textClustersMap.size.toLocaleString(), '(' + ((textClustersMap.size / totalInputsProcessed) * 100).toFixed(2) + '%)');
  console.log('  Throughput:             ', summary.performance.throughput_rows_per_sec.toLocaleString(), 'rows/sec');
  console.log('  Manifest Checksum:      ', sha256File(manifestPath));
  console.log('============================================================');

  return manifest;
}

if (require.main === module) {
  run100kCanary().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run100kCanary };
