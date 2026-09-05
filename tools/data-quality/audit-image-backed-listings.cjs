'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');
const {
  supabaseFetch,
  writeCsv,
  writeJson,
} = require('./recovery-control.cjs');

async function keysetPaged({
  table,
  select,
  key,
  filters = {},
  pageSize = 1000,
  fetchPage = supabaseFetch,
}) {
  const rows = [];
  const seen = new Set();
  let cursor = null;
  while (true) {
    const query = new URLSearchParams({
      select,
      order: `${key}.asc`,
      limit: String(pageSize),
      ...filters,
    });
    if (cursor !== null) query.set(key, `gt.${cursor}`);
    const page = await fetchPage(`/rest/v1/${table}?${query}`);
    if (!Array.isArray(page) || page.length > pageSize) {
      throw new Error(`${table} returned an invalid page`);
    }
    for (const row of page) {
      const value = String(row?.[key] || '');
      if (!value || seen.has(value)) {
        throw new Error(`${table} keyset is missing or duplicate`);
      }
      seen.add(value);
      cursor = value;
      rows.push(row);
    }
    if (page.length < pageSize) return rows;
  }
}

function manifestIndexes(manifest) {
  const manifestsByRecord = new Map();
  const urlOwners = new Map();
  for (const item of manifest) {
    if (item.matched_record_id) {
      const entries = manifestsByRecord.get(item.matched_record_id) || [];
      entries.push(item);
      manifestsByRecord.set(item.matched_record_id, entries);
    }
    if (item.public_url && item.matched_record_id) {
      const owners = urlOwners.get(item.public_url) || new Set();
      owners.add(item.matched_record_id);
      urlOwners.set(item.public_url, owners);
    }
  }
  return { manifestsByRecord, urlOwners };
}

function auditImageRow(record, indexes) {
  const linked = indexes.manifestsByRecord.get(record.id) || [];
  const confirmation = confirmCatalogCandidate(record);
  const brandConflict = confirmation.reason === 'CATALOG_BRAND_CONFLICT';
  const dialConflict = confirmation.confirmed && confirmation.dialConfirmed === false;
  const duplicateOwner = linked.some(item => (indexes.urlOwners.get(item.public_url)?.size || 0) > 1);
  const manifestMissing = linked.length === 0;
  const issues = [
    manifestMissing && 'MANIFEST_MISSING',
    duplicateOwner && 'URL_LINKED_TO_MULTIPLE_RECORDS',
    brandConflict && 'CATALOG_BRAND_CONFLICT',
    dialConflict && 'CATALOG_DIAL_CONFLICT',
  ].filter(Boolean);
  return {
    record_id: record.id,
    brand: record.brand,
    model: record.model,
    reference: record.reference,
    dial_color: record.dial_color,
    thumbnail_url: record.thumbnail_url,
    manifest_objects: linked.length,
    image_status: issues.length ? 'REJECT_STRUCTURAL' : 'VISUAL_REVIEW_REQUIRED',
    issues: issues.join('|'),
    catalog_reason: confirmation.reason || '',
  };
}

function auditImageRows(records, manifest) {
  const indexes = manifestIndexes(manifest);
  return records.map(record => auditImageRow(record, indexes));
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function reconcileAudit(records, audited, errors) {
  const inputIds = records.map(row => row.id);
  const outputIds = audited.map(row => row.record_id);
  const errorIds = errors.map(row => row.record_id);
  const input = new Set(inputIds);
  const accounted = new Set([...outputIds, ...errorIds]);
  const missing = [...input].filter(id => !accounted.has(id)).sort();
  const extra = [...accounted].filter(id => !input.has(id)).sort();
  const overlap = outputIds.filter(id => errorIds.includes(id));
  const duplicateInput = duplicates(inputIds);
  const duplicateOutput = duplicates(outputIds);
  const duplicateErrors = duplicates(errorIds);
  const reconciled = (
    inputIds.length === outputIds.length + errorIds.length
    && missing.length === 0
    && extra.length === 0
    && overlap.length === 0
    && duplicateInput.length === 0
    && duplicateOutput.length === 0
    && duplicateErrors.length === 0
  );
  return {
    reconciled,
    equation: `${inputIds.length} = ${outputIds.length} + ${errorIds.length}`,
    input_rows: inputIds.length,
    input_unique: input.size,
    output_rows: outputIds.length,
    output_unique: new Set(outputIds).size,
    error_rows: errorIds.length,
    error_unique: new Set(errorIds).size,
    missing_count: missing.length,
    missing_record_ids: missing,
    extra_count: extra.length,
    extra_record_ids: extra,
    overlap_count: overlap.length,
    duplicate_input_ids: duplicateInput,
    duplicate_output_ids: duplicateOutput,
    duplicate_error_ids: duplicateErrors,
  };
}

function auditImageRowsReconciled(records, manifest) {
  const indexes = manifestIndexes(manifest);
  const audited = [];
  const errors = [];
  for (const record of records) {
    try {
      audited.push(auditImageRow(record, indexes));
    } catch (error) {
      errors.push({
        record_id: record.id,
        error_name: error.name || 'Error',
        error_message: String(error.message || error).slice(0, 500),
      });
    }
  }
  return { audited, errors, reconciliation: reconcileAudit(records, audited, errors) };
}

function keySequenceHash(keys) {
  const hash = crypto.createHash('sha256');
  for (const key of keys) hash.update(`${key}\n`);
  return hash.digest('hex');
}

async function authoritativeImageCounts(fetchCounts = supabaseFetch) {
  const result = await fetchCounts('/rest/v1/rpc/global_data_quality_blocker_counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const records = Number(result?.watch_records?.image_backed);
  const manifest = Number(result?.images?.manifest_linked);
  if (
    result?.exact !== true
    || !Number.isSafeInteger(records)
    || records < 0
    || !Number.isSafeInteger(manifest)
    || manifest < 0
  ) {
    throw new Error('Authoritative exact image counts are unavailable');
  }
  return { exact: true, records, manifest };
}

function reconcileAuthoritativeCounts(before, after, recordScan, manifestScan) {
  const reconciled = (
    before.exact === true
    && after.exact === true
    && before.records === after.records
    && before.manifest === after.manifest
    && before.records === recordScan.first_scan_rows
    && before.records === recordScan.second_scan_rows
    && before.manifest === manifestScan.first_scan_rows
    && before.manifest === manifestScan.second_scan_rows
  );
  return {
    reconciled,
    before,
    after,
    snapshot_completeness_proof: (
      'has_images=true is a subset of (has_images=true OR thumbnail_url IS NOT NULL); '
      + 'equality with the exact RPC image_backed count proves no thumbnail-only rows were omitted'
    ),
  };
}

async function exactKeysetScan(spec) {
  const firstRows = await keysetPaged(spec);
  const secondRows = await keysetPaged(spec);
  const firstKeys = firstRows.map(row => String(row[spec.key] || ''));
  const secondKeys = secondRows.map(row => String(row[spec.key] || ''));
  const firstUnique = new Set(firstKeys).size;
  const secondUnique = new Set(secondKeys).size;
  const firstHash = keySequenceHash(firstKeys);
  const secondHash = keySequenceHash(secondKeys);
  const orderedKeysIdentical = (
    firstKeys.length === secondKeys.length
    && firstKeys.every((key, index) => key === secondKeys[index])
  );
  return {
    rows: firstRows,
    reconciliation: {
      reconciled: (
        orderedKeysIdentical
        && firstUnique === firstRows.length
        && secondUnique === secondRows.length
        && firstHash === secondHash
      ),
      first_scan_rows: firstRows.length,
      first_scan_unique_keys: firstUnique,
      first_scan_sha256: firstHash,
      second_scan_rows: secondRows.length,
      second_scan_unique_keys: secondUnique,
      second_scan_sha256: secondHash,
      ordered_keys_identical: orderedKeysIdentical,
      canonicalization: 'UTF-8 key plus LF, PostgreSQL keyset order ascending',
    },
  };
}

async function run() {
  const authoritativeBefore = await authoritativeImageCounts();
  const [recordScan, manifestScan] = await Promise.all([
    exactKeysetScan({
      table: 'watch_records',
      select: 'id,brand,model,reference,dial_color,has_images,thumbnail_url',
      key: 'id',
      filters: { has_images: 'eq.true' },
    }),
    exactKeysetScan({
      table: 'media_manifest',
      select: 'source_object_key,public_url,matched_record_id,migration_status,verification_status',
      key: 'source_object_key',
      filters: { matched_record_id: 'not.is.null' },
    }),
  ]);
  const authoritativeAfter = await authoritativeImageCounts();
  const authoritative = reconcileAuthoritativeCounts(
    authoritativeBefore,
    authoritativeAfter,
    recordScan.reconciliation,
    manifestScan.reconciliation,
  );
  const { audited, errors, reconciliation } = auditImageRowsReconciled(
    recordScan.rows,
    manifestScan.rows,
  );
  const counts = audited.reduce((result, row) => {
    result[row.image_status] = (result[row.image_status] || 0) + 1;
    for (const issue of row.issues.split('|').filter(Boolean)) {
      result[issue] = (result[issue] || 0) + 1;
    }
    return result;
  }, {});
  const stamp = new Date().toISOString().slice(0, 10);
  const folder = process.env.IMAGE_AUDIT_OUTPUT
    || path.join('audit-output', 'data-quality', `image-backed-${stamp}`);
  const accepted = (
    recordScan.reconciliation.reconciled
    && manifestScan.reconciliation.reconciled
    && authoritative.reconciled
    && reconciliation.reconciled
    && errors.length === 0
  );
  const report = {
    accepted,
    records: recordScan.reconciliation,
    manifest: manifestScan.reconciliation,
    authoritative,
    output: reconciliation,
  };
  writeJson(path.join(folder, 'summary.json'), {
    generated_at: new Date().toISOString(),
    read_only: true,
    accepted,
    records_scanned: recordScan.rows.length,
    manifest_rows_scanned: manifestScan.rows.length,
    authoritative,
    counts,
    important: 'VISUAL_REVIEW_REQUIRED is not visual verification.',
  });
  writeCsv(path.join(folder, 'image-review.csv'), audited, [
    'record_id', 'brand', 'model', 'reference', 'dial_color', 'thumbnail_url',
    'manifest_objects', 'image_status', 'issues', 'catalog_reason',
  ]);
  writeCsv(path.join(folder, 'errors.csv'), errors, [
    'record_id', 'error_name', 'error_message',
  ]);
  writeJson(path.join(folder, 'reconciliation.json'), report);
  process.stdout.write(`${JSON.stringify({
    event: accepted ? 'image_backed_audit_complete' : 'image_backed_audit_blocked',
    output: folder,
    records_scanned: recordScan.rows.length,
    manifest_rows_scanned: manifestScan.rows.length,
    counts,
    reconciliation: report,
  }, null, 2)}\n`);
  if (!accepted) process.exitCode = 2;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({
      event: 'image_backed_audit_error',
      error: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  auditImageRows,
  auditImageRowsReconciled,
  authoritativeImageCounts,
  exactKeysetScan,
  keysetPaged,
  reconcileAuthoritativeCounts,
  reconcileAudit,
};
