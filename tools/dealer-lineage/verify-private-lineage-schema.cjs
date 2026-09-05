'use strict';

// Read-only check. This never inserts, updates, or deletes data.
const TABLES = ['seller_listing_lineage_staging', 'seller_child_lineage_staging'];

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function checkTable(baseUrl, key, table) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  return {
    table,
    reachable: response.ok,
    status: response.status,
    detail: response.ok ? 'service-role read succeeded' : body.slice(0, 250),
  };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required');
  const results = await Promise.all(TABLES.map(table => checkTable(baseUrl, key, table)));
  const missing = results.filter(result => !result.reachable);
  const report = {
    event: 'private_lineage_schema_check',
    readOnly: true,
    tables: results,
    readyForCanary: missing.length === 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (missing.length) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'private_lineage_schema_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { checkTable };
