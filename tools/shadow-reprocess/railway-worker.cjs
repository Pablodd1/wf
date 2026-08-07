'use strict';

// Long-running, single-concurrency worker for Railway/Render. It processes
// only shadow proposals and uses a Postgres lease so it cannot race Vercel.

console.log("CRITICAL: Worker paused for wf-mariadb-shadow-volume expansion.");
setInterval(() => {}, 60000);
return;

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { analyzeRecord } = require('./shadow-reprocess.cjs');

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const jobName = process.env.SHADOW_JOB_NAME || 'normalization-v4-production';
const batchSize = Math.max(100, Math.min(Number(process.env.SHADOW_BATCH_SIZE || 1000), 5000));
const rowsPerLease = Math.max(batchSize, Number(process.env.SHADOW_ROWS_PER_LEASE || 10000));
const idleDelayMs = Math.max(1000, Number(process.env.SHADOW_IDLE_DELAY_MS || 15000));
const workerMode = String(process.env.SHADOW_WORKER_MODE || 'cursor').trim().toLowerCase();
const useGlobalLease = workerMode === 'cursor';
const exitOnCompleteValue = String(process.env.SHADOW_EXIT_ON_COMPLETE || '').trim().toLowerCase();
const exitOnComplete = exitOnCompleteValue
  ? exitOnCompleteValue === 'true'
  : workerMode === 'cursor';
const holder = `railway:${process.env.RAILWAY_DEPLOYMENT_ID || process.env.HOSTNAME || 'worker'}:${process.pid}:${randomUUID()}`;

if (!baseUrl || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

if (!['cursor', 'queue'].includes(workerMode)) {
  throw new Error('SHADOW_WORKER_MODE must be cursor or queue');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function roundMetric(value) {
  return Number(value.toFixed(2));
}

function memoryMb() {
  const memory = process.memoryUsage();
  return {
    rss: roundMetric(memory.rss / 1024 / 1024),
    heapUsed: roundMetric(memory.heapUsed / 1024 / 1024),
    external: roundMetric(memory.external / 1024 / 1024),
  };
}

function emptyStageTimings() {
  return {
    claimReadMs: 0,
    analyzeWallMs: 0,
    analyzeCpuMs: 0,
    shadowUpsertMs: 0,
    completionRpcMs: 0,
    totalMs: 0,
  };
}

function addStageTimings(totals, batch) {
  for (const stage of Object.keys(totals)) totals[stage] += batch[stage];
}

function roundedStageTimings(timings) {
  return Object.fromEntries(
    Object.entries(timings).map(([stage, duration]) => [stage, roundMetric(duration)]),
  );
}

function queueLeaseSummary({ processed, changed, complete, batches, leaseStartedAt, stageTotals }) {
  const runtimeMs = performance.now() - leaseStartedAt;
  return {
    processed,
    changed,
    complete,
    queue: true,
    batchSize,
    rowsPerLease,
    batches,
    runtimeMs: roundMetric(runtimeMs),
    rowsPerSecond: runtimeMs > 0 ? roundMetric(processed / (runtimeMs / 1000)) : 0,
    stageTotalsMs: roundedStageTimings(stageTotals),
    memoryMb: memoryMb(),
  };
}

async function rest(path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function callRpc(name, payload) {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(payload) });
}

async function acquireLease() {
  return callRpc('acquire_normalization_worker_lease', {
    p_job_name: jobName,
    p_holder: holder,
    p_lease_seconds: 900,
  });
}

async function releaseLease() {
  try {
    await callRpc('release_normalization_worker_lease', { p_job_name: jobName, p_holder: holder });
  } catch (error) {
    console.error(JSON.stringify({ event: 'lease_release_failed', error: error.message }));
  }
}

async function releaseQueueWork(sourceRecordIds, error) {
  if (!sourceRecordIds.length) return;
  try {
    await callRpc('release_normalization_shadow_work', {
      p_holder: holder,
      p_source_record_ids: sourceRecordIds,
      p_error: error.message || String(error),
      p_retry_seconds: 60,
      p_max_attempts: 8,
    });
  } catch (releaseError) {
    console.error(JSON.stringify({ event: 'queue_release_failed', error: releaseError.message }));
  }
}

async function runQueueLease() {
  const leaseStartedAt = performance.now();
  let processed = 0;
  let changed = 0;
  let batches = 0;
  const stageTotals = emptyStageTimings();

  while (processed < rowsPerLease) {
    const batchStartedAt = performance.now();
    const limit = Math.min(batchSize, rowsPerLease - processed);
    const claimStartedAt = performance.now();
    const records = await callRpc('claim_normalization_shadow_work', {
      p_holder: holder,
      p_limit: limit,
      p_lease_seconds: 900,
    });
    const claimReadMs = performance.now() - claimStartedAt;
    if (!records?.length) {
      return queueLeaseSummary({
        processed,
        changed,
        complete: true,
        batches,
        leaseStartedAt,
        stageTotals,
      });
    }

    const sourceRecordIds = records.map(record => record.id);
    try {
      const analyzeStartedAt = performance.now();
      const analyzeCpuStarted = process.cpuUsage();
      const shadowRows = records.map(analyzeRecord);
      const analyzeWallMs = performance.now() - analyzeStartedAt;
      const analyzeCpu = process.cpuUsage(analyzeCpuStarted);
      const analyzeCpuMs = (analyzeCpu.user + analyzeCpu.system) / 1000;
      const upsertStartedAt = performance.now();
      await rest('normalization_shadow_v4?on_conflict=source_record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(shadowRows),
      });
      const shadowUpsertMs = performance.now() - upsertStartedAt;
      const completionStartedAt = performance.now();
      const completed = await callRpc('complete_normalization_shadow_work', {
        p_holder: holder,
        p_source_record_ids: sourceRecordIds,
      });
      const completionRpcMs = performance.now() - completionStartedAt;
      if (Number(completed) !== sourceRecordIds.length) {
        throw new Error(`Queue completion mismatch: expected ${sourceRecordIds.length}, completed ${completed}`);
      }
      const batchChanged = shadowRows.filter(row => row.change_flags.length > 0).length;
      const totalMs = performance.now() - batchStartedAt;
      const batchTimings = {
        claimReadMs,
        analyzeWallMs,
        analyzeCpuMs,
        shadowUpsertMs,
        completionRpcMs,
        totalMs,
      };
      processed += records.length;
      changed += batchChanged;
      batches += 1;
      addStageTimings(stageTotals, batchTimings);
      console.log(JSON.stringify({
        event: 'batch_complete',
        jobName,
        workerMode,
        rows: records.length,
        changed: batchChanged,
        rowsPerSecond: totalMs > 0 ? roundMetric(records.length / (totalMs / 1000)) : 0,
        timingMs: roundedStageTimings(batchTimings),
      }));
    } catch (error) {
      await releaseQueueWork(sourceRecordIds, error);
      throw error;
    }
  }

  return queueLeaseSummary({
    processed,
    changed,
    complete: false,
    batches,
    leaseStartedAt,
    stageTotals,
  });
}

async function runLease() {
  const checkpoints = await rest(
    `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=last_source_record_id,rows_analyzed&limit=1`,
  );
  const checkpoint = checkpoints?.[0] || {};
  let lastId = checkpoint.last_source_record_id || '';
  let processed = 0;
  let changed = 0;

  while (processed < rowsPerLease) {
    const limit = Math.min(batchSize, rowsPerLease - processed);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const records = await rest(`watch_records?${params.toString()}`);
    if (!records?.length) return { processed, changed, complete: true, lastId };

    const shadowRows = records.map(analyzeRecord);
    lastId = records[records.length - 1].id;
    processed += records.length;
    changed += shadowRows.filter(row => row.change_flags.length > 0).length;

    await rest('normalization_shadow_v4?on_conflict=source_record_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(shadowRows),
    });
    await rest('normalization_shadow_checkpoints?on_conflict=job_name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        job_name: jobName,
        last_source_record_id: lastId,
        rows_analyzed: Number(checkpoint.rows_analyzed || 0) + processed,
        updated_at: new Date().toISOString(),
      }]),
    });
  }

  return { processed, changed, complete: false, lastId };
}

async function main() {
  console.log(JSON.stringify({ event: 'worker_started', jobName, workerMode, useGlobalLease, batchSize, rowsPerLease, exitOnComplete, holder }));
  do {
    let shouldStop = false;
    try {
      // Queue claims already use FOR UPDATE SKIP LOCKED. The global lease is
      // retained only for the legacy cursor, where parallel scans are unsafe.
      const acquired = useGlobalLease ? await acquireLease() : true;
      if (!acquired) {
        console.log(JSON.stringify({ event: 'lease_busy', jobName }));
        await sleep(idleDelayMs);
        continue;
      }
      try {
        const result = workerMode === 'queue' ? await runQueueLease() : await runLease();
        console.log(JSON.stringify({ event: 'lease_complete', jobName, workerMode, ...result }));
        shouldStop = result.complete && exitOnComplete;
        if (!shouldStop) await sleep(result.complete ? idleDelayMs : 250);
      } finally {
        if (useGlobalLease) await releaseLease();
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'worker_error', jobName, error: error.message }));
      await sleep(idleDelayMs);
    }
    if (shouldStop) {
      console.log(JSON.stringify({ event: 'worker_complete', jobName, workerMode }));
      return;
    }
  } while (String(process.env.SHADOW_WORKER_ONCE || '').toLowerCase() !== 'true');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
