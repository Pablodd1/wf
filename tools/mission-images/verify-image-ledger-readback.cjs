'use strict';

const fs = require('node:fs');

const LEDGER_PATH = String(process.env.MEDIA_LEDGER_INPUT || '').trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function rest(resource, params) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${params}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : [];
}

async function count(resource, params) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${params}`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) throw new Error(`Supabase count ${response.status}: ${resource}`);
  return Number(response.headers.get('content-range')?.split('/')[1] || 0);
}

function inFilter(values) {
  return `in.(${values.map(value => `"${value}"`).join(',')})`;
}

async function run() {
  if (!LEDGER_PATH || !fs.existsSync(LEDGER_PATH)) throw new Error('MEDIA_LEDGER_INPUT must name an existing ledger');
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const rows = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')).rows || [];
  const watches = await rest('watch_records', new URLSearchParams({
    select: 'id,has_images,image_urls,thumbnail_url',
    id: inFilter(rows.map(row => row.record_id)),
  }));
  const manifest = await rest('media_manifest', new URLSearchParams({
    select: 'source_object_key,matched_record_id,public_url,migration_status,verification_status',
    source_object_key: inFilter(rows.map(row => row.source_object_key)),
  }));
  const [imageBackedTotal, manifestTotal, linkedManifestTotal, discoveredManifestTotal, reachableManifestTotal] = await Promise.all([
    count('watch_records', new URLSearchParams({ select: 'id', has_images: 'eq.true' })),
    count('media_manifest', new URLSearchParams({ select: 'source_object_key' })),
    count('media_manifest', new URLSearchParams({ select: 'source_object_key', migration_status: 'eq.linked' })),
    count('media_manifest', new URLSearchParams({ select: 'source_object_key', migration_status: 'eq.discovered' })),
    count('media_manifest', new URLSearchParams({ select: 'source_object_key', verification_status: 'eq.url_reachable' })),
  ]);

  const watchesById = new Map(watches.map(row => [row.id, row]));
  const manifestByKey = new Map(manifest.map(row => [row.source_object_key, row]));
  const failures = [];

  for (const expected of rows) {
    const watch = watchesById.get(expected.record_id);
    const media = manifestByKey.get(expected.source_object_key);
    if (!watch?.has_images || !watch?.image_urls?.includes(expected.public_url)) {
      failures.push({ record_id: expected.record_id, reason: 'WATCH_IMAGE_NOT_LINKED' });
    }
    if (
      media?.matched_record_id !== expected.record_id
      || media?.public_url !== expected.public_url
      || media?.migration_status !== 'linked'
      || media?.verification_status !== 'url_reachable'
    ) {
      failures.push({ record_id: expected.record_id, reason: 'MANIFEST_NOT_LINKED' });
    }
  }

  process.stdout.write(`${JSON.stringify({
    status: failures.length ? 'failed' : 'verified',
    expected: rows.length,
    watch_rows: watches.length,
    manifest_rows: manifest.length,
    totals: {
      image_backed_watch_records: imageBackedTotal,
      manifest_objects: manifestTotal,
      linked_manifest_objects: linkedManifestTotal,
      discovered_manifest_objects: discoveredManifestTotal,
      reachable_manifest_objects: reachableManifestTotal,
    },
    failures,
  }, null, 2)}\n`);
  if (failures.length) process.exitCode = 2;
}

run().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
  process.exitCode = 1;
});
