'use strict';

const { createHash } = require('node:crypto');
const {
  compactIdentityEvidence,
  confirmCatalogCandidate,
  rawSupportsReferenceToken,
} = require('../../api/_lib/catalog-confirmation.cjs');
const {
  boundedInt,
  supabaseFetch,
  writeJson,
} = require('./recovery-control.cjs');

const APPLY = process.env.APPLY_IDENTITY_STAGE === 'true';
const SCOPE = String(process.env.IDENTITY_SCOPE || 'RM_CONFLICTS').toUpperCase();
if (!['RM_CONFLICTS', 'IMAGE_BACKED', 'ALL', 'TWO_BRANDS'].includes(SCOPE)) {
  throw new Error('IDENTITY_SCOPE must be RM_CONFLICTS, IMAGE_BACKED, ALL, or TWO_BRANDS');
}
const LIMIT = boundedInt(process.env.IDENTITY_BATCH_SIZE, SCOPE === 'TWO_BRANDS' ? 250 : 100, 1, 1000);
const MAX_BATCHES = boundedInt(process.env.IDENTITY_MAX_BATCHES, 1, 1, 10000);
const REPORT_PATH = String(process.env.IDENTITY_REPORT_PATH || '').trim();
const LEGACY_ID_PREFIX = 'mysql_auction_watches_';
const ID_SHARDS = [
  { lower: null, upper: '4' },
  { lower: '4', upper: '8' },
  { lower: '8', upper: 'c' },
  { lower: 'c', upper: LEGACY_ID_PREFIX },
  { lower: LEGACY_ID_PREFIX, upper: `${LEGACY_ID_PREFIX}4` },
  { lower: `${LEGACY_ID_PREFIX}4`, upper: `${LEGACY_ID_PREFIX}8` },
  { lower: `${LEGACY_ID_PREFIX}8`, upper: `${LEGACY_ID_PREFIX}c` },
  { lower: `${LEGACY_ID_PREFIX}c`, upper: null },
];
const SHARD = parseShard(process.env.IDENTITY_SHARD);
const SNAPSHOT_AT = String(process.env.IDENTITY_SNAPSHOT_AT || '').trim();
const SNAPSHOT_KEY = SNAPSHOT_AT ? sha256(SNAPSHOT_AT).slice(0, 12) : 'no-snapshot';
const JOB_NAME = `identity-stage:${SCOPE.toLowerCase()}${SCOPE === 'TWO_BRANDS' ? `:v4:snapshot-${SNAPSHOT_KEY}:partition-${SHARD}` : ''}`;

function parseShard(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= ID_SHARDS.length) {
    throw new Error(`IDENTITY_SHARD must be 0 through ${ID_SHARDS.length - 1}`);
  }
  return parsed;
}

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function classifyIdentity(record) {
  const confirmation = confirmCatalogCandidate(record);
  const brandConflict = confirmation.reason === 'CATALOG_BRAND_CONFLICT';
  const dialConflict = confirmation.confirmed && confirmation.dialConfirmed === false;
  let status = 'UNVERIFIED';
  if (brandConflict || dialConflict) status = 'CONFLICT';
  else if (confirmation.confirmed) status = 'CATALOG_CONFIRMED';

  return {
    record_id: record.record_id || record.id,
    status,
    canonical_brand: confirmation.match?.brand || null,
    canonical_model: confirmation.match?.model || null,
    canonical_reference: confirmation.match?.reference || null,
    canonical_dial_color: confirmation.dialConfirmed ? record.dial_color || null : null,
    evidence: {
      source: 'deterministic_catalog_confirmation',
      reason: confirmation.reason || null,
      dial_confirmed: confirmation.dialConfirmed ?? null,
      source_brand: record.brand || null,
      source_model: record.model || null,
      source_reference: record.reference || null,
      source_dial_color: record.dial_color || null,
    },
  };
}

function classifyTwoBrandIdentity(record) {
  const recordId = record.record_id || record.id;
  const confirmation = confirmCatalogCandidate(record);
  const exactReferencePresent = rawSupportsReferenceToken(record.raw_message, record.reference)
    || (confirmation.match?.matchType === 'exact_alias'
      && rawSupportsReferenceToken(record.raw_message, confirmation.match.reference));
  const sourceModel = compactIdentityEvidence(record.model);
  const catalogModel = compactIdentityEvidence(confirmation.match?.model);
  const modelConflict = Boolean(sourceModel && catalogModel && sourceModel !== catalogModel);
  let status = 'UNVERIFIED';
  let reason = confirmation.reason || 'CATALOG_NOT_FOUND';

  if (confirmation.reason === 'CATALOG_BRAND_CONFLICT'
    || (confirmation.confirmed && confirmation.dialConfirmed === false)
    || modelConflict) {
    status = 'CONFLICT';
    reason = modelConflict
      ? 'CATALOG_MODEL_CONFLICT'
      : (confirmation.dialReason || confirmation.reason);
  } else if (!String(record.raw_message || '').trim()) {
    reason = 'RAW_EVIDENCE_MISSING';
  } else if (!exactReferencePresent) {
    reason = 'EXACT_REFERENCE_MISSING_FROM_RAW';
  } else if (!confirmation.confirmed) {
    reason = confirmation.reason || 'CATALOG_NOT_FOUND';
  } else if (!['exact', 'exact_alias'].includes(confirmation.match?.matchType)) {
    reason = 'CATALOG_MATCH_NOT_EXACT';
  } else if (!confirmation.match?.model) {
    reason = 'CATALOG_MODEL_UNCONFIRMED';
  } else if (confirmation.dialConfirmed !== true || !confirmation.canonicalDial) {
    reason = confirmation.dialReason || 'CATALOG_DIAL_UNCONFIRMED';
  } else {
    status = 'CATALOG_CONFIRMED';
    reason = 'CATALOG_CONFIRMED';
  }

  const confirmed = status === 'CATALOG_CONFIRMED';
  return {
    record_id: recordId,
    status,
    reason,
    canonical_brand: confirmed ? confirmation.match.brand : null,
    canonical_model: confirmed ? confirmation.match.model : null,
    canonical_reference: confirmed ? confirmation.match.reference : null,
    canonical_dial_color: confirmed ? confirmation.canonicalDial : null,
    evidence: {
      source: 'deterministic_two_brand_catalog_confirmation',
      reason,
      raw_message_sha256: sha256(record.raw_message),
      exact_reference_present_in_raw: exactReferencePresent,
      configuration_basis: exactReferencePresent ? 'EXACT_REFERENCE' : null,
      policy_version: 'two-brand-catalog-confirmation-v2',
      catalog_source: confirmation.match?.source || null,
      catalog_match_type: confirmation.match?.matchType || null,
      catalog_dial_confirmed: confirmation.dialConfirmed ?? null,
      source_brand: record.brand || null,
      source_model: record.model || null,
      source_reference: record.reference || null,
      source_dial_color: record.dial_color || null,
    },
  };
}

async function checkpoint() {
  const query = new URLSearchParams({
    select: 'last_record_id,rows_scanned,rows_written,metadata',
    job_name: `eq.${JOB_NAME}`,
    limit: '1',
  });
  const rows = await supabaseFetch(`/rest/v1/data_quality_remediation_checkpoints?${query}`);
  return rows?.[0] || { last_record_id: null, rows_scanned: 0, rows_written: 0 };
}

function scopeSource(scope) {
  if (scope === 'RM_CONFLICTS') {
    return {
      table: 'rm_identity_review_queue',
      idColumn: 'record_id',
      select: 'record_id,brand,model,reference,dial_color',
    };
  }
  if (scope === 'TWO_BRANDS') {
    return {
      table: 'watch_records',
      idColumn: 'id',
      select: 'id,brand,model,reference,dial_color,raw_message',
      brandFilter: 'in.("Rolex","Patek Philippe")',
    };
  }
  return {
    table: 'watch_records',
    idColumn: 'id',
    select: 'id,brand,model,reference,dial_color',
    imageFilter: scope === 'IMAGE_BACKED' ? '(has_images.eq.true,thumbnail_url.not.is.null)' : null,
  };
}

async function sourceRows(lastRecordId) {
  const source = scopeSource(SCOPE);
  const query = new URLSearchParams({
    select: source.select,
    order: `${source.idColumn}.asc`,
    limit: String(LIMIT),
  });
  const shard = ID_SHARDS[SHARD];
  if (lastRecordId) query.append(source.idColumn, `gt.${lastRecordId}`);
  else if (SCOPE === 'TWO_BRANDS' && shard.lower) query.append(source.idColumn, `gte.${shard.lower}`);
  if (SCOPE === 'TWO_BRANDS' && shard.upper) query.append(source.idColumn, `lt.${shard.upper}`);
  if (source.brandFilter) query.set('brand', source.brandFilter);
  if (SCOPE === 'TWO_BRANDS') {
    if (!SNAPSHOT_AT || !Number.isFinite(Date.parse(SNAPSHOT_AT))) {
      throw new Error('IDENTITY_SNAPSHOT_AT must be a valid timestamp for TWO_BRANDS');
    }
    // Historical imports legitimately have no created_at value. They are still
    // immutable source evidence and must not disappear from the frozen release.
    query.set('or', `(created_at.is.null,created_at.lte.${SNAPSHOT_AT})`);
  }
  if (source.imageFilter) query.set('or', source.imageFilter);
  return supabaseFetch(`/rest/v1/${source.table}?${query}`);
}

function batchToken({ expectedLastRecordId, lastRecordId, rows }) {
  return sha256(JSON.stringify({
    job_name: JOB_NAME,
    snapshot_at: SNAPSHOT_AT,
    expected_last_record_id: expectedLastRecordId || null,
    last_record_id: lastRecordId || null,
    record_ids: rows.map(row => row.record_id),
  }));
}

async function atomicApplyTwoBrandRows(rows, previous, batch) {
  const token = batchToken({
    expectedLastRecordId: previous.last_record_id,
    lastRecordId: batch.lastRecordId,
    rows,
  });
  const payload = {
    p_job_name: JOB_NAME,
    p_expected_last_record_id: previous.last_record_id || null,
    p_last_record_id: batch.lastRecordId,
    p_rows_scanned: batch.scanned,
    p_rows: rows,
    p_batch_token: token,
    p_metadata: {
      scope: SCOPE,
      shard: SHARD,
      batch_size: LIMIT,
      snapshot_at: SNAPSHOT_AT,
      policy_version: 'two-brand-catalog-confirmation-v2',
    },
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await supabaseFetch('/rest/v1/rpc/stage_listing_identity_classification_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    }
  }
  throw lastError;
}

async function applyRows(rows, previous, batch) {
  if (SCOPE === 'TWO_BRANDS') {
    return atomicApplyTwoBrandRows(rows, previous, batch);
  }
  let result = { written: 0, human_decisions_preserved: 0 };
  if (rows.length) {
    result = await supabaseFetch('/rest/v1/rpc/stage_listing_identity_classifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_rows: rows }),
    });
  }
  const lastRecordId = batch.lastRecordId || previous.last_record_id;
  await supabaseFetch('/rest/v1/data_quality_remediation_checkpoints?on_conflict=job_name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      job_name: JOB_NAME,
      last_record_id: lastRecordId,
      rows_scanned: Number(previous.rows_scanned || 0) + batch.scanned,
      rows_written: Number(previous.rows_written || 0) + Number(result?.written || 0),
      metadata: {
        scope: SCOPE,
        shard: SCOPE === 'TWO_BRANDS' ? SHARD : null,
        batch_size: LIMIT,
        last_batch_ids: rows.map(row => row.record_id),
        last_scanned_record_id: lastRecordId,
        human_decisions_preserved: Number(result?.human_decisions_preserved || 0),
      },
      updated_at: new Date().toISOString(),
    }),
  });
  return result;
}

async function run() {
  let previous = await checkpoint();
  if (SCOPE === 'TWO_BRANDS') {
    const checkpointSnapshot = String(previous.metadata?.snapshot_at || '').trim();
    if (checkpointSnapshot && checkpointSnapshot !== SNAPSHOT_AT) {
      throw new Error(`Checkpoint snapshot ${checkpointSnapshot} does not match IDENTITY_SNAPSHOT_AT ${SNAPSHOT_AT}`);
    }
  }
  let processed = 0;
  let classifiedCount = 0;
  let eligible = 0;
  let stagedAttempted = 0;
  let written = 0;
  let humanDecisionsPreserved = 0;
  let missing = 0;
  let firstRecordId = null;
  let lastRecordId = null;
  let completed = false;
  const counts = {};
  const reasons = {};
  const errors = [];
  const batches = APPLY ? MAX_BATCHES : 1;
  for (let batch = 0; batch < batches; batch += 1) {
    const source = await sourceRows(previous.last_record_id);
    if (!source.length) {
      completed = true;
      break;
    }
    const classified = [];
    for (const record of source) {
      try {
        classified.push(SCOPE === 'TWO_BRANDS'
          ? classifyTwoBrandIdentity(record)
          : classifyIdentity(record));
      } catch (error) {
        errors.push({
          record_id: record.record_id || record.id || null,
          error: error.message,
        });
      }
    }
    const sourceIdColumn = scopeSource(SCOPE).idColumn;
    firstRecordId ||= source[0]?.[sourceIdColumn] || null;
    lastRecordId = source.at(-1)?.[sourceIdColumn] || null;
    processed += source.length;
    classifiedCount += classified.length;
    for (const row of classified) {
      counts[row.status] = (counts[row.status] || 0) + 1;
      const reason = row.reason || row.evidence?.reason || row.status;
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
    const stageable = SCOPE === 'TWO_BRANDS'
      ? classified.filter(row => row.status === 'CATALOG_CONFIRMED')
      : classified;
    eligible += stageable.length;
    if (APPLY) {
      if (SCOPE === 'TWO_BRANDS' && errors.length) {
        throw new Error('Two-brand staging stopped before checkpointing because classification errors were found');
      }
      const result = await applyRows(stageable, previous, {
        lastRecordId,
        scanned: source.length,
      });
      stagedAttempted += Number(result?.attempted ?? stageable.length);
      written += Number(result?.written || 0);
      humanDecisionsPreserved += Number(result?.human_decisions_preserved || 0);
      missing += Number(result?.missing || 0);
      previous = {
        last_record_id: lastRecordId,
        rows_scanned: Number(previous.rows_scanned || 0) + source.length,
        rows_written: Number(previous.rows_written || 0) + Number(result?.written || 0),
        metadata: {
          ...(previous.metadata || {}),
          snapshot_at: SNAPSHOT_AT || null,
          eligible_total: result?.cumulative_eligible
            ?? Number(previous.metadata?.eligible_total || 0) + stageable.length,
          preserved_total: result?.cumulative_preserved
            ?? Number(previous.metadata?.preserved_total || 0)
              + Number(result?.human_decisions_preserved || 0),
          missing_total: result?.cumulative_missing
            ?? Number(previous.metadata?.missing_total || 0) + Number(result?.missing || 0),
        },
      };
    }
    if (source.length < LIMIT) {
      completed = true;
      break;
    }
  }
  const report = {
    event: 'identity_review_batch',
    dry_run: !APPLY,
    scope: SCOPE,
    shard: SCOPE === 'TWO_BRANDS' ? SHARD : null,
    processed,
    classified: classifiedCount,
    eligible_catalog_confirmations: eligible,
    staged_attempted: stagedAttempted,
    written,
    human_decisions_preserved: humanDecisionsPreserved,
    missing,
    batches: APPLY ? MAX_BATCHES : 1,
    completed,
    counts,
    reasons,
    errors,
    first_record_id: firstRecordId,
    last_record_id: lastRecordId,
    checkpoint: previous,
    reconciliation: {
      input_rows: processed,
      classified_rows: classifiedCount,
      error_rows: errors.length,
      reconciled: processed === classifiedCount + errors.length,
      equation: `${processed} = ${classifiedCount} + ${errors.length}`,
      catalog_staging_reconciled: !APPLY || SCOPE !== 'TWO_BRANDS'
        || eligible === stagedAttempted
          && stagedAttempted === written + humanDecisionsPreserved + missing,
      catalog_staging_equation: `${eligible} = ${written} + ${humanDecisionsPreserved} + ${missing}`,
    },
    safety: {
      watch_records_writes: 0,
      automated_human_approvals: 0,
      only_catalog_confirmed_rows_staged: SCOPE === 'TWO_BRANDS',
    },
  };
  if (REPORT_PATH) writeJson(REPORT_PATH, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'identity_review_batch_error',
      scope: SCOPE,
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ID_SHARDS,
  classifyIdentity,
  classifyTwoBrandIdentity,
  parseShard,
  scopeSource,
};
