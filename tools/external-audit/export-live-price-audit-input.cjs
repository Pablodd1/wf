'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COLUMNS = [
  'source_record_id', 'raw_message', 'brand', 'model', 'reference', 'dial_color',
  'condition', 'listing_type', 'price_raw', 'price_usd', 'currency', 'original_posted_at',
  'catalog_status', 'bundle_status', 'duplicate_status', 'seller_lineage_present',
];

function required(name) {
  const raw = String(process.env[name] || '').trim();
  const value = raw.replace(/^(['"])(.*)\1$/, '$2').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(Math.floor(value), max)) : fallback;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toExportRow(row) {
  return {
    source_record_id: row.id,
    raw_message: row.raw_message || '',
    brand: row.brand || '',
    model: row.model || '',
    reference: row.reference || '',
    dial_color: row.dial_color || '',
    condition: row.condition || '',
    listing_type: row.listing_type || '',
    price_raw: row.price_raw || '',
    price_usd: row.price_usd ?? '',
    currency: row.currency || '',
    original_posted_at: row.listing_date || '',
    catalog_status: row.verdict || '',
    bundle_status: row.listing_status || '',
    duplicate_status: row.flags?.includes?.('DUPLICATE') ? 'DUPLICATE_FLAGGED' : '',
    seller_lineage_present: Boolean(row.seller_name || row.seller_phone),
  };
}

async function rest(baseUrl, key, pathname) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const maxRows = bounded('LIVE_AUDIT_MAX_ROWS', 1000, 1, 100000);
  const pageSize = bounded('LIVE_AUDIT_PAGE_SIZE', 500, 50, 1000);
  const reference = String(process.env.LIVE_AUDIT_REFERENCE || '').trim();
  const startAfterId = String(process.env.LIVE_AUDIT_AFTER_ID || '').trim();
  const outputPath = path.resolve(process.env.LIVE_AUDIT_OUTPUT || 'audit-output/external-ai/live-price-audit-input.csv');
  const summaryPath = path.resolve(process.env.LIVE_AUDIT_SUMMARY || `${outputPath}.summary.json`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  output.write(`${COLUMNS.join(',')}\n`);

  let written = 0;
  let lastId = startAfterId;
  while (written < maxRows) {
    const limit = Math.min(pageSize, maxRows - written);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,model,reference,dial_color,condition,listing_type,price_raw,price_usd,currency,listing_date,verdict,listing_status,flags,seller_name,seller_phone',
      id: `gt.${lastId || ''}`,
      order: 'id.asc',
      limit: String(limit),
      raw_message: 'not.is.null',
      price_usd: 'gt.0',
    });
    if (!lastId) params.delete('id');
    if (reference) params.set('reference', `eq.${reference}`);
    const rows = await rest(baseUrl, key, `watch_records?${params.toString()}`);
    if (!rows.length) break;
    for (const row of rows) output.write(`${COLUMNS.map(column => csvEscape(toExportRow(row)[column])).join(',')}\n`);
    written += rows.length;
    lastId = rows[rows.length - 1].id;
    process.stdout.write(`${JSON.stringify({ event: 'live_price_audit_export_page', written, lastId })}\n`);
  }
  await new Promise((resolve, reject) => output.end(resolve).on('error', reject));

  const summary = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    table: 'watch_records',
    rows: written,
    reference: reference || null,
    startedAfterId: startAfterId || null,
    lastId: lastId || null,
    outputPath,
    columns: COLUMNS,
    pii: 'Seller name and phone were intentionally excluded from this external-audit export.',
    watchRecordsMutated: false,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'live_price_audit_export_complete', ...summary })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'live_price_audit_export_error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { COLUMNS, csvEscape, toExportRow };
