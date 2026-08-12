'use strict';

const { buildCorrectionPage } = require('./build-two-brand-price-canary.cjs');
const { boundedInteger } = require('./lib.cjs');

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `convert_from(decode('${base64}', 'base64'), 'UTF8')::jsonb`;
}

async function managementQuery(config, query, readOnly, fetchImpl = fetch) {
  let response;
  for (let attempt = 0; attempt < (readOnly ? 3 : 1); attempt += 1) {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${config.projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: readOnly }),
    });
    if (response.ok || ![502, 503, 504].includes(response.status) || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response.ok) {
    const body = await response.text();
    let message = 'database request rejected';
    try { message = JSON.parse(body)?.message || message; } catch {}
    throw new Error(`Supabase management query failed (${response.status}): ${String(message).slice(0, 300)}`);
  }
  return response.json();
}

async function safetySnapshot(config, fetchImpl) {
  const result = await managementQuery(config, `
    SELECT jsonb_build_object(
      'database_gib', round(pg_database_size(current_database())::numeric / 1073741824, 3),
      'staging_rows', (SELECT count(*) FROM staging.listings),
      'pending_jobs', (SELECT count(*) FROM jobs.processing_jobs WHERE lower(status::text) IN ('received','queued','processing')),
      'failed_jobs', (SELECT count(*) FROM jobs.processing_jobs WHERE lower(status::text) IN ('failed','dead_letter'))
    ) AS safety`, true, fetchImpl);
  const safety = result?.[0]?.safety;
  if (!safety) throw new Error('Safety snapshot is unavailable');
  if (Number(safety.database_gib) >= config.databaseLimitGib
    || config.databaseLimitGib - Number(safety.database_gib) < config.minimumHeadroomGib
    || Number(safety.pending_jobs) > config.maxPendingJobs
    || Number(safety.failed_jobs) > config.maxFailedJobs) {
    throw new Error('Capacity or processing-queue stop threshold reached');
  }
  return safety;
}

async function run(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = {
    accessToken: env.SUPABASE_ACCESS_TOKEN,
    projectRef: env.SUPABASE_PROJECT_REF,
    expectedProjectRef: env.EXPECTED_PROJECT_REF,
    normalizationRunKey: env.NORMALIZED_RUN_KEY,
    correctionRunKey: env.CORRECTION_RUN_KEY,
    policyVersion: env.CORRECTION_POLICY_VERSION || 'usd-default-dated-fx-v1',
    databaseLimitGib: Number(env.DATABASE_LIMIT_GIB),
    minimumHeadroomGib: Number(env.MINIMUM_HEADROOM_GIB),
    maxPendingJobs: boundedInteger(env.MAX_PENDING_JOBS, 1000, 0, 10_000_000, 'MAX_PENDING_JOBS'),
    maxFailedJobs: boundedInteger(env.MAX_FAILED_JOBS, 0, 0, 10_000_000, 'MAX_FAILED_JOBS'),
    pageSize: boundedInteger(env.CORRECTION_PAGE_SIZE, 500, 1, 500, 'CORRECTION_PAGE_SIZE'),
    maxBatches: boundedInteger(env.CORRECTION_MAX_BATCHES, 20, 1, 500, 'CORRECTION_MAX_BATCHES'),
  };
  if (!config.accessToken || config.projectRef !== config.expectedProjectRef) throw new Error('Pinned project credentials are unavailable');
  for (const key of [config.normalizationRunKey, config.correctionRunKey, config.policyVersion]) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(key || '')) throw new Error('Invalid run or policy key');
  }
  if (!(config.databaseLimitGib > 0) || !(config.minimumHeadroomGib >= 0)) throw new Error('Invalid capacity thresholds');

  const initialSafety = await safetySnapshot(config, fetchImpl);
  const existing = await managementQuery(config, `
    SELECT to_jsonb(run) AS run FROM staging.mariadb_price_policy_correction_runs AS run
    WHERE correction_run_key = ${sqlLiteral(config.correctionRunKey)}`, true, fetchImpl);
  let fxSnapshot = existing?.[0]?.run?.fx_snapshot || options.fxSnapshot;
  if (!fxSnapshot) throw new Error('A new correction run requires one dated FX snapshot');
  const started = await managementQuery(config, `
    SELECT public.start_mariadb_two_brand_price_correction(
      ${sqlLiteral(config.correctionRunKey)}, ${sqlLiteral(config.normalizationRunKey)},
      ${sqlLiteral(config.policyVersion)}, ${jsonSql(fxSnapshot)}
    ) AS run`, false, fetchImpl);
  let state = started?.[0]?.run;
  if (!state) throw new Error('Could not start or resume correction run');
  fxSnapshot = state.fx_snapshot;
  let batches = 0;

  while (state.status !== 'COMPLETE' && batches < config.maxBatches) {
    const safety = await safetySnapshot(config, fetchImpl);
    if (Number(safety.staging_rows) !== Number(initialSafety.staging_rows)) throw new Error('Staging row count changed during correction');
    const pageResult = await managementQuery(config, `
      SELECT public.qnsa_two_brand_price_correction_page(
        ${sqlLiteral(config.correctionRunKey)}, ${config.pageSize}
      ) AS page`, false, fetchImpl);
    const page = pageResult?.[0]?.page;
    const rows = page?.records || [];
    if (!rows.length) throw new Error('Non-complete correction run returned an empty cursor page');
    const built = buildCorrectionPage(rows, fxSnapshot, {
      runKey: config.normalizationRunKey,
      correctionRunKey: config.correctionRunKey,
      previousCursor: page.previous_cursor,
    });

    if (built.corrected_rows > 0) {
      const corrected = await managementQuery(config, `
        SELECT public.apply_mariadb_two_brand_price_policy_batch(
          ${sqlLiteral(config.normalizationRunKey)}, ${sqlLiteral(built.batch_token)}, ${jsonSql(built.records)}
        ) AS result`, false, fetchImpl);
      const result = corrected?.[0]?.result;
      if (Number(result?.input_rows) !== built.corrected_rows
        || Number(result?.corrected_rows) !== built.corrected_rows
        || Number(result?.duplicate_staging_rows_created) !== 0) throw new Error('Correction batch failed reconciliation');
    }

    const advanced = await managementQuery(config, `
      SELECT public.advance_mariadb_two_brand_price_correction(
        ${sqlLiteral(config.correctionRunKey)},
        ${built.previous_cursor ? `${sqlLiteral(built.previous_cursor)}::uuid` : 'NULL::uuid'},
        ${sqlLiteral(built.next_cursor)}::uuid,
        ${built.scanned_rows}, ${built.corrected_rows}, ${built.skipped_rows},
        ${built.batch_token ? sqlLiteral(built.batch_token) : 'NULL::text'}
      ) AS run`, false, fetchImpl);
    state = advanced?.[0]?.run;
    if (!state || Number(state.staging_rows_created) !== 0
      || Number(state.scanned_rows) !== Number(state.corrected_rows) + Number(state.skipped_rows)) {
      throw new Error('Durable correction checkpoint failed reconciliation');
    }
    batches += 1;
    process.stdout.write(`${JSON.stringify({
      event: 'two_brand_price_correction_checkpoint',
      batch_sequence: state.batch_sequence,
      batch_scanned_rows: built.scanned_rows,
      batch_corrected_rows: built.corrected_rows,
      batch_skipped_rows: built.skipped_rows,
      total_scanned_rows: state.scanned_rows,
      census_rows: state.census_rows,
      status: state.status,
      staging_row_delta: 0,
      raw_text_logged: false,
      pii_logged: false,
    })}\n`);
  }

  const finalSafety = await safetySnapshot(config, fetchImpl);
  if (Number(finalSafety.staging_rows) !== Number(initialSafety.staging_rows)) throw new Error('Correction created or removed staging rows');
  return {
    status: state.status,
    batches_processed: batches,
    census_rows: Number(state.census_rows),
    scanned_rows: Number(state.scanned_rows),
    corrected_rows: Number(state.corrected_rows),
    skipped_rows: Number(state.skipped_rows),
    staging_row_delta: 0,
  };
}

if (require.main === module) {
  const { fetchFxSnapshot } = require('./fetch-fx-snapshot.cjs');
  fetchFxSnapshot().then(fxSnapshot => run({ fxSnapshot })).then(result => {
    process.stdout.write(`${JSON.stringify({ event: 'two_brand_price_correction_run_complete', ...result })}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'two_brand_price_correction_error', error_name: error.name || 'Error',
      error_message: error.message || String(error), raw_text_logged: false, pii_logged: false,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { jsonSql, managementQuery, run, safetySnapshot, sqlLiteral };
