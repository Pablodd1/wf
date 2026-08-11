'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  atomicJson,
  boundedInteger,
  readJsonLines,
  sha256,
  stableJson,
} = require('./lib.cjs');
const { buildPublicationReview } = require('./publication-review.cjs');
const { inputFingerprint, rpc } = require('./import-raw.cjs');

const STAGING_CONTRACT = 'wf-mariadb-normalized-staging-v1';
const PUBLIC_CATEGORIES = new Set(['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY']);

function config(env = process.env) {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MARIADB_NORMALIZED_RAW_INPUT',
    'MARIADB_NORMALIZED_MANIFEST',
    'MARIADB_RAW_IMPORT_RUN_KEY',
  ];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    baseUrl: String(env.SUPABASE_URL).replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    rawInput: path.resolve(env.MARIADB_NORMALIZED_RAW_INPUT),
    manifestPath: path.resolve(env.MARIADB_NORMALIZED_MANIFEST),
    rawImportRunKey: env.MARIADB_RAW_IMPORT_RUN_KEY,
    runKey: env.MARIADB_NORMALIZED_RUN_KEY || `mariadb-normalized-${new Date().toISOString().slice(0, 10)}`,
    batchSize: boundedInteger(env.MARIADB_NORMALIZED_BATCH_SIZE, 200, 10, 500, 'MARIADB_NORMALIZED_BATCH_SIZE'),
    maxRows: env.MARIADB_NORMALIZED_MAX_ROWS
      ? boundedInteger(env.MARIADB_NORMALIZED_MAX_ROWS, null, 1, 10_000_000, 'MARIADB_NORMALIZED_MAX_ROWS')
      : null,
    output: path.resolve(env.MARIADB_NORMALIZED_OUTPUT || 'audit-output/mariadb-live/normalized-staging-import'),
  };
}

function proposalFiles(manifest) {
  return (manifest.segments || []).map(segment => path.join(segment.directory, 'normalization-proposals.jsonl'));
}

function readManifest(runConfig) {
  if (!fs.existsSync(runConfig.rawInput)) throw new Error(`Raw input does not exist: ${runConfig.rawInput}`);
  if (!fs.existsSync(runConfig.manifestPath)) throw new Error(`Normalization manifest does not exist: ${runConfig.manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(runConfig.manifestPath, 'utf8'));
  if (manifest.source_coverage_reconciled !== true || Number(manifest.difference) !== 0) {
    throw new Error('Normalization manifest is not fully reconciled');
  }
  if (Number(manifest.totals?.error_rows) !== 0) throw new Error('Normalization manifest contains error rows');
  const files = proposalFiles(manifest);
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Normalization proposal segment does not exist: ${file}`);
  }
  return { manifest, files };
}

async function* proposals(files) {
  for (const file of files) {
    for await (const line of readJsonLines(file)) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

function compactCandidate(candidate) {
  if (!candidate) return null;
  return {
    brand: candidate.brand || null,
    model: candidate.model || null,
    reference: candidate.reference || null,
    dial_color: candidate.dial_color || null,
    condition: candidate.condition || null,
    listing_type: candidate.listing_type || null,
    price: candidate.price ? {
      amount_original: candidate.price.amount_original ?? null,
      currency_original: candidate.price.currency_original || null,
      amount_usd: candidate.price.amount_usd ?? null,
      raw_price_text: candidate.price.raw_price_text || null,
      currency_evidence: candidate.price.currency_evidence || null,
      analytics_currency_evidence_eligible: candidate.price.analytics_currency_evidence_eligible === true,
    } : null,
  };
}

function stagingRecord(source, proposal) {
  const review = buildPublicationReview(source, proposal);
  const candidate = compactCandidate(review.candidate);
  const materialization = review.bundle_status === 'SINGLE_CANDIDATE'
    && candidate
    && PUBLIC_CATEGORIES.has(review.category)
    && ['WTS', 'WTB'].includes(candidate.listing_type)
    ? 'SINGLE'
    : 'DEFERRED';
  const stableCandidate = {
    materialization,
    category: review.category,
    bundle_status: review.bundle_status,
    candidate,
    review_disposition: review.review_disposition,
    review_reasons: review.review_reasons,
    price_research_status: review.price_research_status,
  };
  return {
    contract: STAGING_CONTRACT,
    source_record_id: review.source_record_id,
    source_hash: review.source_hash,
    source_candidate_hash: sha256(stableJson(stableCandidate)),
    source_created_on: review.source_created_on || null,
    normalization_version: review.normalization_version,
    materialization,
    category: review.category,
    bundle_status: review.bundle_status,
    catalog_confirmed: proposal.catalog_confirmation?.confirmed === true,
    review_disposition: review.review_disposition,
    review_reasons: review.review_reasons,
    trading_floor_status: review.trading_floor_status,
    price_research_status: review.price_research_status,
    candidate,
    media: {
      source_media_key: review.media.source_media_key,
      source_media_url_candidate: review.media.source_media_url_candidate,
      exact_source_lineage: review.media.exact_source_lineage,
      public_image_eligible: false,
      review_reason: review.media.review_reason,
    },
    public_image_eligible: false,
    seller_public: {
      name: review.seller.public.name,
      location: review.seller.public.location,
      rating: null,
    },
    contact_publication_approved: false,
    rating_publication_status: 'UNVERIFIED_SOURCE_FIELD',
  };
}

function assertSafeTransport(record) {
  const serialized = JSON.stringify(record);
  for (const prohibited of ['raw_message', 'raw_payload', 'seller_phone', 'contact_number', 'from_number']) {
    if (Object.hasOwn(record, prohibited) || serialized.includes(`"${prohibited}"`)) {
      throw new Error(`Staging transport contains prohibited field: ${prohibited}`);
    }
  }
  if (record.public_image_eligible !== false || record.contact_publication_approved !== false) {
    throw new Error('Staging transport attempts to bypass image or contact review');
  }
  return record;
}

function prepareOutput(runConfig, fingerprint) {
  fs.mkdirSync(runConfig.output, { recursive: true });
  const checkpointPath = path.join(runConfig.output, 'checkpoint.json');
  const reconciliationPath = path.join(runConfig.output, 'reconciliation.json');
  let checkpoint = {
    contract: STAGING_CONTRACT,
    run_key: runConfig.runKey,
    raw_import_run_key: runConfig.rawImportRunKey,
    input_fingerprint: fingerprint,
    input_rows: 0,
    staged_rows: 0,
    existing_rows: 0,
    deferred_rows: 0,
    error_rows: 0,
    batch_sequence: 0,
    complete: false,
    started_at: new Date().toISOString(),
  };
  if (fs.existsSync(checkpointPath)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    if (checkpoint.contract !== STAGING_CONTRACT
      || checkpoint.run_key !== runConfig.runKey
      || checkpoint.raw_import_run_key !== runConfig.rawImportRunKey
      || checkpoint.input_fingerprint !== fingerprint) {
      throw new Error('Normalized-staging checkpoint does not match this immutable input/run configuration');
    }
    if (checkpoint.complete) throw new Error('Normalized-staging checkpoint is already complete');
  } else {
    atomicJson(checkpointPath, checkpoint);
  }
  return { checkpoint, checkpointPath, reconciliationPath };
}

async function submitBatch(runConfig, state, records, fetchImpl = fetch) {
  const batchToken = sha256(stableJson({
    contract: STAGING_CONTRACT,
    run_key: runConfig.runKey,
    expected_input_rows: state.input_rows,
    records: records.map(record => [record.source_record_id, record.source_hash, record.source_candidate_hash]),
  }));
  const result = await rpc(runConfig, 'ingest_mariadb_normalization_batch', {
    p_run_key: runConfig.runKey,
    p_raw_import_run_key: runConfig.rawImportRunKey,
    p_contract: STAGING_CONTRACT,
    p_input_fingerprint: state.input_fingerprint,
    p_batch_token: batchToken,
    p_expected_input_rows: state.input_rows,
    p_next_input_rows: state.input_rows + records.length,
    p_records: records,
  }, fetchImpl);
  const accounted = Number(result.staged_rows || 0)
    + Number(result.existing_rows || 0)
    + Number(result.deferred_rows || 0);
  if (Number(result.input_rows) !== records.length || accounted !== records.length || Number(result.error_rows || 0) !== 0) {
    throw new Error('Normalized-staging batch did not reconcile');
  }
  return result;
}

async function run(options = {}) {
  const runConfig = options.config || config();
  const fetchImpl = options.fetchImpl || fetch;
  const { manifest, files } = readManifest(runConfig);
  const fingerprint = inputFingerprint([runConfig.rawInput, runConfig.manifestPath, ...files]);
  const prepared = prepareOutput(runConfig, fingerprint);
  const state = { ...prepared.checkpoint };
  const maxRows = runConfig.maxRows ?? null;
  if (maxRows !== null && state.input_rows > maxRows) {
    throw new Error('Normalized-staging checkpoint is already beyond the requested canary boundary');
  }
  const proposalIterator = proposals(files)[Symbol.asyncIterator]();
  let sourceIndex = 0;
  let records = [];

  async function flush() {
    if (!records.length) return;
    const result = await submitBatch(runConfig, state, records, fetchImpl);
    state.input_rows += Number(result.input_rows);
    state.staged_rows += Number(result.staged_rows || 0);
    state.existing_rows += Number(result.existing_rows || 0);
    state.deferred_rows += Number(result.deferred_rows || 0);
    state.error_rows += Number(result.error_rows || 0);
    state.batch_sequence += 1;
    state.updated_at = new Date().toISOString();
    atomicJson(prepared.checkpointPath, state);
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_normalized_staging_checkpoint', ...result, batch_sequence: state.batch_sequence })}\n`);
    records = [];
  }

  for await (const line of readJsonLines(runConfig.rawInput)) {
    if (!line.trim()) continue;
    const proposalResult = await proposalIterator.next();
    if (proposalResult.done) throw new Error(`Normalization proposals ended before source row ${sourceIndex + 1}`);
    sourceIndex += 1;
    if (sourceIndex <= state.input_rows) continue;
    const source = JSON.parse(line);
    records.push(assertSafeTransport(stagingRecord(source, proposalResult.value)));
    if (records.length >= runConfig.batchSize) await flush();
    if (maxRows !== null && sourceIndex >= maxRows) {
      await flush();
      break;
    }
  }
  await flush();
  const partial = maxRows !== null && state.input_rows < Number(manifest.source_rows);
  if (partial) {
    if (state.input_rows !== sourceIndex
      || state.input_rows !== state.staged_rows + state.existing_rows + state.deferred_rows
      || state.error_rows !== 0) {
      throw new Error('Normalized-staging canary did not reconcile');
    }
    const report = {
      ...state,
      complete: false,
      partial: true,
      reconciled: true,
      requested_max_rows: maxRows,
      publication_writes: 0,
    };
    atomicJson(prepared.reconciliationPath, report);
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_normalized_staging_canary_complete', ...report })}\n`);
    return report;
  }
  const extraProposal = await proposalIterator.next();
  if (!extraProposal.done) throw new Error('Normalization proposals contain rows beyond the raw archive');
  if (sourceIndex !== Number(manifest.source_rows) || state.input_rows !== sourceIndex) {
    throw new Error(`Normalized-staging source coverage did not reconcile: ${state.input_rows}/${sourceIndex}/${manifest.source_rows}`);
  }

  const completion = await rpc(runConfig, 'complete_mariadb_normalization_import', {
    p_run_key: runConfig.runKey,
    p_expected_rows: state.input_rows,
    p_expected_staged_or_existing: state.staged_rows + state.existing_rows,
    p_expected_deferred: state.deferred_rows,
  }, fetchImpl);
  state.complete = completion?.status === 'NORMALIZATION_STAGED';
  state.completed_at = new Date().toISOString();
  const reconciled = state.complete
    && state.error_rows === 0
    && state.input_rows === state.staged_rows + state.existing_rows + state.deferred_rows;
  const report = { ...state, reconciled, publication_writes: 0 };
  atomicJson(prepared.reconciliationPath, report);
  atomicJson(prepared.checkpointPath, state);
  if (!reconciled) throw new Error('Completed normalized-staging import did not reconcile');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_normalized_staging_complete', ...report })}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'mariadb_normalized_staging_error',
      error_name: error.name || 'Error',
      error_message: error.message || String(error),
      publication_writes: 0,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  STAGING_CONTRACT,
  assertSafeTransport,
  compactCandidate,
  config,
  prepareOutput,
  proposalFiles,
  readManifest,
  run,
  stagingRecord,
  submitBatch,
};
