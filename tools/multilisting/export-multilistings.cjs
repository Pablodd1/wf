'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pageSize = Math.min(1000, Math.max(100, Number(process.env.MULTILISTING_PAGE_SIZE || 500)));
const maxRows = Math.max(0, Number(process.env.MULTILISTING_MAX_ROWS || 0));
const outputDir = path.resolve(process.env.MULTILISTING_OUTPUT || 'audit-output/multilistings');
const reset = String(process.env.MULTILISTING_RESET || 'false').toLowerCase() === 'true';
const requestTimeoutMs = Math.max(5000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 30000));
const maxAttempts = Math.max(1, Math.min(Number(process.env.SUPABASE_REQUEST_ATTEMPTS || 5), 8));
const sourceConcurrency = Math.max(1, Math.min(Number(process.env.MULTILISTING_SOURCE_CONCURRENCY || 5), 10));
const startAfterId = String(process.env.MULTILISTING_START_AFTER_ID || '').trim();
const stopBeforeId = String(process.env.MULTILISTING_STOP_BEFORE_ID || '').trim();
const clientFilter = String(process.env.MULTILISTING_CLIENT_FILTER || 'false').toLowerCase() === 'true';
let releaseExportLock = () => {};

function appendDurable(filePath, content) {
  const descriptor = fs.openSync(filePath, 'a');
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  const descriptor = fs.openSync(temporaryPath, 'w');
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

async function fetchJson(baseUrl, key, resource, params) {
  const url = `${baseUrl}/rest/v1/${resource}?${params}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (response.ok) return await response.json();
      const body = (await response.text()).slice(0, 500);
      if (response.status < 500 || attempt === maxAttempts) {
        throw new Error(`Supabase ${response.status}: ${body}`);
      }
    } catch (error) {
      if (attempt === maxAttempts || /^Supabase 4/.test(error.message)) {
        const cause = error.cause?.message ? ` (${error.cause.message})` : '';
        throw new Error(`Request failed for ${resource} after ${attempt} attempt(s): ${error.message}${cause}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
  }
  throw new Error(`Request failed for ${resource}`);
}

async function fetchShadowPage(baseUrl, key, lastId) {
  const params = new URLSearchParams({
    select: 'source_record_id,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at',
    change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
    order: 'source_record_id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('source_record_id', `gt.${lastId}`);
  if (stopBeforeId) params.append('source_record_id', `lt.${stopBeforeId}`);
  return fetchJson(baseUrl, key, 'normalization_shadow_v4', params);
}

async function fetchShadowIndexPage(baseUrl, key, lastId) {
  const params = new URLSearchParams({
    select: 'source_record_id,change_flags',
    order: 'source_record_id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('source_record_id', `gt.${lastId}`);
  if (stopBeforeId) params.append('source_record_id', `lt.${stopBeforeId}`);
  return fetchJson(baseUrl, key, 'normalization_shadow_v4', params);
}

async function fetchShadowDetails(baseUrl, key, ids) {
  if (!ids.length) return [];
  const rows = [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  for (let index = 0; index < batches.length; index += sourceConcurrency) {
    const pages = await Promise.all(batches.slice(index, index + sourceConcurrency).map(batch => {
      const params = new URLSearchParams({
        select: 'source_record_id,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at',
        source_record_id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      });
      return fetchJson(baseUrl, key, 'normalization_shadow_v4', params);
    }));
    rows.push(...pages.flat());
  }
  const byId = new Map(rows.map(row => [row.source_record_id, row]));
  const missingIds = ids.filter(id => !byId.has(id));
  if (missingIds.length) {
    throw new Error(`Missing ${missingIds.length} requested shadow detail row(s); first=${missingIds[0]}`);
  }
  return ids.map(id => byId.get(id));
}

async function fetchSources(baseUrl, key, ids) {
  const rows = [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  for (let index = 0; index < batches.length; index += sourceConcurrency) {
    const pages = await Promise.all(batches.slice(index, index + sourceConcurrency).map(batch => {
      const params = new URLSearchParams({
        select: 'id,raw_message,brand,reference,listing_type,created_at,source,seller_name,seller_phone',
        id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
      });
      return fetchJson(baseUrl, key, 'watch_records', params);
    }));
    rows.push(...pages.flat());
  }
  return rows;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireExportLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* stale or partial lock */ }
    if (processIsAlive(Number(existing?.pid))) {
      throw new Error(`Export already running for this output directory (pid ${existing.pid})`);
    }
    fs.rmSync(lockPath, { force: true });
  }
  const descriptor = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`);
  return () => {
    try { fs.closeSync(descriptor); } catch { /* already closed */ }
    try { fs.rmSync(lockPath, { force: true }); } catch { /* cleanup is best effort */ }
  };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  fs.mkdirSync(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, 'export.lock');
  releaseExportLock = acquireExportLock(lockPath);
  const outputPath = path.join(outputDir, 'multilistings.jsonl');
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  if (reset) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(checkpointPath, { force: true });
  }
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : { lastId: startAfterId, exported: 0, missingSourceRows: 0, completed: false };
  if (checkpoint.startAfterId && checkpoint.startAfterId !== startAfterId) {
    throw new Error(`Checkpoint start boundary mismatch: ${checkpoint.startAfterId} != ${startAfterId}`);
  }
  if (checkpoint.stopBeforeId && checkpoint.stopBeforeId !== stopBeforeId) {
    throw new Error(`Checkpoint stop boundary mismatch: ${checkpoint.stopBeforeId} != ${stopBeforeId}`);
  }
  if (checkpoint.completed) {
    process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_already_complete', ...checkpoint })}\n`);
    return;
  }

  let lastId = checkpoint.lastId || '';
  let exported = Number(checkpoint.exported || 0);
  let missingSourceRows = Number(checkpoint.missingSourceRows || 0);
  while (!maxRows || exported < maxRows) {
    const indexRows = clientFilter ? await fetchShadowIndexPage(baseUrl, key, lastId) : null;
    const shadowRows = clientFilter
      ? await fetchShadowDetails(baseUrl, key, indexRows
        .filter(row => row.change_flags?.includes('BUNDLE_SPLIT_REQUIRED'))
        .map(row => row.source_record_id))
      : await fetchShadowPage(baseUrl, key, lastId);
    const fetchedCount = clientFilter ? indexRows.length : shadowRows.length;
    if (!fetchedCount) break;
    const boundedRows = maxRows ? shadowRows.slice(0, Math.max(0, maxRows - exported)) : shadowRows;
    const sources = await fetchSources(baseUrl, key, boundedRows.map(row => row.source_record_id));
    const sourceById = new Map(sources.map(row => [row.id, row]));
    const missingInPage = boundedRows.filter(row => !sourceById.has(row.source_record_id)).length;
    missingSourceRows += missingInPage;
    const lines = boundedRows.map(row => JSON.stringify({
      ...row,
      source: sourceById.get(row.source_record_id) || null,
      review_policy: {
        parent_immutable: true,
        split_children_before_duplicate_review: true,
        suppress_parent_only_after_approval: true,
      },
    })).join('\n');
    if (lines) appendDurable(outputPath, `${lines}\n`);
    exported += boundedRows.length;
    lastId = clientFilter
      ? indexRows.at(-1)?.source_record_id || lastId
      : boundedRows.at(-1)?.source_record_id || lastId;
    const nextCheckpoint = { startAfterId: startAfterId || null, stopBeforeId: stopBeforeId || null, clientFilter, lastId, exported, missingSourceRows, completed: false, updatedAt: new Date().toISOString(), outputPath };
    writeJsonAtomic(checkpointPath, nextCheckpoint);
    process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_page', exported, missingSourceRows, lastId })}\n`);
    if (fetchedCount < pageSize || boundedRows.length < shadowRows.length) break;
  }
  const completed = !maxRows || exported < maxRows;
  const finalCheckpoint = { startAfterId: startAfterId || null, stopBeforeId: stopBeforeId || null, clientFilter, lastId, exported, missingSourceRows, completed, updatedAt: new Date().toISOString(), outputPath };
  writeJsonAtomic(checkpointPath, finalCheckpoint);
  process.stdout.write(`${JSON.stringify({ event: 'multilisting_export_complete', ...finalCheckpoint })}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'multilisting_export_error', error: error.message })}\n`);
    process.exitCode = 1;
  })
  .finally(() => releaseExportLock());
