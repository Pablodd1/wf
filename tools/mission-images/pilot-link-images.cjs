'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');

const CSV_PATH = process.env.MEDIA_INVENTORY_CSV || 'C:/Users/jasme/Downloads/thecollective-prod_inventory.csv';
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const TARGET_IMAGES = Math.min(1000, Math.max(1, Number(process.env.MEDIA_PILOT_LIMIT || 100)));
const LOOKUP_BATCH = Math.min(100, Math.max(10, Number(process.env.MEDIA_LOOKUP_BATCH || 50)));
const MAX_SCANNED = Math.max(TARGET_IMAGES, Number(process.env.MEDIA_MAX_SCANNED || 25000));
const APPLY = String(process.env.APPLY_MEDIA_LINKS || '').toLowerCase() === 'true';
const VERIFY_URLS = String(process.env.VERIFY_MEDIA_URLS || 'true').toLowerCase() !== 'false';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const IMAGE_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);

function extractSourceId(key) {
  const uuid = String(key || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0].toLowerCase();
  const basename = path.posix.basename(String(key || ''));
  const objectId = basename.match(/(?:^|[_-])([0-9a-f]{12,24})(?=[_.-]|$)/i);
  return objectId ? objectId[1].toLowerCase() : '';
}

function candidateRecordIds(sourceId) {
  return [sourceId, `mysql_auctions_${sourceId}`, `mysql_auction_watches_${sourceId}`];
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function findMatches(candidates) {
  const possibleIds = [...new Set(candidates.flatMap(item => candidateRecordIds(item.source_id)))];
  const expression = possibleIds.map(id => `"${id}"`).join(',');
  const params = new URLSearchParams({ select: 'id', id: `in.(${expression})` });
  const rows = await supabase(`watch_records?${params.toString()}`);
  const bySource = new Map();
  for (const row of rows || []) {
    const sourceId = String(row.id).replace(/^mysql_(?:auction_watches|auctions)_/, '');
    if (!bySource.has(sourceId)) bySource.set(sourceId, row.id);
  }
  return bySource;
}

async function urlStatus(url) {
  if (!VERIFY_URLS) return 'not_checked';
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return response.ok ? 'url_reachable' : 'url_unreachable';
  } catch {
    return 'url_unreachable';
  }
}

async function run() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Inventory CSV not found: ${CSV_PATH}`);
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const matched = [];
  const seenKeys = new Set();
  let scanned = 0;
  let imageCandidates = 0;
  let unmatched = 0;
  let batch = [];

  async function resolveBatch() {
    if (!batch.length || matched.length >= TARGET_IMAGES) return;
    const matches = await findMatches(batch);
    for (const item of batch) {
      const recordId = matches.get(item.source_id);
      if (!recordId) { unmatched += 1; continue; }
      const verificationStatus = await urlStatus(item.public_url);
      if (verificationStatus === 'url_unreachable') continue;
      matched.push({ ...item, record_id: recordId, verification_status: verificationStatus });
      if (matched.length >= TARGET_IMAGES) break;
    }
    batch = [];
  }

  const stream = fs.createReadStream(CSV_PATH).pipe(csv());
  for await (const row of stream) {
    scanned += 1;
    if (scanned > MAX_SCANNED || matched.length >= TARGET_IMAGES) break;
    const key = String(row.Key || '').trim();
    const extension = path.posix.extname(key).toLowerCase();
    const sourceId = extractSourceId(key);
    if (!sourceId || !IMAGE_EXTENSIONS.has(extension) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    imageCandidates += 1;
    batch.push({
      source_object_key: key,
      source_bucket: row.Bucket || 'thecollective-prod',
      source_id: sourceId,
      public_url: `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`,
      mime_type: IMAGE_EXTENSIONS.get(extension),
      source_size: String(row.Size || ''),
      source_etag: String(row.ETag || '').replace(/^"|"$/g, ''),
      source_modified_at: String(row.LastModified || ''),
    });
    if (batch.length >= LOOKUP_BATCH) await resolveBatch();
  }
  await resolveBatch();
  stream.destroy();

  let databaseResult = null;
  if (APPLY && matched.length) {
    databaseResult = await supabase('rpc/attach_listing_media_batch', {
      method: 'POST',
      body: JSON.stringify({ payload: matched }),
    });
  }

  const report = {
    status: matched.length >= TARGET_IMAGES ? 'pilot_target_met' : 'pilot_target_not_met',
    mode: APPLY ? 'apply' : 'dry_run',
    csv_path: CSV_PATH,
    scanned_rows: scanned,
    image_candidates: imageCandidates,
    unmatched_candidates: unmatched,
    matched_images: matched.length,
    distinct_records: new Set(matched.map(item => item.record_id)).size,
    requested_images: TARGET_IMAGES,
    database_result: databaseResult,
    sample: matched.slice(0, 10).map(item => ({ record_id: item.record_id, source_object_key: item.source_object_key, public_url: item.public_url })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!matched.length) process.exitCode = 2;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { extractSourceId, candidateRecordIds };
