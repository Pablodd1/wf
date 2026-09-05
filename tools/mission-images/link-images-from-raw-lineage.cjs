'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const CSV_PATH = process.env.MEDIA_INVENTORY_CSV || 'C:/Users/jasme/Downloads/thecollective-prod_inventory.csv';
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const TARGET = Math.min(1000, Math.max(1, Number(process.env.MEDIA_LINEAGE_LIMIT || 100)));
const REQUESTED_BRAND = String(process.env.MEDIA_BRAND || '').trim();
const LEDGER_OUTPUT = String(process.env.MEDIA_LEDGER_OUTPUT || '').trim();
const APPLY = String(process.env.APPLY_MEDIA_LINKS || '').toLowerCase() === 'true';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MIME = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']]);
const IMAGE_FIELDS = ['front_image', 'back_image', 'side_image', 'other_image1', 'other_image2', 'other_image3', 'image', 'image_url', 'thumbnail_url'];

function basename(value) {
  return path.posix.basename(String(value || '').replace(/\\/g, '/')).toLowerCase();
}

function recordId(sourceTable, sourceId) {
  return `mysql_${String(sourceTable || '').replace(/[^a-z0-9_]/gi, '_')}_${sourceId}`;
}

function validReference(value) {
  const ref = String(value || '').trim();
  return ref.length >= 3 && !/^(?:19|20)\d{2}Y?$/i.test(ref) && !/^UNKNOWN$/i.test(ref);
}

function normalizedIdentity(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function requestedBrandMatches(value) {
  return !REQUESTED_BRAND || normalizedIdentity(value) === normalizedIdentity(REQUESTED_BRAND);
}

function sourceIdentityAgrees(row, rawData) {
  const brand = normalizedIdentity(row?.brand);
  const sourceBrand = normalizedIdentity(rawData?.brand);
  const reference = normalizedIdentity(row?.reference);
  const sourceReferences = [rawData?.normalized_reference, rawData?.reference]
    .map(normalizedIdentity)
    .filter(Boolean);
  return Boolean(brand && sourceBrand && brand === sourceBrand && reference && sourceReferences.includes(reference));
}

function customerSafeReasons(row, rawData) {
  if (!row) return ['WATCH_RECORD_NOT_FOUND'];
  const reasons = [];
  if (!row.brand || /^unknown$/i.test(row.brand)) reasons.push('BRAND_MISSING_OR_UNKNOWN');
  if (!validReference(row.reference)) reasons.push('REFERENCE_INVALID');
  if (!sourceIdentityAgrees(row, rawData)) reasons.push('SOURCE_IDENTITY_DISAGREES');
  if (row.has_images || (Array.isArray(row.image_urls) && row.image_urls.length)) reasons.push('ALREADY_HAS_IMAGES');
  const verdict = String(row.verdict || '').toUpperCase();
  if (verdict === 'RECYCLE') reasons.push('RECYCLE');
  if (/MULTI|BUNDLE/.test(verdict)) reasons.push('MULTI_OR_BUNDLE_VERDICT');
  if (['MULTI', 'OTHER'].includes(String(row.listing_type || '').toUpperCase())) reasons.push('DISALLOWED_LISTING_TYPE');
  return reasons;
}

function customerSafe(row, rawData) {
  return customerSafeReasons(row, rawData).length === 0;
}

function ledgerRow(item) {
  return {
    record_id: item.record_id,
    source_object_key: item.source_object_key,
    public_url: item.public_url,
    brand: item.watch.brand,
    reference: item.watch.reference,
    listing_type: item.watch.listing_type,
    verdict: item.watch.verdict,
    source_identity_verified: true,
  };
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function loadRawLineage() {
  const byFilename = new Map();
  const ambiguousFilenames = new Set();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const params = new URLSearchParams({ select: 'source_table,source_id,raw_data', order: 'id.asc' });
    const rows = await supabase(`raw_records?${params}`, { headers: { Range: `${offset}-${offset + pageSize - 1}` } });
    for (const row of rows || []) {
      if (!requestedBrandMatches(row.raw_data?.brand)) continue;
      for (const field of IMAGE_FIELDS) {
        const filename = basename(row.raw_data?.[field]);
        if (!filename || !MIME.has(path.extname(filename).toLowerCase())) continue;
        const link = { source_table: row.source_table, source_id: row.source_id, record_id: recordId(row.source_table, row.source_id), raw_data: row.raw_data };
        const existing = byFilename.get(filename);
        if (existing && existing.record_id !== link.record_id) {
          ambiguousFilenames.add(filename);
          byFilename.delete(filename);
        } else if (!ambiguousFilenames.has(filename)) {
          byFilename.set(filename, link);
        }
      }
    }
    if (!rows || rows.length < pageSize) break;
    offset += pageSize;
  }
  return { byFilename, ambiguousFilenames };
}

async function fetchWatchRows(ids) {
  if (!ids.length) return [];
  const expression = ids.map(id => `"${id}"`).join(',');
  const params = new URLSearchParams({
    select: 'id,brand,reference,dial_color,condition,price_usd,listing_type,verdict,has_images,image_urls,thumbnail_url',
    id: `in.(${expression})`,
  });
  return supabase(`watch_records?${params}`);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch { return false; }
}

async function run() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Inventory CSV not found: ${CSV_PATH}`);
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const { byFilename: lineage, ambiguousFilenames } = await loadRawLineage();
  const foundByRecord = new Map();
  let scanned = 0;
  const stream = fs.createReadStream(CSV_PATH).pipe(csv());
  for await (const row of stream) {
    scanned += 1;
    const key = String(row.Key || '').trim();
    const filename = basename(key);
    const link = lineage.get(filename);
    if (!link || foundByRecord.has(link.record_id)) continue;
    const extension = path.extname(filename).toLowerCase();
    const publicUrl = `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
    foundByRecord.set(link.record_id, {
      ...link,
      source_object_key: key,
      source_bucket: row.Bucket || 'thecollective-prod',
      public_url: publicUrl,
      mime_type: MIME.get(extension),
      source_size: String(row.Size || ''),
      source_etag: String(row.ETag || '').replace(/^"|"$/g, ''),
      source_modified_at: String(row.LastModified || ''),
    });
    if (foundByRecord.size >= TARGET * 5) break;
  }
  stream.destroy();

  const candidates = [...foundByRecord.values()];
  const safe = [];
  const rejection_counts = {};
  let watch_rows_found = 0;
  for (let index = 0; index < candidates.length && safe.length < TARGET; index += 50) {
    const batch = candidates.slice(index, index + 50);
    const watches = await fetchWatchRows(batch.map(item => item.record_id));
    const byId = new Map((watches || []).map(row => [row.id, row]));
    watch_rows_found += byId.size;
    for (const item of batch) {
      const watch = byId.get(item.record_id);
      const reasons = customerSafeReasons(watch, item.raw_data);
      if (watch && !requestedBrandMatches(watch.brand)) reasons.push('REQUESTED_BRAND_DISAGREES');
      if (!reasons.length && !(await reachable(item.public_url))) reasons.push('URL_UNREACHABLE');
      if (reasons.length) {
        for (const reason of reasons) rejection_counts[reason] = (rejection_counts[reason] || 0) + 1;
        continue;
      }
      safe.push({ ...item, verification_status: 'url_reachable', watch });
      if (safe.length >= TARGET) break;
    }
  }

  let databaseResult = null;
  let ledgerOutput = null;
  if (LEDGER_OUTPUT) {
    ledgerOutput = path.resolve(LEDGER_OUTPUT);
    fs.mkdirSync(path.dirname(ledgerOutput), { recursive: true });
    fs.writeFileSync(ledgerOutput, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      requested_brand: REQUESTED_BRAND || null,
      rows: safe.map(ledgerRow),
    }, null, 2)}\n`);
  }
  if (APPLY && safe.length) {
    databaseResult = await supabase('rpc/attach_listing_media_batch', {
      method: 'POST',
      body: JSON.stringify({ payload: safe.map(({ watch, raw_data, ...item }) => item) }),
    });
  }

  process.stdout.write(`${JSON.stringify({
    status: safe.length >= TARGET ? 'target_met' : 'target_not_met',
    mode: APPLY ? 'apply' : 'dry_run',
    raw_image_filenames: lineage.size,
    ambiguous_image_filenames: ambiguousFilenames.size,
    csv_rows_scanned: scanned,
    lineage_matches: candidates.length,
    watch_rows_found,
    rejection_counts,
    customer_safe_matches: safe.length,
    ledger_output: ledgerOutput,
    requested_brand: REQUESTED_BRAND || null,
    database_result: databaseResult,
    sample: safe.slice(0, 10).map(ledgerRow),
  }, null, 2)}\n`);
  if (!safe.length) process.exitCode = 2;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { basename, customerSafe, customerSafeReasons, ledgerRow, normalizedIdentity, recordId, requestedBrandMatches, sourceIdentityAgrees, validReference };
