'use strict';

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function exactCount(baseUrl, key, batchId, verdict) {
  const params = new URLSearchParams({
    select: 'id',
    batch_id: `eq.${batchId}`,
    verdict: `eq.${verdict}`,
    limit: '1',
  });
  const response = await fetch(`${baseUrl}/rest/v1/watch_staging?${params}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const total = Number((response.headers.get('content-range') || '0/0').split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

async function audit(batchId) {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const verdicts = ['PENDING', 'REVIEW', 'APPROVED', 'REJECTED', 'BLOCKED_RENORMALIZATION'];
  const counts = Object.fromEntries(await Promise.all(
    verdicts.map(async verdict => [verdict, await exactCount(baseUrl, key, batchId, verdict)]),
  ));
  return {
    batchId,
    counts,
    completedHumanDecisions: counts.APPROVED + counts.REJECTED,
    safeToRefreshPendingOnly: true,
  };
}

async function main() {
  const batchId = process.env.UNBUNDLED_BATCH_ID || process.argv[2];
  if (!batchId) throw new Error('UNBUNDLED_BATCH_ID or a batch ID argument is required');
  const result = await audit(batchId);
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_staging_audit', ...result })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_staging_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { audit, exactCount };
