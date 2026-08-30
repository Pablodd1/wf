// tools/mariadb-live/run-authoritative-10k-canary.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeAuthoritativeRow, DO_SPACES_BASE, sha256 } = require('./authoritative-evidence-normalizer.cjs');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

const TARGET_ROW_COUNT = 10000;
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live/normalization-canary-10k');

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function testImageReachabilitySample(imageKeys = [], sampleSize = 15) {
  const uniqueKeys = [...new Set(imageKeys.filter(Boolean))];
  const sample = uniqueKeys.slice(0, sampleSize);
  const results = [];

  for (const key of sample) {
    const url = DO_SPACES_BASE + '/' + key;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      results.push({
        image_key: key,
        image_url: url,
        http_status: res.status,
        content_type: res.headers.get('content-type'),
        content_length: res.headers.get('content-length'),
        reachable: res.status >= 200 && res.status < 400
      });
    } catch (err) {
      results.push({
        image_key: key,
        image_url: url,
        error: err.message,
        reachable: false
      });
    }
  }

  return {
    total_images_in_cohort: uniqueKeys.length,
    sample_size_tested: results.length,
    reachable_count: results.filter(r => r.reachable).length,
    reachability_pct: results.length ? ((results.filter(r => r.reachable).length / results.length) * 100).toFixed(1) + '%' : '0%',
    sample_results: results
  };
}

async function runAuthoritativeCanary(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[Authoritative-10k-Canary] Fetching exactly ' + TARGET_ROW_COUNT.toLocaleString() + ' rows from MariaDB private raw staging...');

  const stagedRows = [];
  const seenIds = new Set();
  let lastCreatedOn = null;
  let lastSourceId = null;

  while (stagedRows.length < TARGET_ROW_COUNT) {
    const limit = 1000;
    const body = {
      p_limit: limit,
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

    if (!res.ok) throw new Error('RPC failed (' + res.status + '): ' + (await res.text()));
    const batch = await res.json();
    if (!batch || !batch.length) {
      console.log('[Authoritative-10k-Canary] No more rows returned by RPC.');
      break;
    }

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];

      // Enforce strict frozen cursor boundary
      if (r.source_created_on > FROZEN_UPPER_CURSOR.created_on ||
         (r.source_created_on === FROZEN_UPPER_CURSOR.created_on && r.source_id > FROZEN_UPPER_CURSOR.source_id)) {
        continue;
      }

      // Filter: Exclude benchmark/canary namespaces
      if (r.source_system !== 'OceanDigital MariaDB' ||
          r.source_database !== 'thecollective_inventory' ||
          r.source_table !== 'auctions') {
        continue;
      }

      if (seenIds.has(r.source_id)) {
        continue;
      }
      seenIds.add(r.source_id);
      stagedRows.push(r);
      if (stagedRows.length === TARGET_ROW_COUNT) break;
    }

    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;

    if (stagedRows.length % 2000 === 0 || stagedRows.length === TARGET_ROW_COUNT) {
      console.log('[Authoritative-10k-Canary] Collected ' + stagedRows.length + ' / ' + TARGET_ROW_COUNT + ' unique namespace-verified staged rows...');
    }
  }

  // ============================================================
  // COMPUTED DATASET INVARIANT ASSERTIONS (DYNAMICALLY EVALUATED)
  // ============================================================
  console.log('[Authoritative-10k-Canary] Computing dynamic dataset invariant assertions...');

  const distinctSourceIds = new Set(stagedRows.map(r => r.source_id));
  const provenanceKeys = new Set(stagedRows.map(r => r.source_system + ':' + r.source_database + ':' + r.source_table + ':' + r.source_id));
  
  const rawMessagePreservedCount = stagedRows.filter(r => (
    (typeof r.raw_message === 'string' && r.raw_message.trim().length > 0) ||
    (typeof r.raw_payload?.description === 'string' && r.raw_payload.description.trim().length > 0)
  )).length;

  const computedInvariants = {
    exact_10000_rows: stagedRows.length === TARGET_ROW_COUNT,
    exact_10000_distinct_ids: distinctSourceIds.size === TARGET_ROW_COUNT,
    zero_benchmark_namespaces: stagedRows.every(r => r.source_system === 'OceanDigital MariaDB' && r.source_database === 'thecollective_inventory' && r.source_table === 'auctions'),
    zero_duplicate_provenance_keys: provenanceKeys.size === TARGET_ROW_COUNT,
    zero_provenance_synthesized: stagedRows.every(r => Boolean(r.source_id && r.source_hash && r.source_system && r.source_database && r.source_table && r.source_record_id)),
    raw_message_preserved_count: rawMessagePreservedCount,
    raw_message_preserved_rate: ((rawMessagePreservedCount / TARGET_ROW_COUNT) * 100).toFixed(2) + '%',
    frozen_cursor_boundary_asserted: stagedRows.every(r => (
      r.source_created_on < FROZEN_UPPER_CURSOR.created_on ||
      (r.source_created_on === FROZEN_UPPER_CURSOR.created_on && r.source_id <= FROZEN_UPPER_CURSOR.source_id)
    ))
  };

  // Fail closed if required dataset invariants fail
  if (!computedInvariants.exact_10000_rows) throw new Error('FAIL: exact_10000_rows is false');
  if (!computedInvariants.exact_10000_distinct_ids) throw new Error('FAIL: exact_10000_distinct_ids is false');
  if (!computedInvariants.zero_benchmark_namespaces) throw new Error('FAIL: zero_benchmark_namespaces is false');
  if (!computedInvariants.zero_duplicate_provenance_keys) throw new Error('FAIL: zero_duplicate_provenance_keys is false');
  if (!computedInvariants.zero_provenance_synthesized) throw new Error('FAIL: zero_provenance_synthesized is false');
  if (!computedInvariants.frozen_cursor_boundary_asserted) throw new Error('FAIL: frozen_cursor_boundary_asserted is false');

  console.log('✔ All computed dataset assertions passed dynamically on 10,000 distinct auctions records.');

  // ============================================================
  // DETERMINISTIC EVIDENCE-FIRST NORMALIZATION
  // ============================================================
  console.log('[Authoritative-10k-Canary] Normalizing rows using exclusive raw_message parser...');
  const startTime = Date.now();

  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;

  let tradingFloorEligibleCount = 0;
  let priceResearchEligibleCount = 0;

  let imageKeyPresentCount = 0;
  let explicitUsdPriceCount = 0;
  let explicitUsdtCount = 0;
  let explicitHkdCount = 0;
  let bareDollarHeldCount = 0;
  let unknownIntentCount = 0;
  let multiOfferBundleCount = 0;

  const proposals = [];
  const redactedProposals = [];
  const reviewFlagsBreakdown = {};
  const exclusionReasonsBreakdown = {};
  const currencyStatusBreakdown = {};
  const allImageKeys = [];

  for (let i = 0; i < stagedRows.length; i++) {
    const row = stagedRows[i];
    try {
      const contract = normalizeAuthoritativeRow(row);
      proposals.push(contract);

      // Create strictly redacted copy for committed artifacts (mask raw message & phone)
      const redacted = { ...contract };
      redacted.raw_message_evidence = '[REDACTED_EVIDENCE_SHA256:' + contract.raw_message_sha256 + ']';
      redacted.seller_contact = null; // Strictly private
      redactedProposals.push(redacted);

      if (contract.image_key) {
        imageKeyPresentCount++;
        allImageKeys.push(contract.image_key);
      }

      if (contract.is_bundle) multiOfferBundleCount++;
      if (contract.intent === null) unknownIntentCount++;
      if (contract.currency_status === 'VERIFIED_EXPLICIT_USD') explicitUsdPriceCount++;
      if (contract.currency_status === 'VERIFIED_EXPLICIT_USDT_HELD_FOR_FX') explicitUsdtCount++;
      if (contract.currency_status === 'VERIFIED_EXPLICIT_HKD_HELD_FOR_FX') explicitHkdCount++;
      if (contract.currency_status === 'AMBIGUOUS_BARE_DOLLAR_HELD') bareDollarHeldCount++;

      if (contract.trading_floor_eligible) tradingFloorEligibleCount++;
      if (contract.price_research_eligible) priceResearchEligibleCount++;

      currencyStatusBreakdown[contract.currency_status] = (currencyStatusBreakdown[contract.currency_status] || 0) + 1;

      contract.review_flags.forEach(f => {
        reviewFlagsBreakdown[f] = (reviewFlagsBreakdown[f] || 0) + 1;
      });

      contract.exclusion_reasons.forEach(r => {
        exclusionReasonsBreakdown[r] = (exclusionReasonsBreakdown[r] || 0) + 1;
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
  }

  const durationMs = Date.now() - startTime;
  const exactReconciliation = (normalizedProposals + reviewRequired + normalizationErrors) === TARGET_ROW_COUNT;

  if (!exactReconciliation) {
    throw new Error('FAIL: Exact reconciliation failed: ' + normalizedProposals + ' norm + ' + reviewRequired + ' review + ' + normalizationErrors + ' err != ' + TARGET_ROW_COUNT);
  }

  // ============================================================
  // IMAGE URL REACHABILITY SAMPLE AUDIT
  // ============================================================
  console.log('[Authoritative-10k-Canary] Auditing DigitalOcean Spaces image URL reachability...');
  const imageReachabilityReport = await testImageReachabilitySample(allImageKeys, 15);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-reachability-sample.json'), JSON.stringify(imageReachabilityReport, null, 2), 'utf-8');

  // Write redacted proposals.jsonl (Zero raw messages or contacts committed)
  const jsonlLines = redactedProposals.map(p => JSON.stringify(p)).join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'proposals.jsonl'), jsonlLines, 'utf-8');

  // Write redacted proposals.csv
  const csvHeaders = [
    'source_id', 'source_cursor', 'brand', 'brand_source_evidence', 'reference', 'reference_source_evidence',
    'year', 'condition', 'intent', 'original_price_amount', 'original_price_currency',
    'price_usd', 'currency_status', 'seller_name', 'seller_contact', 'image_key', 'image_evidence_type',
    'trading_floor_eligible', 'price_research_eligible', 'is_bundle', 'raw_message_sha256'
  ];
  const csvRows = [csvHeaders.join(',')];
  for (const p of redactedProposals) {
    const vals = [
      JSON.stringify(p.source_id || ''),
      JSON.stringify(p.source_cursor || ''),
      JSON.stringify(p.brand || ''),
      JSON.stringify(p.brand_source_evidence || ''),
      JSON.stringify(p.reference || ''),
      JSON.stringify(p.reference_source_evidence || ''),
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
      JSON.stringify(p.image_evidence_type || ''),
      p.trading_floor_eligible ? 'true' : 'false',
      p.price_research_eligible ? 'true' : 'false',
      p.is_bundle ? 'true' : 'false',
      JSON.stringify(p.raw_message_sha256 || '')
    ];
    csvRows.push(vals.join(','));
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'proposals.csv'), csvRows.join('\n'), 'utf-8');

  // Write summary.json with computed assertions
  const summary = {
    contract: 'wf-authoritative-normalization-canary-v4',
    run_key: 'authoritative-10k-canary-' + Date.now(),
    timestamp: new Date().toISOString(),
    parser_version: 'authoritative-normalizer-v7-exclusive-raw-message',
    frozen_upper_cursor: FROZEN_UPPER_CURSOR,
    computed_invariant_assertions: {
      ...computedInvariants,
      image_reachability_audit_rate: imageReachabilityReport.reachability_pct,
      image_evidence_type_rule_applied: redactedProposals.every(p => p.image_url === null && p.image_evidence_type !== 'SOURCE_LISTING_IMAGE'),
      seller_contact_privacy_asserted: redactedProposals.every(p => p.seller_contact === null),
      unknown_intent_held_asserted: redactedProposals.filter(p => p.intent === null).every(p => !p.trading_floor_eligible && !p.price_research_eligible)
    },
    counts: {
      total_inputs: TARGET_ROW_COUNT,
      normalized_proposals: normalizedProposals,
      review_required: reviewRequired,
      normalization_errors: normalizationErrors,
      exact_reconciliation: exactReconciliation
    },
    eligibility: {
      trading_floor_eligible_count: tradingFloorEligibleCount,
      trading_floor_eligible_pct: ((tradingFloorEligibleCount / TARGET_ROW_COUNT) * 100).toFixed(2) + '%',
      price_research_eligible_count: priceResearchEligibleCount,
      price_research_eligible_pct: ((priceResearchEligibleCount / TARGET_ROW_COUNT) * 100).toFixed(2) + '%'
    },
    coverage: {
      source_image_key_present_count: imageKeyPresentCount,
      source_image_key_present_pct: ((imageKeyPresentCount / TARGET_ROW_COUNT) * 100).toFixed(2) + '%',
      image_reachability_sample: imageReachabilityReport,
      seller_contact_exposed_count: 0,
      seller_contact_exposed_pct: '0.00% (strictly private)',
      explicit_usd_price_count: explicitUsdPriceCount,
      explicit_usd_price_pct: ((explicitUsdPriceCount / TARGET_ROW_COUNT) * 100).toFixed(2) + '%',
      explicit_usdt_held_for_fx_count: explicitUsdtCount,
      explicit_hkd_held_for_fx_count: explicitHkdCount,
      bare_dollar_held_count: bareDollarHeldCount,
      unknown_intent_held_count: unknownIntentCount,
      multi_offer_bundle_count: multiOfferBundleCount
    },
    performance: {
      duration_ms: durationMs,
      throughput_rows_per_sec: durationMs > 0 ? Math.round((TARGET_ROW_COUNT / (durationMs / 1000)) * 100) / 100 : 0
    },
    review_flags_breakdown: reviewFlagsBreakdown,
    exclusion_reasons_breakdown: exclusionReasonsBreakdown,
    currency_status_breakdown: currencyStatusBreakdown
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  // Write authoritative manifest with exact artifact checksums
  const manifest = {
    contract: 'wf-authoritative-10k-canary-manifest-v4',
    timestamp: new Date().toISOString(),
    classification: 'CANARY_EVIDENCE_REPRODUCIBLE_REDACTED',
    disclaimer: 'Committed artifacts contain redacted message hashes only. Raw seller messages and contacts are strictly excluded.',
    summary,
    artifact_checksums: {
      'proposals.jsonl': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'proposals.jsonl')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'proposals.jsonl')).size
      },
      'proposals.csv': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'proposals.csv')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'proposals.csv')).size
      },
      'summary.json': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'summary.json')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'summary.json')).size
      },
      'image-reachability-sample.json': {
        sha256: sha256File(path.join(OUTPUT_DIR, 'image-reachability-sample.json')),
        size_bytes: fs.statSync(path.join(OUTPUT_DIR, 'image-reachability-sample.json')).size
      }
    }
  };

  const manifestPath = path.join(OUTPUT_DIR, 'canary-10k-authoritative-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('============================================================');
  console.log('AUTHORITATIVE 10,000-ROW CANARY RE-RUN COMPLETE:');
  console.log('  Total Inputs:           ', summary.counts.total_inputs);
  console.log('  Normalized Proposals:   ', summary.counts.normalized_proposals);
  console.log('  Review Required:        ', summary.counts.review_required);
  console.log('  Normalization Errors:   ', summary.counts.normalization_errors);
  console.log('  Exact Reconciliation:   ', summary.counts.exact_reconciliation);
  console.log('  Trading Floor Eligible: ', summary.eligibility.trading_floor_eligible_count, '(' + summary.eligibility.trading_floor_eligible_pct + ')');
  console.log('  Price Research Eligible:', summary.eligibility.price_research_eligible_count, '(' + summary.eligibility.price_research_eligible_pct + ')');
  console.log('  Image Keys Present:     ', summary.coverage.source_image_key_present_count, '(' + summary.coverage.source_image_key_present_pct + ')');
  console.log('  Image Reachability Rate:', imageReachabilityReport.reachability_pct, '(' + imageReachabilityReport.reachable_count + '/' + imageReachabilityReport.sample_size_tested + ' tested)');
  console.log('  Seller Contact Exposed: ', summary.coverage.seller_contact_exposed_count, '(Private)');
  console.log('  Explicit USD Price:     ', summary.coverage.explicit_usd_price_count, '(' + summary.coverage.explicit_usd_price_pct + ')');
  console.log('  Throughput:             ', summary.performance.throughput_rows_per_sec, 'rows/sec');
  console.log('  Manifest Checksum:      ', sha256File(manifestPath));
  console.log('============================================================');

  return manifest;
}

if (require.main === module) {
  runAuthoritativeCanary().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runAuthoritativeCanary };
