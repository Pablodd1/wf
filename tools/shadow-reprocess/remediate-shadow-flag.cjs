'use strict';

// Re-evaluates one bounded shadow-review bucket after a deterministic parser
// improvement. It never updates public.watch_records or checkpoints.
const { analyzeRecord } = require('./shadow-reprocess.cjs');

const ALLOWED_FLAGS = new Set([
  'PRICE_PARSE_FAILED',
  'CURRENCY_AMBIGUOUS',
  'BUNDLE_SPLIT_REQUIRED',
  'NO_CANDIDATE',
]);

const baseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const flag = String(process.env.REMEDIATION_FLAG || 'PRICE_PARSE_FAILED').trim().toUpperCase();
const batchSize = Math.max(25, Math.min(Number(process.env.REMEDIATION_BATCH_SIZE || 250), 1000));
const maxRows = Math.max(1, Math.min(Number(process.env.REMEDIATION_MAX_ROWS || 1000), 100000));
const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const sourceLookupChunkSize = 100;
const maxUnresolved = Math.max(1, Math.min(Number(process.env.REMEDIATION_MAX_UNRESOLVED || 25), 250));

if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');
if (!ALLOWED_FLAGS.has(flag)) throw new Error(`Unsupported REMEDIATION_FLAG: ${flag}`);

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

function sourceIdFilter(ids) {
  return `in.(${ids.map(id => String(id).replace(/[,()]/g, '')).join(',')})`;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchSourceRecords(sourceIds) {
  const recordGroups = await Promise.all(chunk(sourceIds, sourceLookupChunkSize).map(async ids => {
    const recordParams = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,parser_version',
      id: sourceIdFilter(ids),
    });
    return rest(`watch_records?${recordParams.toString()}`);
  }));
  return recordGroups.flat();
}

async function run() {
  let processed = 0;
  let cleared = 0;
  let stillFlagged = 0;
  const unresolvedSourceIds = new Set();
  const targetRows = dryRun ? Math.min(maxRows, batchSize) : maxRows;

  while (processed < targetRows) {
    const limit = Math.min(batchSize, targetRows - processed);
    const params = new URLSearchParams({
      select: 'source_record_id',
      review_status: 'eq.PENDING',
      change_flags: `cs.{${flag}}`,
      limit: String(limit),
    });
    if (unresolvedSourceIds.size) {
      params.set('source_record_id', `not.in.(${[...unresolvedSourceIds].join(',')})`);
    }
    const shadowRows = await rest(`normalization_shadow_v4?${params.toString()}`);
    if (!shadowRows?.length) break;

    const sourceIds = shadowRows.map(row => row.source_record_id).filter(Boolean);
    const records = await fetchSourceRecords(sourceIds);
    const proposals = (records || []).map(analyzeRecord);
    processed += proposals.length;
    for (const proposal of proposals) {
      if (proposal.change_flags.includes(flag)) {
        stillFlagged++;
        unresolvedSourceIds.add(proposal.source_record_id);
      }
      else cleared++;
    }

    if (!dryRun && proposals.length) {
      await rest('normalization_shadow_v4?on_conflict=source_record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(proposals),
      });
    }
    console.log(JSON.stringify({
      event: 'remediation_batch',
      flag,
      dryRun,
      processed,
      cleared,
      stillFlagged,
      lastSourceId: sourceIds[sourceIds.length - 1] || null,
    }));

    // Keep individual genuine failures in review while continuing with rows the
    // deterministic source-price fix can safely resolve. The cap keeps the
    // REST filter short and hands unusually dirty batches back to review.
    if (!dryRun && unresolvedSourceIds.size >= maxUnresolved) break;
  }

  console.log(JSON.stringify({
    event: 'remediation_complete',
    flag,
    dryRun,
    processed,
    cleared,
    stillFlagged,
    unresolved: unresolvedSourceIds.size,
    maxUnresolved,
  }));
}

run().catch(error => {
  console.error(JSON.stringify({ event: 'remediation_error', flag, error: error.message }));
  process.exitCode = 1;
});
