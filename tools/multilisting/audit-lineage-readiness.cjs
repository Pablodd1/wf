'use strict';

const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(pathname, { count = false } = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(count ? { Prefer: 'count=exact', Range: '0-0' } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 300)}`);
  return { rows: text ? JSON.parse(text) : [], contentRange: response.headers.get('content-range') };
}

function countFromRange(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function matchingKeys(rows, pattern) {
  return [...new Set(rows.flatMap(row => Object.keys(row.raw_data || {}).filter(key => pattern.test(key))))].sort();
}

async function main() {
  required(baseUrl, 'SUPABASE_URL');
  required(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY');

  const [all, auctions, sample] = await Promise.all([
    request('raw_records?select=id', { count: true }),
    request('raw_records?select=id&source_table=eq.auctions', { count: true }),
    request('raw_records?select=source_table,source_id,raw_data&source_table=eq.auctions&limit=100'),
  ]);
  const rows = sample.rows || [];
  const frontImageRows = rows.filter(row => row.raw_data?.front_image);

  process.stdout.write(`${JSON.stringify({
    raw_records: countFromRange(all.contentRange),
    auction_raw_records: countFromRange(auctions.contentRange),
    sample_size: rows.length,
    sample_front_image_coverage: rows.length ? frontImageRows.length / rows.length : null,
    sample_company_id_coverage: rows.length ? rows.filter(row => row.raw_data?.company_id != null).length / rows.length : null,
    image_fields: matchingKeys(rows, /image|photo|media/i),
    dealer_fields: matchingKeys(rows, /seller|phone|name|company|from_/i),
    original_date_fields: matchingKeys(rows, /date|created|posted|time/i),
    sample_lineage: rows.slice(0, 3).map(row => ({
      source_table: row.source_table,
      source_id: row.source_id,
      front_image: row.raw_data?.front_image || null,
      company_id_present: row.raw_data?.company_id != null,
    })),
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
  process.exitCode = 1;
});
