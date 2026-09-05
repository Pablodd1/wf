// tools/mariadb-live/execute-10k-canary-gate.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { processNormalizationCohort } = require('./run-snapshot-normalization.cjs');

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function executeCanary(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials');

  console.log('[Canary-10k-v2] Fetching 10,000 staged rows from wf_canonical_staging.mariadb_raw_source_rows via RPC...');

  const stagedRows = [];
  let lastCreatedOn = null;
  let lastSourceId = null;

  while (stagedRows.length < 10000) {
    const limit = Math.min(1000, 10000 - stagedRows.length);
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

    if (!res.ok) throw new Error('RPC failed (' + res.status + '): ' + await res.text());
    const batch = await res.json();
    if (!batch || !batch.length) break;

    stagedRows.push(...batch);
    const last = batch[batch.length - 1];
    lastCreatedOn = last.source_created_on;
    lastSourceId = last.source_id;
    console.log('[Canary-10k-v2] Fetched ' + stagedRows.length + ' / 10,000 staged rows...');
  }

  console.log('[Canary-10k-v2] Successfully fetched ' + stagedRows.length + ' staged rows. Normalizing with authoritative display contract...');

  const outputDir = path.resolve('audit-output/mariadb-live/normalization-canary-10k');
  const result = processNormalizationCohort(stagedRows, {
    runKey: 'authoritative-normalization-canary-10k-' + Date.now(),
    outputDir,
    maxRows: 10000
  });

  // Calculate checksums for all produced canary artifacts
  const artifactFiles = [
    'proposals.jsonl',
    'proposals.csv',
    'summary.json'
  ];

  const checksums = {};
  for (const f of artifactFiles) {
    const fullPath = path.join(outputDir, f);
    if (fs.existsSync(fullPath)) {
      checksums[f] = {
        sha256: sha256File(fullPath),
        size_bytes: fs.statSync(fullPath).size
      };
    }
  }

  const canaryReport = {
    canary_version: 'wf-authoritative-10k-canary-v2',
    timestamp: new Date().toISOString(),
    invariants: {
      provenance_synthesized: false,
      intent_required_for_price_research: true,
      usdt_treated_as_usd_parity: false,
      image_domain: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings',
      seller_contact_private_by_default: true,
      source_observed_at_separated: true
    },
    counts: result.summaryReport.counts,
    eligibility: result.summaryReport.eligibility,
    coverage: result.summaryReport.coverage,
    performance: result.summaryReport.performance,
    review_flags_breakdown: result.summaryReport.review_flags_breakdown,
    exclusion_reasons_breakdown: result.summaryReport.exclusion_reasons_breakdown,
    currency_status_breakdown: result.summaryReport.currency_status_breakdown,
    artifact_checksums: checksums
  };

  fs.writeFileSync(path.join(outputDir, 'canary-10k-authoritative-manifest.json'), JSON.stringify(canaryReport, null, 2), 'utf-8');

  console.log('============================================================');
  console.log('AUTHORITATIVE 10,000-ROW CANARY RESULTS:');
  console.log('  Total Inputs:           ', canaryReport.counts.total_inputs);
  console.log('  Normalized Proposals:   ', canaryReport.counts.normalized_proposals);
  console.log('  Review Required:        ', canaryReport.counts.review_required);
  console.log('  Normalization Errors:   ', canaryReport.counts.normalization_errors);
  console.log('  Exact Reconciliation:   ', canaryReport.counts.exact_reconciliation);
  console.log('  Trading Floor Eligible: ', canaryReport.eligibility.trading_floor_eligible_count, '(' + canaryReport.eligibility.trading_floor_eligible_pct + ')');
  console.log('  Price Research Eligible:', canaryReport.eligibility.price_research_eligible_count, '(' + canaryReport.eligibility.price_research_eligible_pct + ')');
  console.log('  Image Coverage:         ', canaryReport.coverage.image_coverage_count, '(' + canaryReport.coverage.image_coverage_pct + ')');
  console.log('  Seller Contact Coverage:', canaryReport.coverage.seller_contact_count, '(' + canaryReport.coverage.seller_contact_pct + ') [kept private]');
  console.log('  Explicit USD Price:     ', canaryReport.coverage.explicit_usd_price_count, '(' + canaryReport.coverage.explicit_usd_price_pct + ') [excluding USDT]');
  console.log('  Throughput:             ', canaryReport.performance.throughput_rows_per_sec, 'rows/sec');
  console.log('  Manifest Checksum:      ', sha256File(path.join(outputDir, 'canary-10k-authoritative-manifest.json')));
  console.log('============================================================');

  return canaryReport;
}

if (require.main === module) {
  executeCanary().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { executeCanary };
