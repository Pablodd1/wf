'use strict';

const pageSize = Math.min(1000, Math.max(100, Number(process.env.DEALER_SOURCE_PAGE_SIZE || 1000)));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(url, key, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.text();
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const companies = new Map();
  let lastId = '';
  let rowsScanned = 0;

  for (;;) {
    const params = new URLSearchParams({ select: 'id,source_table,raw_data', order: 'id.asc', limit: String(pageSize) });
    if (lastId) params.set('id', `gt.${lastId}`);
    const text = await request(`${baseUrl}/rest/v1/raw_records?${params}`, key);
    const rows = JSON.parse(text || '[]');
    if (!rows.length) break;
    for (const row of rows) {
      rowsScanned += 1;
      lastId = row.id;
      const companyId = row.raw_data?.company_id;
      if (companyId === null || companyId === undefined || String(companyId).trim() === '') continue;
      const id = String(companyId).trim();
      const current = companies.get(id) || { post_count: 0, source_tables: new Set() };
      current.post_count += 1;
      if (row.source_table) current.source_tables.add(row.source_table);
      companies.set(id, current);
    }
    process.stdout.write(`${JSON.stringify({ event: 'dealer_source_scan_page', rowsScanned, candidates: companies.size, lastId })}\n`);
    if (rows.length < pageSize) break;
  }

  const records = [...companies.entries()].map(([sourceId, evidence]) => ({
    source_system: 'RAW_RECORDS_COMPANY_ID',
    source_id: sourceId,
    raw_payload: { post_count: evidence.post_count, source_tables: [...evidence.source_tables].sort() },
    comparison_status: 'PENDING',
  }));
  for (let index = 0; index < records.length; index += 500) {
    const batch = records.slice(index, index + 500);
    await request(`${baseUrl}/rest/v1/dealer_directory_import_staging?on_conflict=source_system,source_id`, key, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
  }
  process.stdout.write(`${JSON.stringify({ event: 'dealer_source_staging_complete', rowsScanned, candidates: records.length })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'dealer_source_staging_error', error: error.message })}\n`);
  process.exitCode = 1;
});
