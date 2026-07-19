'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const CSV_PATH = process.env.MEDIA_INVENTORY_CSV || 'C:/Users/jasme/Downloads/thecollective-prod_inventory.csv';
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const TARGET = Math.min(500, Math.max(1, Number(process.env.MEDIA_LINEAGE_LIMIT || 100)));
const CANDIDATE_LIMIT = Math.min(10000, Math.max(TARGET, Number(process.env.MEDIA_LINEAGE_CANDIDATE_LIMIT || TARGET * 12)));
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

function sourceIdentityAgrees(row, rawData) {
  const brand = normalizedIdentity(row?.brand);
  const sourceBrand = normalizedIdentity(rawData?.brand);
  const reference = normalizedIdentity(row?.reference);
  const sourceReferences = [rawData?.normalized_reference, rawData?.reference]
    .map(normalizedIdentity)
    .filter(Boolean);
  return Boolean(brand && sourceBrand && brand === sourceBrand && reference && sourceReferences.includes(reference));
}

function customerSafe(row, rawData) {
  return row && row.brand && !/^unknown$/i.test(row.brand) && validReference(row.reference) &&
    sourceIdentityAgrees(row, rawData) && !row.has_images && !(Array.isArray(row.image_urls) && row.image_urls.length) &&
    !['RECYCLE'].includes(String(row.verdict || '').toUpperCase()) &&
    !['MULTI', 'OTHER'].includes(String(row.listing_type || '').toUpperCase());
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
    if (foundByRecord.size >= CANDIDATE_LIMIT) break;
  }
  stream.destroy();

  const candidates = [...foundByRecord.values()];
  const safe = [];
  for (let index = 0; index < candidates.length && safe.length < TARGET; index += 50) {
    const batch = candidates.slice(index, index + 50);
    const watches = await fetchWatchRows(batch.map(item => item.record_id));
    const byId = new Map((watches || []).map(row => [row.id, row]));
    for (const item of batch) {
      const watch = byId.get(item.record_id);
      if (!customerSafe(watch, item.raw_data) || !(await reachable(item.public_url))) continue;
      safe.push({ ...item, verification_status: 'url_reachable', watch });
      if (safe.length >= TARGET) break;
    }
  }

  let databaseResult = null;
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
    candidate_limit: CANDIDATE_LIMIT,
    customer_safe_matches: safe.length,
    database_result: databaseResult,
    sample: safe.slice(0, 10).map(item => ({ record_id: item.record_id, brand: item.watch.brand, reference: item.watch.reference, url: item.public_url, source_identity_verified: true })),
  }, null, 2)}\n`);
  if (!safe.length) process.exitCode = 2;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { basename, customerSafe, normalizedIdentity, recordId, sourceIdentityAgrees, validReference };
