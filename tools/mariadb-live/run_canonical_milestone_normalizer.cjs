// tools/mariadb-live/run_canonical_milestone_normalizer.cjs
'use strict';

const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCanonicalParentChild } = require('./authoritative-evidence-normalizer.cjs');

const JOB_NAME = 'milestone-951750-canonical-normalization';
const FROZEN_CURSOR = {
  created_on: '2026-04-28T15:50:43.000Z',
  source_id: '3cddaf9f-9f36-4633-a08e-59a6dfdca057'
};
const BATCH_SIZE = 250;
const REPORT_INTERVAL = 10000;

async function runMilestoneNormalization() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('FATAL: DATABASE_URL is required.');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, statement_timeout: 30000 });
  await client.connect();

  console.log('[Canonical-Normalizer] Connected to Supabase private staging.');

  // Ensure checkpoint table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS wf_canonical_staging.mariadb_normalization_checkpoints (
      job_name TEXT PRIMARY KEY,
      frozen_cursor_created_on TIMESTAMPTZ,
      frozen_cursor_source_id TEXT,
      expected_staged_rows BIGINT,
      last_processed_created_on TIMESTAMPTZ,
      last_processed_source_id TEXT,
      total_inputs_processed BIGINT DEFAULT 0,
      normalized_proposals_count BIGINT DEFAULT 0,
      review_required_count BIGINT DEFAULT 0,
      normalization_errors_count BIGINT DEFAULT 0,
      trading_floor_eligible_count BIGINT DEFAULT 0,
      price_research_eligible_count BIGINT DEFAULT 0,
      status TEXT DEFAULT 'IN_PROGRESS',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Fetch or initialize checkpoint
  const cpRes = await client.query(`
    SELECT * FROM wf_canonical_staging.mariadb_normalization_checkpoints
    WHERE job_name = $1;
  `, [JOB_NAME]);

  let lastCreatedOn = null;
  let lastSourceId = null;
  let totalProcessed = 0;
  let normalizedProposals = 0;
  let reviewRequired = 0;
  let normalizationErrors = 0;
  let tfEligible = 0;
  let prEligible = 0;

  if (cpRes.rows.length > 0) {
    const cp = cpRes.rows[0];
    lastCreatedOn = cp.last_processed_created_on;
    lastSourceId = cp.last_processed_source_id;
    totalProcessed = Number(cp.total_inputs_processed || 0);
    normalizedProposals = Number(cp.normalized_proposals_count || 0);
    reviewRequired = Number(cp.review_required_count || 0);
    normalizationErrors = Number(cp.normalization_errors_count || 0);
    tfEligible = Number(cp.trading_floor_eligible_count || 0);
    prEligible = Number(cp.price_research_eligible_count || 0);
    console.log(`[Canonical-Normalizer] Resuming from checkpoint: processed=${totalProcessed}, cursor=${lastCreatedOn} / ${lastSourceId}`);
  } else {
    await client.query(`
      INSERT INTO wf_canonical_staging.mariadb_normalization_checkpoints (
        job_name, frozen_cursor_created_on, frozen_cursor_source_id, expected_staged_rows, status
      ) VALUES ($1, $2, $3, $4, 'IN_PROGRESS');
    `, [JOB_NAME, FROZEN_CURSOR.created_on, FROZEN_CURSOR.source_id, 951743]);
    console.log('[Canonical-Normalizer] Initialized fresh checkpoint for milestone 951,750.');
  }

  const startTime = Date.now();
  let hasMore = true;
  let batchIndex = 0;

  const currencyDistribution = {};
  const intentDistribution = {};

  while (hasMore) {
    batchIndex++;

    let queryText = '';
    let queryParams = [];

    if (lastCreatedOn && lastSourceId) {
      queryText = `
        SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
               source_created_on, raw_message, raw_payload
        FROM wf_canonical_staging.mariadb_raw_source_rows
        WHERE (source_created_on > $1 OR (source_created_on = $1 AND source_id > $2))
          AND (source_created_on < $3 OR (source_created_on = $3 AND source_id <= $4))
        ORDER BY source_created_on ASC, source_id ASC
        LIMIT $5;
      `;
      queryParams = [lastCreatedOn, lastSourceId, FROZEN_CURSOR.created_on, FROZEN_CURSOR.source_id, BATCH_SIZE];
    } else {
      queryText = `
        SELECT source_id, source_system, source_database, source_table, source_hash, source_record_id,
               source_created_on, raw_message, raw_payload
        FROM wf_canonical_staging.mariadb_raw_source_rows
        WHERE (source_created_on < $1 OR (source_created_on = $1 AND source_id <= $2))
        ORDER BY source_created_on ASC, source_id ASC
        LIMIT $3;
      `;
      queryParams = [FROZEN_CURSOR.created_on, FROZEN_CURSOR.source_id, BATCH_SIZE];
    }

    const res = await client.query(queryText, queryParams);
    const rows = res.rows;

    if (!rows || rows.length === 0) {
      console.log('[Canonical-Normalizer] No more rows in frozen milestone cohort.');
      hasMore = false;
      break;
    }

    const batchParents = [];

    for (const row of rows) {
      totalProcessed++;
      try {
        const norm = normalizeCanonicalParentChild(row);
        batchParents.push(norm.parent);

        if (norm.parent.review_flags && norm.parent.review_flags.length > 0) {
          reviewRequired++;
        } else {
          normalizedProposals++;
        }

        for (const child of norm.children) {
          if (child.trading_floor_eligible) tfEligible++;
          if (child.price_research_eligible) prEligible++;

          const curr = child.currency_status || 'UNKNOWN';
          currencyDistribution[curr] = (currencyDistribution[curr] || 0) + 1;

          const intVal = child.intent || 'UNKNOWN';
          intentDistribution[intVal] = (intentDistribution[intVal] || 0) + 1;
        }

        lastCreatedOn = row.source_created_on;
        lastSourceId = row.source_id;
      } catch (err) {
        normalizationErrors++;
        console.error(`[Normalization-Error] Row ${row.source_id}:`, err.message);
      }
    }

    // Upsert canonical batch via hardened RPC
    if (batchParents.length > 0) {
      await client.query(`
        SELECT public.upsert_mariadb_canonical_batch($1::jsonb);
      `, [JSON.stringify(batchParents)]);
    }

    // Update persistent checkpoint
    await client.query(`
      UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
      SET last_processed_created_on = $1,
          last_processed_source_id = $2,
          total_inputs_processed = $3,
          normalized_proposals_count = $4,
          review_required_count = $5,
          normalization_errors_count = $6,
          trading_floor_eligible_count = $7,
          price_research_eligible_count = $8,
          updated_at = NOW()
      WHERE job_name = $9;
    `, [lastCreatedOn, lastSourceId, totalProcessed, normalizedProposals, reviewRequired, normalizationErrors, tfEligible, prEligible, JOB_NAME]);

    if (totalProcessed % REPORT_INTERVAL === 0 || rows.length < BATCH_SIZE) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const rowsPerSec = (totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`[Progress] Processed ${totalProcessed.toLocaleString()} rows (${rowsPerSec} rows/sec, elapsed: ${elapsedSec}s) | Norm: ${normalizedProposals.toLocaleString()}, Review: ${reviewRequired.toLocaleString()}, Errors: ${normalizationErrors}`);
    }
  }

  // Mark completion
  await client.query(`
    UPDATE wf_canonical_staging.mariadb_normalization_checkpoints
    SET status = 'COMPLETED', updated_at = NOW()
    WHERE job_name = $1;
  `, [JOB_NAME]);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n============================================================`);
  console.log(`CANONICAL MILESTONE NORMALIZATION COMPLETE in ${durationSec}s`);
  console.log(`Total Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Normalized Proposals: ${normalizedProposals.toLocaleString()}`);
  console.log(`Review Required: ${reviewRequired.toLocaleString()}`);
  console.log(`Errors: ${normalizationErrors}`);
  console.log(`Trading Floor Eligible: ${tfEligible.toLocaleString()}`);
  console.log(`Price Research Eligible: ${prEligible.toLocaleString()}`);
  console.log(`============================================================\n`);

  await client.end();

  return {
    job_name: JOB_NAME,
    total_processed: totalProcessed,
    normalized_proposals: normalizedProposals,
    review_required: reviewRequired,
    normalization_errors: normalizationErrors,
    trading_floor_eligible: tfEligible,
    price_research_eligible: prEligible,
    currency_distribution: currencyDistribution,
    intent_distribution: intentDistribution,
    duration_seconds: Number(durationSec)
  };
}

module.exports = { runMilestoneNormalization };

if (require.main === module) {
  runMilestoneNormalization().catch(err => {
    console.error('FATAL_RUNNER_ERROR:', err);
    process.exit(1);
  });
}
