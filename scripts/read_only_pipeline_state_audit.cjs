'use strict';

/**
 * Aggregate-only production pipeline audit.
 *
 * This script performs HEAD/GET requests only. It never sends a request body,
 * calls an RPC, or mutates source, raw, jobs, staging, or public records.
 */

const JOB_STATUSES = [
  'received', 'queued', 'processing', 'normalized', 'needs_review',
  'duplicate', 'failed', 'rejected',
];
const TRADING_STATUSES = [
  'published', 'published_pending_verification',
  'bundle_pending_separation', 'suppressed_exact_duplicate',
];
const RESEARCH_STATUSES = [
  'eligible', 'provisional_needs_review', 'ineligible_no_price',
  'ineligible_bundle', 'ineligible_currency', 'ineligible_identity',
];

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function aggregateCheckpointBrands(rows) {
  const brands = new Map();
  for (const row of rows) {
    const brand = row.brand_scope || 'Unspecified';
    const current = brands.get(brand) || {
      brand,
      files: 0,
      complete_files: 0,
      expected_rows: 0,
      rows_scanned: 0,
      rows_inserted: 0,
      duplicate_rows_held: 0,
      errors: 0,
    };
    current.files += 1;
    current.complete_files += Number(row.status === 'COMPLETE');
    current.expected_rows += Number(row.expected_rows || 0);
    current.rows_scanned += Number(row.rows_scanned || 0);
    current.rows_inserted += Number(row.rows_inserted || 0);
    current.duplicate_rows_held += Number(row.rows_duplicate_held || 0);
    current.errors += Number(row.rows_errors || 0);
    brands.set(brand, current);
  }
  return [...brands.values()].sort((left, right) => (
    right.rows_inserted - left.rows_inserted || left.brand.localeCompare(right.brand)
  ));
}

async function runAudit(env = process.env) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and a Supabase service key are required');
  }
  const headers = (schema, preferCount = false) => ({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(preferCount ? { Prefer: 'count=exact' } : {}),
    ...(schema === 'public' ? {} : { 'Accept-Profile': schema }),
  });
  const exactCount = async (schema, table, query = '') => {
    const suffix = query ? `&${query}` : '';
    const response = await fetch(`${baseUrl}/rest/v1/${table}?select=id${suffix}`, {
      method: 'HEAD',
      headers: headers(schema, true),
      signal: AbortSignal.timeout(60_000),
    });
    const range = response.headers.get('content-range') || '';
    return {
      schema,
      table,
      query: query || null,
      ok: response.ok,
      http_status: response.status,
      count: response.ok && range.includes('/') ? Number(range.split('/')[1]) : null,
    };
  };
  const selectRows = async (table, select, order, limit) => {
    const params = new URLSearchParams({ select, order, limit: String(limit) });
    const response = await fetch(`${baseUrl}/rest/v1/${table}?${params}`, {
      headers: headers('public'),
      signal: AbortSignal.timeout(60_000),
    });
    return {
      ok: response.ok,
      http_status: response.status,
      rows: response.ok ? await response.json() : [],
    };
  };
  const countRequests = [
    exactCount('raw', 'payloads'),
    exactCount('jobs', 'processing_jobs'),
    ...JOB_STATUSES.map(status => exactCount('jobs', 'processing_jobs', `status=eq.${status}`)),
    exactCount('staging', 'listings'),
    exactCount('staging', 'listings', 'parent_id=not.is.null'),
    exactCount('staging', 'listings', 'is_bundle=eq.true'),
    ...TRADING_STATUSES.map(status => exactCount(
      'staging', 'listings', `trading_floor_status=eq.${status}`,
    )),
    ...RESEARCH_STATUSES.map(status => exactCount(
      'staging', 'listings', `price_research_status=eq.${status}`,
    )),
  ];

  const [counts, accountability, checkpoints] = await Promise.all([
    Promise.all(countRequests),
    selectRows(
      'source_pipeline_accountability',
      'source_key,source_platform,pipeline_status,observed_at,source_input_rows,immutable_raw_rows,normalization_proposal_rows,collection_error_rows,normalization_error_rows,source_reconciled,normalization_reconciled,parser_version,customer_record_writes',
      'observed_at.desc',
      20,
    ),
    selectRows(
      'reviewed_workbook_import_checkpoints',
      'brand_scope,expected_rows,rows_scanned,rows_inserted,rows_duplicate_held,rows_errors,status',
      'brand_scope.asc',
      1_000,
    ),
  ]);

  const checkpointRows = checkpoints.rows;
  const checkpointSummary = {
    observable: checkpoints.ok,
    http_status: checkpoints.http_status,
    files: checkpointRows.length,
    complete_files: checkpointRows.filter(row => row.status === 'COMPLETE').length,
    expected_rows: sum(checkpointRows, 'expected_rows'),
    rows_scanned: sum(checkpointRows, 'rows_scanned'),
    rows_inserted: sum(checkpointRows, 'rows_inserted'),
    duplicate_rows_held: sum(checkpointRows, 'rows_duplicate_held'),
    errors: sum(checkpointRows, 'rows_errors'),
    reconciled: checkpointRows.length > 0
      && sum(checkpointRows, 'rows_scanned') === (
        sum(checkpointRows, 'rows_inserted')
        + sum(checkpointRows, 'rows_duplicate_held')
        + sum(checkpointRows, 'rows_errors')
      ),
    brands: aggregateCheckpointBrands(checkpointRows),
  };

  return {
    audit_mode: 'READ_ONLY_AGGREGATES',
    audited_at: new Date().toISOString(),
    pipeline_counts: counts,
    accountability: {
      observable: accountability.ok,
      http_status: accountability.http_status,
      rows: accountability.rows,
    },
    reviewed_workbook_checkpoints: checkpointSummary,
  };
}

if (require.main === module) {
  runAudit().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ audit_mode: 'READ_ONLY_AGGREGATES', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { runAudit };
