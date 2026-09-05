'use strict';

const fs = require('node:fs');
const path = require('node:path');
const csv = require('csv-parser');
const { extractSourceId } = require('./pilot-link-images.cjs');

const CSV_PATH = process.env.MEDIA_INVENTORY_CSV || 'C:/Users/jasme/Downloads/thecollective-prod_inventory.csv';
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const LIMIT = Math.min(1000, Math.max(1, Number(process.env.MEDIA_MANIFEST_LIMIT || 100)));
const APPLY = String(process.env.APPLY_MEDIA_MANIFEST || '').toLowerCase() === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MIME = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']]);

async function reachable(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch { return false; }
}

async function upsert(rows) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/media_manifest?on_conflict=source_object_key`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function run() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Inventory CSV not found: ${CSV_PATH}`);
  if (APPLY && (!SUPABASE_URL || !SERVICE_KEY)) throw new Error('Supabase service credentials are required to apply');

  const selected = [];
  const seen = new Set();
  let scanned = 0;
  let unreachable = 0;
  const stream = fs.createReadStream(CSV_PATH).pipe(csv());

  for await (const row of stream) {
    scanned += 1;
    const key = String(row.Key || '').trim();
    const extension = path.posix.extname(key).toLowerCase();
    const sourceId = extractSourceId(key);
    if (!sourceId || !MIME.has(extension) || seen.has(key)) continue;
    seen.add(key);
    const publicUrl = `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
    if (!(await reachable(publicUrl))) { unreachable += 1; continue; }
    selected.push({
      source_object_key: key,
      source_bucket: row.Bucket || 'thecollective-prod',
      extracted_source_id: sourceId,
      public_url: publicUrl,
      mime_type: MIME.get(extension),
      source_size: Number(row.Size) || null,
      source_etag: String(row.ETag || '').replace(/^"|"$/g, ''),
      source_modified_at: row.LastModified || null,
      migration_status: 'discovered',
      verification_status: 'url_reachable',
      error_code: null,
    });
    if (selected.length >= LIMIT) break;
  }
  stream.destroy();

  const written = APPLY && selected.length ? await upsert(selected) : [];
  process.stdout.write(`${JSON.stringify({
    status: selected.length === LIMIT ? 'target_met' : 'target_not_met',
    mode: APPLY ? 'apply' : 'dry_run',
    scanned_rows: scanned,
    reachable_images: selected.length,
    unreachable_images: unreachable,
    manifest_rows_written: written.length,
    listing_rows_modified: 0,
    sample: selected.slice(0, 5),
  }, null, 2)}\n`);
}

run().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
  process.exitCode = 1;
});
