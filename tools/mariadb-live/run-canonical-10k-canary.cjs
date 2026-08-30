// tools/mariadb-live/run-canonical-10k-canary.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  normalizeCanonicalParentChild,
  computeParentHash,
  computeChildProposalHash,
  buildAuthorizedInquiryContract,
  sha256
} = require('./authoritative-evidence-normalizer.cjs');

const CONTRACT = 'wf-canonical-10k-canary-v1';
const CANARY_ROW_COUNT = 10000;
const BATCH_SIZE = 500;
const DO_SPACES_BUCKET_BASE = 'https://thecollective.fra1.digitaloceanspaces.com';
const OUTPUT_DIR = path.resolve('audit-output/mariadb-live/canonical-canary-10k');

const FROZEN_UPPER_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};

async function callRpc(supabaseUrl, supabaseKey, rpcName, body) {
  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + rpcName;
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
    const txt = await res.text();
    throw new Error('RPC ' + rpcName + ' failed (' + res.status + '): ' + txt);
  }
  return await res.json();
}

async function fetchTableCountAndMaxDate(supabaseUrl, supabaseKey, tableName, dateField, fetchFn = fetch) {
  if (!supabaseUrl || !supabaseKey || !tableName) {
    throw new Error('fetchTableCountAndMaxDate: supabaseUrl, supabaseKey, and tableName are required');
  }
  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + tableName + (dateField ? '?select=' + dateField + '&order=' + dateField + '.desc&limit=1' : '?select=*&limit=1');
  const res = await fetchFn(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      Prefer: 'count=exact'
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`fetchTableCountAndMaxDate failed with HTTP ${res.status} for table ${tableName}: ${txt}`);
  }
  const contentRange = res.headers.get('content-range');
  const contentRangeMatch = typeof contentRange === 'string'
    ? contentRange.match(/^(?:\d+-\d+|\*)\/(\d+)$/)
    : null;
  if (!contentRangeMatch) {
    throw new Error(`fetchTableCountAndMaxDate: Missing or invalid Content-Range header for table ${tableName}: "${contentRange}"`);
  }
  const countPart = contentRangeMatch[1];
  const totalCount = Number(countPart);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new Error(`fetchTableCountAndMaxDate: Invalid parsed total count "${countPart}" for table ${tableName}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error(`fetchTableCountAndMaxDate: Expected JSON array for table ${tableName}, got ${typeof rows}`);
  }

  let latestDate = null;
  if (rows.length > 0 && dateField) {
    if (typeof rows[0] !== 'object' || rows[0] === null || !(dateField in rows[0])) {
      throw new Error(`fetchTableCountAndMaxDate: Missing date field "${dateField}" in response row for table ${tableName}`);
    }
    latestDate = rows[0][dateField];
    if (
      typeof latestDate !== 'string' ||
      latestDate.trim() === '' ||
      !Number.isFinite(Date.parse(latestDate))
    ) {
      throw new Error(`fetchTableCountAndMaxDate: Invalid date value for "${dateField}" in table ${tableName}`);
    }
  }
  return { totalCount, latestDate };
}

async function sampleCheckImageReachability(imageKeys, sampleSize = 100) {
  const sample = imageKeys.slice(0, sampleSize);
  const results = {
    total_sampled: sample.length,
    reachable: 0,
    unreachable: 0,
    details: []
  };

  for (const imgKey of sample) {
    const url = `${DO_SPACES_BUCKET_BASE}/${imgKey.replace(/^\/+/, '')}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const isReachable = res.ok;
      if (isReachable) results.reachable++;
      else results.unreachable++;
      results.details.push({
        image_key: imgKey,
        status: res.status,
        reachable: isReachable
      });
    } catch (err) {
      results.unreachable++;
      results.details.push({
        image_key: imgKey,
        status: 'NETWORK_ERROR',
        reachable: false,
        error: err.message
      });
    }
  }

  return results;
}

async function runCanonical10kCanary(env = process.env) {
  console.log('============================================================');
  console.log(`CANONICAL PARENT-CHILD NORMALIZATION CANARY (${CANARY_ROW_COUNT} ROWS)`);
  console.log('============================================================');

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials missing from environment');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Measure Pre-Canary Public View Baselines & Raw Checkpoint
  console.log('1. Measuring Pre-Canary Public View Baselines & Raw Checkpoint...');
  const publicMetricsBefore = await callRpc(supabaseUrl, supabaseKey, 'get_public_table_audit_counts', {});

  console.log('  [PRE] public.raw_messages:           count = ' + publicMetricsBefore.raw_messages.count);
  console.log('  [PRE] public.watch_records:          count = ' + publicMetricsBefore.watch_records.count);
  console.log('  [PRE] trading_floor_ready_view:     count = ' + publicMetricsBefore.trading_floor_ready_view.count);
  console.log('  [PRE] price_research_ready_view:    count = ' + publicMetricsBefore.price_research_ready_view.count);

  const rawCpBefore = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', {
    p_run_key: 'full-capture-auctions-1788028958313'
  });
  if (!rawCpBefore) throw new Error('Failed to fetch raw checkpoint full-capture-auctions-1788028958313');
  console.log(`  [PRE] Raw Checkpoint: inputs=${rawCpBefore.input_rows}, staged=${rawCpBefore.staged_rows}, errors=${rawCpBefore.capture_errors_count || rawCpBefore.capture_error_rows}`);
  if (Number(rawCpBefore.input_rows) !== 951750 || Number(rawCpBefore.capture_errors_count || rawCpBefore.capture_error_rows) !== 7) {
    throw new Error(`Raw checkpoint invariant violated before canary!`);
  }

  // 2. Fetch Keyset Batch of 10,000 staged rows
  console.log(`\n2. Fetching ${CANARY_ROW_COUNT} Staged Rows via Keyset Pagination...`);
  const stagedRows = [];
  let lastCreatedOn = null;
  let lastSourceId = null;
  const seenIds = new Set();

  while (stagedRows.length < CANARY_ROW_COUNT) {
    const remaining = CANARY_ROW_COUNT - stagedRows.length;
    const fetchLimit = Math.min(BATCH_SIZE, remaining);

    const batch = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_private_staged_auctions_batch', {
      p_limit: fetchLimit,
      p_last_created_on: lastCreatedOn,
      p_last_source_id: lastSourceId
    });

    if (!batch || !batch.length) {
      console.log('No more staged rows available.');
      break;
    }

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      if (r.source_created_on > FROZEN_UPPER_CURSOR.created_on ||
         (r.source_created_on === FROZEN_UPPER_CURSOR.created_on && r.source_id > FROZEN_UPPER_CURSOR.source_id)) {
        continue;
      }
      if (seenIds.has(r.source_id)) continue;
      seenIds.add(r.source_id);
      stagedRows.push(r);
    }

    const lastRow = batch[batch.length - 1];
    lastCreatedOn = lastRow.source_created_on;
    lastSourceId = lastRow.source_id;
  }

  console.log(`Fetched exact ${stagedRows.length} staged rows for 10K canary cohort.`);
  if (stagedRows.length !== CANARY_ROW_COUNT) {
    throw new Error(`Failed to fetch exact ${CANARY_ROW_COUNT} rows, got ${stagedRows.length}`);
  }

  // 3. Normalize Cohort into Canonical Parents, Children, and Images
  console.log('\n3. Normalizing Cohort into Canonical Parents, Children, and Images...');
  const normalizedParents = [];
  const currencyDistribution = {};
  const allImageKeys = [];

  let singleCount = 0;
  let bundleCount = 0;
  let multiOfferChildrenCount = 0;
  let totalChildrenCount = 0;
  let tfEligibleCount = 0;
  let prEligibleCount = 0;
  let outlierCount = 0;
  let sellerWithContactCount = 0;

  for (const row of stagedRows) {
    const { parent, children, images } = normalizeCanonicalParentChild(row);
    normalizedParents.push(parent);

    totalChildrenCount += children.length;
    if (parent.is_bundle) {
      bundleCount++;
      multiOfferChildrenCount += children.length;
    } else {
      singleCount++;
    }

    if (parent.seller_contact) sellerWithContactCount++;

    for (const c of children) {
      if (c.trading_floor_eligible) tfEligibleCount++;
      if (c.price_research_eligible) prEligibleCount++;
      if (c.is_outlier) outlierCount++;
      currencyDistribution[c.currency_status] = (currencyDistribution[c.currency_status] || 0) + 1;
    }

    for (const img of images) {
      if (img.image_key) allImageKeys.push(img.image_key);
    }
  }

  console.log(`Normalization Summary:`);
  console.log(`  - Total Source Inputs: ${stagedRows.length}`);
  console.log(`  - Parents: ${normalizedParents.length}`);
  console.log(`  - Singles: ${singleCount}`);
  console.log(`  - Bundles / Multi-Offers: ${bundleCount}`);
  console.log(`  - Total Children: ${totalChildrenCount}`);
  console.log(`  - Trading Floor Eligible: ${tfEligibleCount} (${((tfEligibleCount/totalChildrenCount)*100).toFixed(2)}%)`);
  console.log(`  - Price Research Eligible: ${prEligibleCount} (${((prEligibleCount/totalChildrenCount)*100).toFixed(2)}%)`);
  console.log(`  - Price Outliers: ${outlierCount}`);
  console.log(`  - Total Image Keys Extracted: ${allImageKeys.length}`);
  console.log(`  - Currency Distribution:`, JSON.stringify(currencyDistribution, null, 2));

  // 4. Batch Upsert to Live Private Canonical Staging (First Run)
  console.log('\n4. Upserting Canary Batch to Private Canonical Staging Tables...');
  let totalInsertedParents = 0;
  let totalUpdatedParents = 0;
  let totalUnchangedParents = 0;

  let totalInsertedChildren = 0;
  let totalUpdatedChildren = 0;
  let totalUnchangedChildren = 0;

  for (let i = 0; i < normalizedParents.length; i += BATCH_SIZE) {
    const batch = normalizedParents.slice(i, i + BATCH_SIZE);
    const stats = await callRpc(supabaseUrl, supabaseKey, 'upsert_mariadb_canonical_batch', {
      p_parents: batch
    });

    totalInsertedParents += stats.inserted_parents;
    totalUpdatedParents += stats.updated_parents;
    totalUnchangedParents += stats.unchanged_parents;

    totalInsertedChildren += stats.inserted_children;
    totalUpdatedChildren += stats.updated_children;
    totalUnchangedChildren += stats.unchanged_children;
  }

  console.log(`First Run Upsert Accounting:`);
  console.log(`  - Parents: inserted=${totalInsertedParents}, updated=${totalUpdatedParents}, unchanged=${totalUnchangedParents}`);
  console.log(`  - Children: inserted=${totalInsertedChildren}, updated=${totalUpdatedChildren}, unchanged=${totalUnchangedChildren}`);

  // 5. Idempotent Second Run Assertion
  console.log('\n5. Performing Idempotent Second Upsert Run...');
  let rerunInsertedParents = 0;
  let rerunUpdatedParents = 0;
  let rerunUnchangedParents = 0;

  let rerunInsertedChildren = 0;
  let rerunUpdatedChildren = 0;
  let rerunUnchangedChildren = 0;

  for (let i = 0; i < normalizedParents.length; i += BATCH_SIZE) {
    const batch = normalizedParents.slice(i, i + BATCH_SIZE);
    const stats = await callRpc(supabaseUrl, supabaseKey, 'upsert_mariadb_canonical_batch', {
      p_parents: batch
    });

    rerunInsertedParents += stats.inserted_parents;
    rerunUpdatedParents += stats.updated_parents;
    rerunUnchangedParents += stats.unchanged_parents;

    rerunInsertedChildren += stats.inserted_children;
    rerunUpdatedChildren += stats.updated_children;
    rerunUnchangedChildren += stats.unchanged_children;
  }

  console.log(`Second Run (Idempotency) Accounting:`);
  console.log(`  - Parents: inserted=${rerunInsertedParents}, updated=${rerunUpdatedParents}, unchanged=${rerunUnchangedParents}`);
  console.log(`  - Children: inserted=${rerunInsertedChildren}, updated=${rerunUpdatedChildren}, unchanged=${rerunUnchangedChildren}`);

  if (rerunInsertedParents !== 0 || rerunUpdatedParents !== 0 || rerunUnchangedParents !== CANARY_ROW_COUNT) {
    throw new Error(`Parent idempotency violation: expected inserted=0, updated=0, unchanged=${CANARY_ROW_COUNT}, got inserted=${rerunInsertedParents}, updated=${rerunUpdatedParents}, unchanged=${rerunUnchangedParents}`);
  }

  if (rerunInsertedChildren !== 0 || rerunUpdatedChildren !== 0 || rerunUnchangedChildren !== totalChildrenCount) {
    throw new Error(`Child idempotency violation: expected inserted=0, updated=0, unchanged=${totalChildrenCount}, got inserted=${rerunInsertedChildren}, updated=${rerunUpdatedChildren}, unchanged=${rerunUnchangedChildren}`);
  }

  // 6. Sample-Check 100 Image URLs for Reachability
  console.log('\n6. Sample-checking 100 Source-Linked Image URLs for Reachability...');
  const imageReachability = await sampleCheckImageReachability(allImageKeys, 100);
  console.log(`Image Reachability Sample Results: total=${imageReachability.total_sampled}, reachable=${imageReachability.reachable}, unreachable=${imageReachability.unreachable}`);

  // 7. Verify Composite Detail RPC
  console.log('\n7. Verifying Detail RPC on Sample Listing...');
  const sampleRow = stagedRows[0];
  const detailData = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_canonical_child_detail', {
    p_source_id: sampleRow.source_id,
    p_source_system: sampleRow.source_system,
    p_source_database: sampleRow.source_database,
    p_source_table: sampleRow.source_table,
    p_source_hash: sampleRow.source_hash,
    p_child_ordinal: 0
  });
  console.log(`Detail RPC Verified: Parent ID=${detailData.parent.id}, Child Brand=${detailData.child.brand}, Ref=${detailData.child.reference}, Seller=${detailData.authorized_inquiry.seller_name}`);

  // 8. Post-Canary State & Zero-Delta Assertion
  console.log('\n8. Verifying Post-Canary Public Isolation & Raw Checkpoint...');
  const publicMetricsAfter = await callRpc(supabaseUrl, supabaseKey, 'get_public_table_audit_counts', {});

  const deltaRaw = publicMetricsAfter.raw_messages.count - publicMetricsBefore.raw_messages.count;
  const deltaWatch = publicMetricsAfter.watch_records.count - publicMetricsBefore.watch_records.count;
  const deltaTf = publicMetricsAfter.trading_floor_ready_view.count - publicMetricsBefore.trading_floor_ready_view.count;
  const deltaPr = publicMetricsAfter.price_research_ready_view.count - publicMetricsBefore.price_research_ready_view.count;

  console.log(`  [POST] public.raw_messages:           count = ${publicMetricsAfter.raw_messages.count} (delta=${deltaRaw})`);
  console.log(`  [POST] public.watch_records:          count = ${publicMetricsAfter.watch_records.count} (delta=${deltaWatch})`);
  console.log(`  [POST] trading_floor_ready_view:     count = ${publicMetricsAfter.trading_floor_ready_view.count} (delta=${deltaTf})`);
  console.log(`  [POST] price_research_ready_view:    count = ${publicMetricsAfter.price_research_ready_view.count} (delta=${deltaPr})`);

  if (deltaRaw !== 0 || deltaWatch !== 0 || deltaTf !== 0 || deltaPr !== 0) {
    throw new Error(`Public Isolation Violation: Mutations detected in public schema!`);
  }

  const rawCpAfter = await callRpc(supabaseUrl, supabaseKey, 'get_mariadb_private_raw_checkpoint', {
    p_run_key: 'full-capture-auctions-1788028958313'
  });
  console.log(`  [POST] Raw Checkpoint: inputs=${rawCpAfter.input_rows}, staged=${rawCpAfter.staged_rows}, errors=${rawCpAfter.capture_errors_count || rawCpAfter.capture_error_rows}`);
  if (Number(rawCpAfter.input_rows) !== 951750 || Number(rawCpAfter.capture_errors_count || rawCpAfter.capture_error_rows) !== 7) {
    throw new Error(`Raw checkpoint corrupted after canary!`);
  }

  const summary = {
    contract: CONTRACT,
    timestamp: new Date().toISOString(),
    canary_inputs_processed: CANARY_ROW_COUNT,
    parents_count: normalizedParents.length,
    single_listings_count: singleCount,
    bundle_listings_count: bundleCount,
    children_count: totalChildrenCount,
    trading_floor_eligible_count: tfEligibleCount,
    trading_floor_eligible_pct: `${((tfEligibleCount / totalChildrenCount) * 100).toFixed(2)}%`,
    price_research_eligible_count: prEligibleCount,
    price_research_eligible_pct: `${((prEligibleCount / totalChildrenCount) * 100).toFixed(2)}%`,
    price_outliers_count: outlierCount,
    currency_distribution: currencyDistribution,
    image_evidence: {
      total_extracted_keys: allImageKeys.length,
      sample_reachability_checked: imageReachability.total_sampled,
      sample_reachable: imageReachability.reachable,
      sample_unreachable: imageReachability.unreachable
    },
    idempotency_run_1: {
      parents: { inserted: totalInsertedParents, updated: totalUpdatedParents, unchanged: totalUnchangedParents },
      children: { inserted: totalInsertedChildren, updated: totalUpdatedChildren, unchanged: totalUnchangedChildren }
    },
    idempotency_run_2: {
      parents: { inserted: rerunInsertedParents, updated: rerunUpdatedParents, unchanged: rerunUnchangedParents },
      children: { inserted: rerunInsertedChildren, updated: rerunUpdatedChildren, unchanged: rerunUnchangedChildren }
    },
    public_before_after_comparison: {
      trading_floor_ready_view: { before_count: publicMetricsBefore.trading_floor_ready_view.count, after_count: publicMetricsAfter.trading_floor_ready_view.count, delta: deltaTf },
      price_research_ready_view: { before_count: publicMetricsBefore.price_research_ready_view.count, after_count: publicMetricsAfter.price_research_ready_view.count, delta: deltaPr },
      public_raw_messages: { before_count: publicMetricsBefore.raw_messages.count, after_count: publicMetricsAfter.raw_messages.count, delta: deltaRaw },
      public_watch_records: { before_count: publicMetricsBefore.watch_records.count, after_count: publicMetricsAfter.watch_records.count, delta: deltaWatch }
    },
    public_isolation_verified: true,
    raw_checkpoint_preserved_at_951750: true,
    cursor_boundary: {
      first_row: { created_on: stagedRows[0].source_created_on, source_id: stagedRows[0].source_id },
      last_row: { created_on: lastCreatedOn, source_id: lastSourceId }
    }
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'canonical-canary-10k-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const summaryBytes = fs.readFileSync(path.join(OUTPUT_DIR, 'canonical-canary-10k-summary.json'));
  const manifest = {
    contract: 'wf-canonical-10k-canary-manifest-v1',
    timestamp: new Date().toISOString(),
    classification: 'CANONICAL_CANARY_10K_VERIFIED',
    summary,
    artifact_checksums: {
      'canonical-canary-10k-summary.json': {
        sha256: crypto.createHash('sha256').update(summaryBytes).digest('hex'),
        size_bytes: summaryBytes.length
      }
    }
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'canonical-canary-10k-authoritative-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log('\n============================================================');
  console.log('10,000-ROW CANONICAL CANARY PASSED WITH 100% IDEMPOTENCY & ZERO PUBLIC DELTA');
  console.log('============================================================');

  return manifest;
}

if (require.main === module) {
  runCanonical10kCanary()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('CANARY_EXECUTION_ERROR:', err);
      process.exit(1);
    });
}

module.exports = {
  runCanonical10kCanary,
  fetchTableCountAndMaxDate,
  sampleCheckImageReachability
};
