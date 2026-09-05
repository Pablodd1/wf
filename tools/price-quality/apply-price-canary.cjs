'use strict';

const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const apply = String(process.env.APPLY_PRICE_CANARY || 'false').toLowerCase() === 'true';
const operatorId = String(process.env.PRICE_REVIEW_OPERATOR || 'cto-price-canary-20260719').trim();

if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');

async function rest(resource, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    ...options,
    signal: AbortSignal.timeout(60000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

async function main() {
  const rows = await rest('price_remediation_review?select=*&normalization_version=eq.market-line-v1&review_status=eq.PENDING&order=id.asc&limit=100');
  const ids = rows.map(row => row.source_record_id);
  const sourceRows = ids.length
    ? await rest(`watch_records?select=id,reference,raw_message,price_usd,listing_type&id=in.(${ids.join(',')})&limit=100`)
    : [];
  const sourceById = new Map(sourceRows.map(row => [row.id, row]));
  const compact = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const approved = rows.filter(row =>
    ['EXPLICIT_HKD_FROM_REFERENCE_LINE', 'EXPLICIT_USD_FROM_REFERENCE_LINE'].includes(row.normalization_reason)
    && Number(row.proposed_price_usd) >= 500
    && String(row.evidence_line || '').trim()
    && !row.audit_flags?.includes('REPEATED_REFERENCE_BLOCK_REVIEW')
    && !row.audit_flags?.includes('NORMALIZED_PRICE_BELOW_LUXURY_FLOOR')
    && sourceById.get(row.source_record_id)?.listing_type === 'WTS'
    && Number(sourceById.get(row.source_record_id)?.price_usd) === Number(row.stored_price_usd)
    && compact(sourceById.get(row.source_record_id)?.raw_message).includes(compact(sourceById.get(row.source_record_id)?.reference)));
  const applied = [];
  if (apply) {
    for (const row of approved) {
      applied.push(await rest('rpc/apply_price_review_decision', {
        method: 'POST',
        body: JSON.stringify({
          p_review_id: row.id,
          p_operator_id: operatorId,
          p_reason: `${row.normalization_reason}; exact preserved reference-line evidence`,
        }),
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  console.log(JSON.stringify({ reviewed: rows.length, approved: approved.length, blocked: rows.length - approved.length, apply, applied: applied.length }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'price_canary_apply_error', error: error.message }));
  process.exitCode = 1;
});
