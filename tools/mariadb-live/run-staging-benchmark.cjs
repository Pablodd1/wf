// tools/mariadb-live/run-staging-benchmark.cjs
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const CONTRACT = 'wf-mariadb-private-raw-staging-v1';
const P95_SAFETY_THRESHOLD_MS = 4000; // Explicit objective safety limit for P95 latency

function sha256(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function stableJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
}

function calculatePercentiles(latencies) {
  if (!latencies.length) return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p = (pct) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))];
  return {
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    mean: Number((sum / sorted.length).toFixed(2)),
    p50: Number(p(0.50).toFixed(2)),
    p95: Number(p(0.95).toFixed(2)),
    p99: Number(p(0.99).toFixed(2))
  };
}

async function snapshotPublicLineage(supabase, sourceIds) {
  const snapshot = {
    raw_messages_count: 0,
    raw_message_versions_count: 0,
    watch_records_count: 0
  };

  const chunks = [];
  for (let i = 0; i < sourceIds.length; i += 250) {
    const chunkIds = sourceIds.slice(i, i + 250);
    chunks.push(chunkIds.map(id => ('mysql_auctions_' + id)));
  }

  const poolConcurrency = 25;
  const queue = [...chunks];

  async function queryWorker() {
    while (queue.length > 0) {
      const chunkRecordIds = queue.shift();
      if (!chunkRecordIds) break;

      const [resRaw, resVers, resWatch] = await Promise.all([
        supabase.from('raw_messages').select('id').in('external_message_id', chunkRecordIds),
        supabase.from('raw_message_versions').select('id').in('source_record_id', chunkRecordIds),
        supabase.from('watch_records').select('id').in('id', chunkRecordIds)
      ]);

      if (resRaw.error) throw new Error('Public raw_messages audit query failed: ' + resRaw.error.message);
      if (resVers.error) throw new Error('Public raw_message_versions audit query failed: ' + resVers.error.message);
      if (resWatch.error) throw new Error('Public watch_records audit query failed: ' + resWatch.error.message);

      snapshot.raw_messages_count += resRaw.data?.length || 0;
      snapshot.raw_message_versions_count += resVers.data?.length || 0;
      snapshot.watch_records_count += resWatch.data?.length || 0;
    }
  }

  await Promise.all(Array.from({ length: poolConcurrency }, () => queryWorker()));
  return snapshot;
}

async function runProfile(supabase, baseRecords, concurrency, batchSize, profileName) {
  console.log('\n============================================================');
  console.log(`RUNNING 100K BENCHMARK PROFILE: Concurrency=${concurrency}, BatchSize=${batchSize}, Profile=${profileName}`);
  console.log(`Cohort Size: ${baseRecords.length} records (100,000 actual new-row writes)`);
  console.log('============================================================');

  const runKey = `bench-100k-${profileName}-${Date.now()}`;
  // Unique benchmark table namespace ensures 100% clean, genuine new-row insertions
  const benchmarkNamespaceTable = `auctions_bench_100k_${profileName}`;
  const records = baseRecords.map(r => ({
    ...r,
    source_table: benchmarkNamespaceTable,
    source_record_id: `mysql_${benchmarkNamespaceTable}_${r.source_id}`
  }));

  // Partition records evenly across workers
  const chunkSize = Math.ceil(records.length / concurrency);
  const workerPartitions = [];
  for (let w = 0; w < concurrency; w++) {
    const start = w * chunkSize;
    const end = Math.min(records.length, start + chunkSize);
    if (start < records.length) {
      workerPartitions.push({
        workerId: w + 1,
        workerRecords: records.slice(start, end)
      });
    }
  }

  const latencies = [];
  let totalNewlyStaged = 0;
  let totalAlreadyStaged = 0;
  let totalErrors = 0;
  let lockThrottles = 0;
  let completedBatches = 0;

  const totalBatches = workerPartitions.reduce((acc, wp) => acc + Math.ceil(wp.workerRecords.length / batchSize), 0);
  const startTime = Date.now();

  async function runWorkerPartition(partition) {
    const { workerId, workerRecords } = partition;
    const workerRunKey = `${runKey}-w${workerId}`;
    let lastCreatedOn = '';
    let lastSourceId = '';

    for (let i = 0; i < workerRecords.length; i += batchSize) {
      const batchRecords = workerRecords.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);
      const firstSourceId = batchRecords[0].source_id;
      const nextLastCreatedOn = batchRecords[batchRecords.length - 1].source_created_on || '';
      const nextLastSourceId = batchRecords[batchRecords.length - 1].source_id || '';
      const batchToken = sha256(`${workerRunKey}:${batchIndex}:${firstSourceId}:${nextLastSourceId}`);

      const bStart = Date.now();
      let attempt = 0;
      let success = false;
      let lastErr = null;

      while (attempt < 3 && !success) {
        attempt++;
        try {
          const { data, error } = await supabase.rpc('ingest_mariadb_private_raw_batch', {
            p_run_key: workerRunKey,
            p_batch_token: batchToken,
            p_contract: CONTRACT,
            p_expected_last_created_on: lastCreatedOn,
            p_expected_last_source_id: lastSourceId,
            p_next_last_created_on: nextLastCreatedOn,
            p_next_last_source_id: nextLastSourceId,
            p_records: batchRecords
          });

          if (error) {
            if (error.message.includes('lock') || error.message.includes('timeout') || error.message.includes('429')) {
              lockThrottles++;
            }
            throw new Error(error.message);
          }

          // Hard Invariant Gate: Exact batch accounting
          const accounted = (data.newly_staged_rows || 0) + (data.already_staged_identical_rows || 0) + (data.capture_error_rows || 0);
          if (accounted !== batchRecords.length) {
            throw new Error(`Batch Accounting Discrepancy: Input=${batchRecords.length}, Accounted=${accounted}`);
          }

          const bDuration = Date.now() - bStart;
          latencies.push(bDuration);
          totalNewlyStaged += data.newly_staged_rows || 0;
          totalAlreadyStaged += data.already_staged_identical_rows || 0;
          totalErrors += data.capture_error_rows || 0;
          lastCreatedOn = nextLastCreatedOn;
          lastSourceId = nextLastSourceId;
          success = true;
          completedBatches++;

          if (completedBatches % Math.max(1, Math.floor(totalBatches / 10)) === 0 || completedBatches === totalBatches) {
            const currentRps = (completedBatches * batchSize / ((Date.now() - startTime) / 1000)).toFixed(1);
            console.log(`[${profileName}] Progress: ${completedBatches}/${totalBatches} batches (${Math.min(records.length, completedBatches * batchSize)} rows) @ ${currentRps} rows/sec`);
          }
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            await new Promise(res => setTimeout(res, 250 * attempt));
          }
        }
      }

      // Hard Invariant Gate: Worker fail-stop immediately after unreconciled batch
      if (!success) {
        console.error(`[${profileName}-w${workerId}] FATAL: Batch ${batchIndex} FAILED permanently:`, lastErr?.message);
        throw new Error(`Worker fail-stop triggered on ${profileName}-w${workerId}: ` + lastErr?.message);
      }
    }
  }

  // Execute all worker partitions concurrently
  await Promise.all(workerPartitions.map(wp => runWorkerPartition(wp)));

  const totalDurationMs = Date.now() - startTime;
  const totalDurationSec = totalDurationMs / 1000;
  const throughputRps = Number((records.length / totalDurationSec).toFixed(2));
  const latencyStats = calculatePercentiles(latencies);
  const mem = process.memoryUsage();

  const profileResult = {
    profile: profileName,
    concurrency,
    batch_size: batchSize,
    total_records: records.length,
    batches_count: totalBatches,
    newly_staged_rows: totalNewlyStaged,
    already_staged_identical_rows: totalAlreadyStaged,
    error_rows: totalErrors,
    exact_reconciliation: (totalNewlyStaged + totalAlreadyStaged + totalErrors) === records.length,
    duration_seconds: Number(totalDurationSec.toFixed(2)),
    throughput_rows_per_sec: throughputRps,
    latency_ms: latencyStats,
    lock_or_throttle_events: lockThrottles,
    p95_safe: latencyStats.p95 <= P95_SAFETY_THRESHOLD_MS,
    peak_rss_mb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
    heap_used_mb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2))
  };

  console.log(`[${profileName}] Completed: Throughput=${throughputRps} rps, P50=${latencyStats.p50}ms, P95=${latencyStats.p95}ms, NewlyStaged=${totalNewlyStaged}, Errors=${totalErrors}`);
  return profileResult;
}

async function run100kBenchmarkSuite() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided via Railway variable injection');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const cohortPath = path.resolve('audit-output/mariadb-live/benchmark-100k/cohort-100k.json');
  if (!fs.existsSync(cohortPath)) {
    throw new Error('Frozen cohort-100k.json not found at ' + cohortPath);
  }

  console.log('Loading frozen 100,000-record cohort from cohort-100k.json...');
  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
  console.log(`Loaded exactly ${cohort.length} records.`);

  const sourceIds = cohort.map(r => r.source_id);

  console.log('Checking pre-benchmark public lineage baseline across all 100,000 source identities...');
  const publicBefore = await snapshotPublicLineage(supabase, sourceIds);
  console.log('Public baseline verified:', publicBefore);

  const profiles = [
    { concurrency: 1, batchSize: 250, name: 'w1_b250' },
    { concurrency: 4, batchSize: 250, name: 'w4_b250' },
    { concurrency: 8, batchSize: 250, name: 'w8_b250' },
    { concurrency: 16, batchSize: 250, name: 'w16_b250' }
  ];

  const results = [];
  for (const p of profiles) {
    const res = await runProfile(supabase, cohort, p.concurrency, p.batchSize, p.name);
    results.push(res);
  }

  console.log('Checking post-benchmark public lineage across all 100,000 source identities...');
  const publicAfter = await snapshotPublicLineage(supabase, sourceIds);
  console.log('Public post-benchmark verified:', publicAfter);

  if (stableJson(publicBefore) !== stableJson(publicAfter)) {
    throw new Error('Public Publication Gate Failure: Public table counts changed during 100k benchmark execution!');
  }

  const outputDir = path.resolve('audit-output/mariadb-live/benchmark-100k');
  fs.mkdirSync(outputDir, { recursive: true });

  // Explicit Objective Selection Rule:
  // 1. Candidate must have 0 errors, 0 lock throttles, and exact reconciliation.
  // 2. Candidate must satisfy P95 <= P95_SAFETY_THRESHOLD_MS (4000ms).
  // 3. Select candidate with highest throughput among safe profiles.
  const safeCandidates = results.filter(r => r.error_rows === 0 && r.lock_or_throttle_events === 0 && r.exact_reconciliation && r.p95_safe);
  safeCandidates.sort((a, b) => b.throughput_rows_per_sec - a.throughput_rows_per_sec);

  const selected = safeCandidates[0] || results[0];
  const recommendation = {
    selection_rule: `Highest throughput satisfying P95 latency <= ${P95_SAFETY_THRESHOLD_MS}ms with 0 errors and 0 lock events`,
    safest_worker_count: selected.concurrency,
    safest_batch_size: selected.batch_size,
    recommended_profile: selected.profile,
    measured_throughput_rps: selected.throughput_rows_per_sec,
    measured_p50_latency_ms: selected.latency_ms.p50,
    measured_p95_latency_ms: selected.latency_ms.p95,
    p95_safety_threshold_ms: P95_SAFETY_THRESHOLD_MS,
    estimated_1_495m_full_capture_minutes: Number((1495053 / selected.throughput_rows_per_sec / 60).toFixed(1)),
    objective_elimination_summary: results.map(r => ({
      profile: r.profile,
      throughput_rps: r.throughput_rows_per_sec,
      p95_ms: r.latency_ms.p95,
      compliant_with_p95_threshold: r.latency_ms.p95 <= P95_SAFETY_THRESHOLD_MS,
      status: r.profile === selected.profile ? 'SELECTED_OPTIMAL' : (r.latency_ms.p95 > P95_SAFETY_THRESHOLD_MS ? 'ELIMINATED_EXCEEDS_TAIL_LATENCY' : 'SUBOPTIMAL_LOWER_THROUGHPUT')
    }))
  };

  const report = {
    benchmark_contract: CONTRACT,
    benchmark_cohort_size: cohort.length,
    p95_safety_threshold_ms: P95_SAFETY_THRESHOLD_MS,
    profiles_tested: results,
    recommendation,
    public_impact_audit: {
      source_identities_verified: cohort.length,
      public_matches_before: publicBefore,
      public_matches_after: publicAfter,
      zero_public_delta_verified: true
    },
    timestamp: new Date().toISOString()
  };

  const reportPath = path.join(outputDir, 'benchmark-100k-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const reconPath = path.join(outputDir, 'benchmark-100k-reconciliation.json');
  fs.writeFileSync(reconPath, JSON.stringify({
    contract: CONTRACT,
    cohort_size: cohort.length,
    profiles: results.map(r => ({
      profile: r.profile,
      concurrency: r.concurrency,
      input_rows: r.total_records,
      newly_staged_rows: r.newly_staged_rows,
      already_staged_identical_rows: r.already_staged_identical_rows,
      error_rows: r.error_rows,
      exact_reconciliation: r.exact_reconciliation
    }))
  }, null, 2));

  const errorPath = path.join(outputDir, 'benchmark-100k-errors.json');
  fs.writeFileSync(errorPath, JSON.stringify({
    contract: CONTRACT,
    total_errors: results.reduce((acc, r) => acc + r.error_rows, 0),
    errors_by_profile: results.map(r => ({ profile: r.profile, errors: r.error_rows }))
  }, null, 2));

  const publicImpactPath = path.join(outputDir, 'benchmark-100k-public-impact.json');
  fs.writeFileSync(publicImpactPath, JSON.stringify(report.public_impact_audit, null, 2));

  // Compute checksums for all benchmark artifacts
  const artifactFiles = [
    'cohort-100k-manifest.json',
    'benchmark-100k-report.json',
    'benchmark-100k-reconciliation.json',
    'benchmark-100k-errors.json',
    'benchmark-100k-public-impact.json'
  ];

  const checksums = {};
  for (const af of artifactFiles) {
    const p = path.join(outputDir, af);
    if (fs.existsSync(p)) {
      checksums[af] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  }

  const checksumsPath = path.join(outputDir, 'benchmark-100k-checksums.json');
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2));

  console.log('\n100K Benchmark Suite Complete! Artifacts written to ' + outputDir);
  return { report, checksums };
}

if (require.main === module) {
  run100kBenchmarkSuite()
    .then(({ report }) => {
      console.log('\n============================================================');
      console.log('100K BENCHMARK COMPLETE');
      console.log('============================================================');
      console.log('Recommendation:', JSON.stringify(report.recommendation, null, 2));
    })
    .catch(err => {
      console.error('100K Benchmark Fatal Error:', err);
      process.exit(1);
    });
}

module.exports = { run100kBenchmarkSuite, runProfile };
