'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function expectedIds(manifestPath) {
  const ids = new Set();
  let batchId = null;
  for await (const line of readline.createInterface({ input: fs.createReadStream(manifestPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    batchId ||= row.batch_id;
    if (row.batch_id !== batchId) throw new Error('Manifest contains more than one batch ID');
    ids.add(row.id);
  }
  return { ids, batchId };
}

async function request(baseUrl, key, resource, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
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

async function existingPendingIds(baseUrl, key, batchId) {
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: 'id', batch_id: `eq.${batchId}`, verdict: 'eq.PENDING',
      order: 'id.asc', offset: String(offset), limit: '1000',
    });
    const rows = await request(baseUrl, key, `watch_staging?${params}`);
    ids.push(...rows.map(row => row.id));
    if (rows.length < 1000) break;
  }
  return ids;
}

async function reconcile({ manifestPath, write }) {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const expected = await expectedIds(manifestPath);
  const existing = await existingPendingIds(baseUrl, key, expected.batchId);
  const stale = existing.filter(id => !expected.ids.has(id));
  const existingSet = new Set(existing);
  const missing = [...expected.ids].filter(id => !existingSet.has(id));
  if (write) {
    for (let index = 0; index < stale.length; index += 50) {
      const ids = stale.slice(index, index + 50);
      const params = new URLSearchParams({
        batch_id: `eq.${expected.batchId}`,
        verdict: 'eq.PENDING',
        id: `in.(${ids.join(',')})`,
      });
      await request(baseUrl, key, `watch_staging?${params}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ verdict: 'BLOCKED_RENORMALIZATION', confidence: 0, processed_at: new Date().toISOString() }),
      });
    }
  }
  const remaining = await existingPendingIds(baseUrl, key, expected.batchId);
  const remainingSet = new Set(remaining);
  const staleAfter = remaining.filter(id => !expected.ids.has(id));
  const missingAfter = [...expected.ids].filter(id => !remainingSet.has(id));
  const result = {
    batchId: expected.batchId,
    expectedPending: expected.ids.size,
    existingPendingBefore: existing.length,
    stalePending: stale.length,
    missingPending: missing.length,
    existingPendingAfter: remaining.length,
    stalePendingAfter: staleAfter.length,
    missingPendingAfter: missingAfter.length,
    write,
    passed: write ? staleAfter.length === 0 && missingAfter.length === 0 : true,
    staleIds: stale,
    missingIds: missing,
  };
  return result;
}

async function main() {
  const requestedManifest = process.env.UNBUNDLED_STAGING_MANIFEST || process.argv[2];
  if (!requestedManifest) throw new Error('A staging manifest is required');
  const manifestPath = path.resolve(requestedManifest);
  if (!fs.existsSync(manifestPath)) throw new Error('A staging manifest is required');
  const write = String(process.env.UNBUNDLED_RECONCILE_WRITE || 'false').toLowerCase() === 'true';
  const result = await reconcile({ manifestPath, write });
  const outputPath = path.resolve(process.env.UNBUNDLED_RECONCILE_REPORT || `${manifestPath}.${write ? 'write' : 'dry-run'}.reconciliation.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_staging_reconciliation', ...result, staleIds: undefined, missingIds: undefined }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_staging_reconciliation_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { expectedIds, reconcile };
