'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildStagingChildren, fingerprint } = require('./bundle-cohort.cjs');

const parentLimit = Math.max(1, Math.min(Number(process.env.BUNDLE_MATERIALIZE_PARENTS || 25), 100));
const afterId = String(process.env.BUNDLE_MATERIALIZE_AFTER_ID || '').trim();
const write = String(process.env.BUNDLE_MATERIALIZE_WRITE || 'false').toLowerCase() === 'true';
const outputDir = path.resolve(process.env.BUNDLE_MATERIALIZE_OUTPUT || 'audit-output/bundle-child-canary');
const requestTimeoutMs = Math.max(5000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 30000));
const maxAttempts = Math.max(1, Math.min(Number(process.env.SUPABASE_REQUEST_ATTEMPTS || 4), 8));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return String(value).replace(/\/$/, '');
}

async function rest(baseUrl, key, resource, options = {}) {
  const url = `${baseUrl}/rest/v1/${resource}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        if (response.status < 500 || attempt === maxAttempts) {
          throw new Error(`Supabase ${response.status} for ${resource.split('?')[0]}: ${body}`);
        }
        throw new Error(`retryable Supabase ${response.status}`);
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      if (attempt === maxAttempts || /^Supabase 4/.test(error.message)) {
        const cause = error.cause?.message ? ` (${error.cause.message})` : '';
        throw new Error(`Request failed for ${resource.split('?')[0]} after ${attempt} attempt(s): ${error.message}${cause}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`Request failed for ${resource.split('?')[0]}`);
}

async function fetchParents(baseUrl, key) {
  const params = new URLSearchParams({
    select: 'source_record_id,normalization_version,source_listing_type,candidate_count,proposed_candidates,change_flags,review_status',
    change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
    order: 'source_record_id.asc',
    limit: String(parentLimit),
  });
  if (afterId) params.set('source_record_id', `gt.${afterId}`);
  return rest(baseUrl, key, `normalization_shadow_v4?${params}`);
}

async function fetchSources(baseUrl, key, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const params = new URLSearchParams({
      select: 'id,raw_message,listing_type',
      id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
    });
    rows.push(...await rest(baseUrl, key, `watch_records?${params}`));
  }
  return rows;
}

async function upsertChildren(baseUrl, key, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    await rest(baseUrl, key, 'watch_staging?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(index, index + 100)),
    });
  }
}

async function fetchPersisted(baseUrl, key, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const params = new URLSearchParams({
      select: 'id,raw_message,source,parser_version,verdict,flags,field_confidence',
      id: `in.(${batch.map(id => `"${id}"`).join(',')})`,
    });
    rows.push(...await rest(baseUrl, key, `watch_staging?${params}`));
  }
  return rows;
}

function persistedFingerprint(row) {
  return fingerprint({
    id: row.id,
    raw_message: row.raw_message,
    source: row.source,
    parser_version: row.parser_version,
    verdict: row.verdict,
    flags: row.flags,
    field_confidence: row.field_confidence,
  });
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const parents = await fetchParents(baseUrl, key);
  const staleParents = parents.filter(parent => parent.normalization_version !== 'v4.3-mint-condition');
  if (staleParents.length) {
    throw new Error(`${staleParents.length} parent(s) are not reconciled with v4.2; staging write aborted`);
  }
  const sources = await fetchSources(baseUrl, key, parents.map(row => row.source_record_id));
  const sourceById = new Map(sources.map(row => [row.id, row]));
  const rows = parents.flatMap(parent => {
    const source = sourceById.get(parent.source_record_id);
    return source ? buildStagingChildren(source, parent) : [];
  });
  const safeRows = rows.filter(row => row.field_confidence.exact_raw_lineage);
  const blockedRows = rows.filter(row => !row.field_confidence.exact_raw_lineage);
  if (write && blockedRows.length) throw new Error('Raw-line lineage gate failed; staging write aborted');

  fs.mkdirSync(outputDir, { recursive: true });
  const jsonlPath = path.join(outputDir, 'children.jsonl');
  fs.writeFileSync(jsonlPath, safeRows.map(row => JSON.stringify(row)).join('\n') + (safeRows.length ? '\n' : ''));

  if (write && safeRows.length) await upsertChildren(baseUrl, key, safeRows);
  const persisted = write ? await fetchPersisted(baseUrl, key, safeRows.map(row => row.id)) : [];
  const expectedById = new Map(safeRows.map(row => [row.id, row]));
  const mismatches = persisted.filter(row => persistedFingerprint(row) !== persistedFingerprint(expectedById.get(row.id)));
  const persistedIds = new Set(persisted.map(row => row.id));
  const missingIds = write ? safeRows.filter(row => !persistedIds.has(row.id)).map(row => row.id) : [];
  const reviewRequired = safeRows.filter(row => row.flags.some(flag => !/^BUNDLE_(?:CHILD_CANARY|PARENT:|INDEX:)/.test(flag)));

  const report = {
    generatedAt: new Date().toISOString(),
    write,
    target: 'watch_staging',
    parentLimit,
    parentsSelected: parents.length,
    sourceRows: sources.length,
    childrenGenerated: rows.length,
    childrenWithExactLineage: safeRows.length,
    childrenBlockedForLineage: blockedRows.length,
    childrenRequiringReview: reviewRequired.length,
    persistedRows: persisted.length,
    persistedMismatches: mismatches.length,
    persistedMissing: missingIds.length,
    firstParentId: parents[0]?.source_record_id || null,
    lastParentId: parents.at(-1)?.source_record_id || null,
    outputPath: jsonlPath,
    safety: {
      targetIsStagingOnly: true,
      verdict: 'PENDING',
      confidence: 0,
      liveRowsMutated: false,
      parentRowsImmutable: true,
      idempotentIds: true,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'bundle_materialization_complete', ...report }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'bundle_materialization_error', error: error.message })}\n`);
  process.exitCode = 1;
});
