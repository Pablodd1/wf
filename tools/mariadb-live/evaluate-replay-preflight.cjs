'use strict';

const fs = require('node:fs');

const PREFLIGHT_CONTRACT = 'wf-two-brand-replay-preflight-v1';

function finiteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function queueCount(snapshot, statuses) {
  const accepted = new Set(statuses.map(status => String(status).toLowerCase()));
  return (snapshot.job_statuses || []).reduce((sum, row) => (
    accepted.has(String(row.status || '').toLowerCase())
      ? sum + Number(row.row_count || 0)
      : sum
  ), 0);
}

function evaluateReplayPreflight(snapshot, limits) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot is required');
  if (!limits || typeof limits !== 'object') throw new Error('limits are required');

  const databaseGib = finiteNumber(snapshot.database_gib, 'snapshot.database_gib');
  const databaseLimitGib = finiteNumber(limits.database_limit_gib, 'limits.database_limit_gib');
  const minimumHeadroomGib = finiteNumber(limits.minimum_headroom_gib, 'limits.minimum_headroom_gib');
  const maxPendingJobs = nonNegativeInteger(limits.max_pending_jobs, 'limits.max_pending_jobs');
  const maxFailedJobs = nonNegativeInteger(limits.max_failed_jobs, 'limits.max_failed_jobs');
  const expectedProjectRef = String(limits.expected_project_ref || '');
  const requestedRunKey = String(limits.run_key || '');
  const operation = limits.operation === 'price_correction' ? 'price_correction' : 'replay';
  const pendingJobs = queueCount(snapshot, ['received', 'queued', 'processing']);
  const failedJobs = queueCount(snapshot, ['failed', 'dead_letter']);
  const headroomGib = databaseLimitGib - databaseGib;
  const blockers = [];

  if (!expectedProjectRef || snapshot.project_ref !== expectedProjectRef) blockers.push('PROJECT_REF_MISMATCH');
  if (!requestedRunKey || !/^[A-Za-z0-9._:-]{1,100}$/.test(requestedRunKey)) blockers.push('INVALID_RUN_KEY');
  if (databaseLimitGib <= 0 || minimumHeadroomGib < 0) blockers.push('INVALID_CAPACITY_LIMITS');
  if (databaseGib >= databaseLimitGib) blockers.push('DATABASE_AT_OR_OVER_LIMIT');
  if (headroomGib < minimumHeadroomGib) blockers.push('INSUFFICIENT_DATABASE_HEADROOM');
  if (pendingJobs > maxPendingJobs) blockers.push('PENDING_JOB_THRESHOLD_EXCEEDED');
  if (failedJobs > maxFailedJobs) blockers.push('FAILED_JOB_THRESHOLD_EXCEEDED');
  if (snapshot.raw_checkpoint?.status !== 'RAW_COPY_COMPLETE') blockers.push('RAW_IMPORT_NOT_COMPLETE');
  if (Number(snapshot.raw_checkpoint?.error_rows || 0) !== 0) blockers.push('RAW_IMPORT_HAS_ERRORS');

  const conflictingRuns = (snapshot.active_normalization_runs || []).filter(row => (
    row.run_key !== requestedRunKey && row.status === 'STAGING_NORMALIZATION'
  ));
  if (conflictingRuns.length) blockers.push('CONFLICTING_NORMALIZATION_RUN_ACTIVE');

  const target = snapshot.target_checkpoint || null;
  if (target && Number(target.error_rows || 0) !== 0) blockers.push('TARGET_CHECKPOINT_HAS_ERRORS');
  if (target && !['STAGING_NORMALIZATION', 'NORMALIZATION_STAGED'].includes(target.status)) {
    blockers.push('TARGET_CHECKPOINT_STATUS_INVALID');
  }

  const alreadyComplete = target?.status === 'NORMALIZATION_STAGED';
  if (operation === 'price_correction' && !alreadyComplete) blockers.push('PRICE_CORRECTION_REQUIRES_COMPLETED_RUN');
  return {
    contract: PREFLIGHT_CONTRACT,
    allowed: blockers.length === 0 && (operation === 'price_correction' || !alreadyComplete),
    operation,
    already_complete: alreadyComplete,
    requested_run_key: requestedRunKey,
    database_gib: databaseGib,
    database_limit_gib: databaseLimitGib,
    headroom_gib: Number(headroomGib.toFixed(3)),
    minimum_headroom_gib: minimumHeadroomGib,
    pending_jobs: pendingJobs,
    max_pending_jobs: maxPendingJobs,
    failed_jobs: failedJobs,
    max_failed_jobs: maxFailedJobs,
    blockers,
  };
}

function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error('Usage: node evaluate-replay-preflight.cjs <snapshot.json>');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const result = evaluateReplayPreflight(snapshot, {
    expected_project_ref: process.env.EXPECTED_PROJECT_REF,
    run_key: process.env.NORMALIZED_RUN_KEY,
    database_limit_gib: process.env.DATABASE_LIMIT_GIB,
    minimum_headroom_gib: process.env.MINIMUM_HEADROOM_GIB,
    max_pending_jobs: process.env.MAX_PENDING_JOBS,
    max_failed_jobs: process.env.MAX_FAILED_JOBS,
    operation: process.env.REPLAY_PREFLIGHT_OPERATION,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.allowed && !result.already_complete) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      contract: PREFLIGHT_CONTRACT,
      allowed: false,
      blockers: ['PREFLIGHT_EVALUATION_FAILED'],
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PREFLIGHT_CONTRACT, evaluateReplayPreflight, queueCount };
