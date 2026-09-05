'use strict';

const { confirmCatalogCandidate } = require('../../api/_lib/catalog-confirmation.cjs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const LIMIT = Math.min(100_000, Math.max(100, Number(process.env.IDENTITY_AUDIT_LIMIT || 10_000)));

async function rows(table, select, filters = '') {
  const result = [];
  for (let offset = 0; offset < LIMIT; offset += 1000) {
    const query = new URLSearchParams({ select, limit: '1000', offset: String(offset) });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}${filters}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    result.push(...page);
    if (page.length < 1000) break;
  }
  return result;
}

function classify(records) {
  const counts = {
    scanned: records.length,
    catalog_confirmed: 0,
    catalog_brand_conflict: 0,
    catalog_dial_conflict: 0,
    catalog_unverified: 0,
    image_backed: 0,
    image_backed_identity_conflict: 0,
  };
  const examples = [];
  for (const record of records) {
    const confirmation = confirmCatalogCandidate(record);
    const brandConflict = confirmation.reason === 'CATALOG_BRAND_CONFLICT';
    const dialConflict = confirmation.confirmed && confirmation.dialConfirmed === false;
    if (confirmation.confirmed && !dialConflict) counts.catalog_confirmed += 1;
    else if (brandConflict) counts.catalog_brand_conflict += 1;
    else if (dialConflict) counts.catalog_dial_conflict += 1;
    else counts.catalog_unverified += 1;
    if (record.has_images || record.thumbnail_url) counts.image_backed += 1;
    if ((record.has_images || record.thumbnail_url) && (brandConflict || dialConflict)) {
      counts.image_backed_identity_conflict += 1;
    }
    if ((brandConflict || dialConflict) && examples.length < 20) {
      examples.push({
        brand: record.brand,
        reference: record.reference,
        dial_color: record.dial_color,
        issue: brandConflict ? 'CATALOG_BRAND_CONFLICT' : 'CATALOG_DIAL_CONFLICT',
      });
    }
  }
  return { counts, examples };
}

async function run() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase server credentials are required');
  const records = await rows(
    'trading_floor_market_listings',
    'brand,reference,dial_color,has_images,thumbnail_url',
  );
  process.stdout.write(`${JSON.stringify({
    event: 'customer_identity_audit',
    read_only: true,
    limit: LIMIT,
    ...classify(records),
  }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'customer_identity_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { classify };
