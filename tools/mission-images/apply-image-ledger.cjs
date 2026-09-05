'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  customerSafeReasons,
  normalizedIdentity,
} = require('./link-images-from-raw-lineage.cjs');

const LEDGER_PATH = String(process.env.MEDIA_LEDGER_INPUT || '').trim();
const EXPECTED_SHA = String(process.env.MEDIA_LEDGER_SHA256 || '').trim().toLowerCase();
const APPLY = String(process.env.APPLY_MEDIA_LEDGER || '').toLowerCase() === 'true';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUBLIC_BASE = String(process.env.DO_PUBLIC_BASE_URL || 'https://thecollective-prod.nyc3.digitaloceanspaces.com/').replace(/\/+$/, '');
const MIME = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function expectedUrl(objectKey) {
  return `${PUBLIC_BASE}/${String(objectKey).split('/').map(encodeURIComponent).join('/')}`;
}

function sourceId(recordId) {
  return String(recordId || '').match(/^mysql_(?:auction_watches|auctions)_(.+)$/)?.[1] || '';
}

function validateLedger(ledger, expectedHash, actualHash) {
  const errors = [];
  if (!expectedHash || expectedHash !== actualHash) errors.push('LEDGER_SHA256_MISMATCH');
  if (!Array.isArray(ledger?.rows) || !ledger.rows.length || ledger.rows.length > 1000) errors.push('LEDGER_ROW_COUNT_INVALID');
  const ids = new Set();
  for (const row of ledger?.rows || []) {
    if (!row.record_id || ids.has(row.record_id)) errors.push('RECORD_ID_MISSING_OR_DUPLICATE');
    if (!sourceId(row.record_id)) errors.push('SOURCE_ID_NOT_DERIVABLE');
    ids.add(row.record_id);
    if (!row.source_identity_verified) errors.push('SOURCE_IDENTITY_NOT_VERIFIED');
    if (!MIME.has(path.extname(String(row.source_object_key || '')).toLowerCase())) errors.push('UNSUPPORTED_MEDIA_TYPE');
    if (row.public_url !== expectedUrl(row.source_object_key)) errors.push('PUBLIC_URL_DISAGREES');
  }
  return [...new Set(errors)];
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

async function fetchWatchRows(ids) {
  const expression = ids.map(id => `"${id}"`).join(',');
  const params = new URLSearchParams({
    select: 'id,brand,reference,listing_type,verdict,has_images,image_urls,thumbnail_url',
    id: `in.(${expression})`,
  });
  return supabase(`watch_records?${params}`);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function run() {
  if (!LEDGER_PATH || !fs.existsSync(LEDGER_PATH)) throw new Error('MEDIA_LEDGER_INPUT must name an existing ledger');
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const buffer = fs.readFileSync(LEDGER_PATH);
  const actualHash = sha256(buffer);
  const ledger = JSON.parse(buffer.toString('utf8'));
  const ledgerErrors = validateLedger(ledger, EXPECTED_SHA, actualHash);
  if (ledgerErrors.length) throw new Error(ledgerErrors.join(','));

  const watches = await fetchWatchRows(ledger.rows.map(row => row.record_id));
  const byId = new Map((watches || []).map(row => [row.id, row]));
  const rejected = [];
  for (const row of ledger.rows) {
    const watch = byId.get(row.record_id);
    const reasons = customerSafeReasons(watch, { brand: row.brand, normalized_reference: row.reference });
    if (watch && (
      normalizedIdentity(watch.brand) !== normalizedIdentity(row.brand)
      || normalizedIdentity(watch.reference) !== normalizedIdentity(row.reference)
      || String(watch.listing_type || '').toUpperCase() !== String(row.listing_type || '').toUpperCase()
      || String(watch.verdict || '').toUpperCase() !== String(row.verdict || '').toUpperCase()
    )) reasons.push('CURRENT_RECORD_DISAGREES');
    if (!reasons.length && !(await reachable(row.public_url))) reasons.push('URL_UNREACHABLE');
    if (reasons.length) rejected.push({ record_id: row.record_id, reasons: [...new Set(reasons)] });
  }

  if (rejected.length) {
    process.stdout.write(`${JSON.stringify({
      status: 'blocked',
      mode: APPLY ? 'apply' : 'dry_run',
      ledger_sha256: actualHash,
      rows: ledger.rows.length,
      rejected,
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  let databaseResult = null;
  if (APPLY) {
    const payload = ledger.rows.map(row => ({
      record_id: row.record_id,
      source_id: sourceId(row.record_id),
      source_object_key: row.source_object_key,
      source_bucket: 'thecollective-prod',
      public_url: row.public_url,
      mime_type: MIME.get(path.extname(row.source_object_key).toLowerCase()),
      verification_status: 'url_reachable',
    }));
    databaseResult = await supabase('rpc/attach_listing_media_batch', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
  }

  process.stdout.write(`${JSON.stringify({
    status: 'verified',
    mode: APPLY ? 'apply' : 'dry_run',
    ledger_sha256: actualHash,
    rows: ledger.rows.length,
    database_result: databaseResult,
  }, null, 2)}\n`);
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { expectedUrl, sha256, sourceId, validateLedger };
