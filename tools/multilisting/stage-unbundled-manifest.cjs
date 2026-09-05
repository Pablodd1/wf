'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const PAGE_SIZE = Math.max(10, Math.min(Number(process.env.UNBUNDLED_STAGE_PAGE_SIZE || 100), 200));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.renameSync(temporary, filePath);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
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
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function stagedCount(baseUrl, key, batchId) {
  const params = new URLSearchParams({ select: 'id', batch_id: `eq.${batchId}`, limit: '1' });
  const response = await fetch(`${baseUrl}/rest/v1/watch_staging?${params}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

async function existingDecisions(baseUrl, key, ids) {
  if (!ids.length) return new Map();
  const params = new URLSearchParams({
    select: 'id,verdict',
    id: `in.(${ids.join(',')})`,
  });
  const rows = await rest(baseUrl, key, `watch_staging?${params}`);
  return new Map(rows.map(row => [row.id, row.verdict]));
}

function partitionWritableRows(rows, decisions) {
  const writable = [];
  const protectedRows = [];
  for (const row of rows) {
    const verdict = decisions.get(row.id);
    if (verdict && verdict !== 'PENDING') {
      protectedRows.push({ id: row.id, verdict });
    } else {
      writable.push(row);
    }
  }
  return { writable, protectedRows };
}

async function stage({ manifestPath, checkpointPath, write, maxRows }) {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { processed: 0, persisted: 0, protected: 0 };
  checkpoint.protected ||= 0;
  let seen = 0;
  let batch = [];
  let batchId = null;

  async function flush() {
    if (!batch.length) return;
    let writable = batch;
    if (write) {
      const decisions = await existingDecisions(baseUrl, key, batch.map(row => row.id));
      const partition = partitionWritableRows(batch, decisions);
      writable = partition.writable;
      checkpoint.protected += partition.protectedRows.length;
      if (partition.protectedRows.length) {
        const verdictCounts = partition.protectedRows.reduce((counts, row) => {
          counts[row.verdict] = (counts[row.verdict] || 0) + 1;
          return counts;
        }, {});
        process.stdout.write(`${JSON.stringify({
          event: 'unbundled_stage_protected_decisions',
          count: partition.protectedRows.length,
          verdictCounts,
        })}\n`);
      }
    }
    if (write && writable.length) {
      await rest(baseUrl, key, 'watch_staging?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(writable),
      });
      checkpoint.persisted += writable.length;
    }
    checkpoint.processed += batch.length;
    checkpoint.updatedAt = new Date().toISOString();
    atomicJson(checkpointPath, checkpoint);
    process.stdout.write(`${JSON.stringify({ event: 'unbundled_stage_checkpoint', write, ...checkpoint })}\n`);
    batch = [];
  }

  for await (const line of readline.createInterface({ input: fs.createReadStream(manifestPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    seen += 1;
    if (seen <= checkpoint.processed) continue;
    if (checkpoint.processed + batch.length >= maxRows) break;
    const row = JSON.parse(line);
    batchId ||= row.batch_id;
    if (row.verdict !== 'PENDING' || row.confidence !== 0 || !row.field_confidence?.exact_raw_lineage) {
      throw new Error(`Release gate failed for ${row.id}`);
    }
    batch.push(row);
    if (batch.length >= PAGE_SIZE) await flush();
  }
  await flush();
  const persistedBatchRows = write && batchId ? await stagedCount(baseUrl, key, batchId) : 0;
  if (write && persistedBatchRows < checkpoint.persisted) {
    throw new Error(`Read-back gate failed: expected at least ${checkpoint.persisted}, found ${persistedBatchRows}`);
  }
  return { ...checkpoint, write, manifestPath, batchId, persistedBatchRows, target: 'watch_staging', liveWatchRecordsMutated: false };
}

async function main() {
  const manifestPath = path.resolve(process.env.UNBUNDLED_STAGING_MANIFEST || process.argv[2] || 'audit-output/unbundled/batch-002-staging/watch-staging.jsonl');
  const write = String(process.env.UNBUNDLED_STAGE_WRITE || 'false').toLowerCase() === 'true';
  const maxRows = Math.max(1, Number(process.env.UNBUNDLED_STAGE_MAX_ROWS || 100));
  const checkpointPath = path.resolve(process.env.UNBUNDLED_STAGE_CHECKPOINT || `${manifestPath}.${write ? 'write' : 'dry-run'}.checkpoint.json`);
  const result = await stage({ manifestPath, checkpointPath, write, maxRows });
  process.stdout.write(`${JSON.stringify({ event: 'unbundled_stage_complete', ...result }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'unbundled_stage_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { stage, partitionWritableRows };
