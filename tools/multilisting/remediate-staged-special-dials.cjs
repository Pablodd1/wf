'use strict';

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function rest(baseUrl, key, resource, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

async function remediate({ batchId, write }) {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const params = new URLSearchParams({
    select: 'id,raw_message,dial_color,flags,field_confidence',
    batch_id: `eq.${batchId}`,
    verdict: 'eq.PENDING',
    raw_message: 'ilike.*Tiffany*',
    limit: '1000',
  });
  const rows = await rest(baseUrl, key, `watch_staging?${params}`);
  const candidates = rows.filter(row => /\btiffany(?:\s+blue)?\b/i.test(String(row.raw_message || '')));
  if (write) {
    for (let offset = 0; offset < candidates.length; offset += 10) {
      await Promise.all(candidates.slice(offset, offset + 10).map(row => {
        const flags = [...new Set([...(Array.isArray(row.flags) ? row.flags : []), 'REVIEW:DIAL_RAW_SOURCE_CONFLICT', 'SPECIAL_DIAL_CLAIM'])];
        const fieldConfidence = {
          ...(row.field_confidence || {}),
          review_bucket: 'human-correction',
          catalog_dial_confirmed: false,
          special_dial_evidence: 'raw_text_tiffany',
        };
        return rest(baseUrl, key, `watch_staging?id=eq.${row.id}&batch_id=eq.${batchId}&verdict=eq.PENDING`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ dial_color: 'Tiffany Blue', flags, field_confidence: fieldConfidence, normalized_at: new Date().toISOString() }),
        });
      }));
    }
  }
  const result = {
    batchId,
    matched: rows.length,
    exactEvidence: candidates.length,
    changed: write ? candidates.length : 0,
    write,
    publicWatchRecordsMutated: false,
  };
  return result;
}

async function main() {
  const batchId = String(process.env.UNBUNDLED_BATCH_ID || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new Error('UNBUNDLED_BATCH_ID is required');
  const write = String(process.env.SPECIAL_DIAL_WRITE || 'false').toLowerCase() === 'true';
  const result = await remediate({ batchId, write });
  process.stdout.write(`${JSON.stringify({ event: 'staged_special_dial_remediation', ...result }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'staged_special_dial_remediation_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { remediate };
