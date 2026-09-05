'use strict';

async function main() {
  const baseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !key) throw new Error('SUPABASE_URL and a service key are required');

  const response = await fetch(`${baseUrl}/rest/v1/price_remediation_review?select=review_status&limit=1000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json();
  const counts = {};
  for (const row of rows) counts[row.review_status] = (counts[row.review_status] || 0) + 1;
  process.stdout.write(`${JSON.stringify({
    event: 'price_review_ledger_inspected',
    rowsRead: rows.length,
    exactTotal: Number(response.headers.get('content-range')?.split('/')[1] || rows.length),
    counts,
    watchRecordsMutated: false,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'price_review_ledger_inspection_error', error: error.message })}\n`);
  process.exitCode = 1;
});
