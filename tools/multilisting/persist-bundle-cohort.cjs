'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');
const { comparePersisted, exactLineage } = require('./bundle-cohort.cjs');

const limit = Math.max(1, Math.min(Number(process.env.BUNDLE_COHORT_ROWS || 1000), 10000));
const pageSize = Math.max(50, Math.min(Number(process.env.BUNDLE_COHORT_PAGE_SIZE || 250), 500));
const afterId = String(process.env.BUNDLE_COHORT_AFTER_ID || '').trim();
const write = String(process.env.BUNDLE_COHORT_WRITE || 'false').toLowerCase() === 'true';
const outputDir = path.resolve(process.env.BUNDLE_COHORT_OUTPUT || 'audit-output/bundle-cohort-persist');
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

function progress(stage, completed, total) {
  process.stdout.write(`${JSON.stringify({ event: 'bundle_cohort_progress', stage, completed, total })}\n`);
}

async function fetchBundleRows(baseUrl, key) {
  const rows = [];
  let cursor = afterId;
  while (rows.length < limit) {
    const params = new URLSearchParams({
      select: 'source_record_id,normalization_version,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at',
      change_flags: 'cs.{BUNDLE_SPLIT_REQUIRED}',
      order: 'source_record_id.asc',
      limit: String(Math.min(pageSize, limit - rows.length)),
    });
    if (cursor) params.set('source_record_id', `gt.${cursor}`);
    const page = await rest(baseUrl, key, `normalization_shadow_v4?${params}`);
    if (!page?.length) break;
    rows.push(...page);
    cursor = page.at(-1).source_record_id;
    if (page.length < Number(params.get('limit'))) break;
  }
  return rows;
}

async function fetchByIds(baseUrl, key, table, select, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const params = new URLSearchParams({
      select,
      id: `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`,
    });
    if (table === 'normalization_shadow_v4') {
      params.delete('id');
      params.set('source_record_id', `in.(${batch.map(id => `"${String(id).replaceAll('"', '')}"`).join(',')})`);
    }
    rows.push(...await rest(baseUrl, key, `${table}?${params}`));
    progress(`fetch_${table}`, Math.min(index + batch.length, ids.length), ids.length);
  }
  return rows;
}

async function persist(baseUrl, key, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    await rest(baseUrl, key, 'normalization_shadow_v4?on_conflict=source_record_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(index, index + 100)),
    });
    progress('persist_shadow', Math.min(index + 100, rows.length), rows.length);
  }
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const priorRows = await fetchBundleRows(baseUrl, key);
  const ids = priorRows.map(row => row.source_record_id);
  const sources = await fetchByIds(
    baseUrl, key, 'watch_records',
    'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
    ids,
  );
  const sourceById = new Map(sources.map(row => [row.id, row]));
  const expected = sources.map(analyzeRecord);
  progress('analyze_sources', expected.length, sources.length);
  const expectedById = new Map(expected.map(row => [row.source_record_id, row]));
  let candidateCount = 0;
  let exactLineageCount = 0;
  for (const row of expected) {
    const source = sourceById.get(row.source_record_id);
    for (const candidate of row.proposed_candidates || []) {
      candidateCount += 1;
      if (exactLineage(source?.raw_message, candidate.raw_line)) exactLineageCount += 1;
    }
  }

  if (write) await persist(baseUrl, key, expected);

  let persistedRows = [];
  let mismatches = [];
  if (write) {
    persistedRows = await fetchByIds(
      baseUrl, key, 'normalization_shadow_v4',
      'source_record_id,normalization_version,candidate_count,proposed_candidates,change_flags',
      ids,
    );
    const persistedById = new Map(persistedRows.map(row => [row.source_record_id, row]));
    mismatches = ids.map(id => ({ id, ...comparePersisted(expectedById.get(id), persistedById.get(id)) }))
      .filter(result => !result.matches);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    write,
    target: 'normalization_shadow_v4',
    requestedParents: limit,
    selectedParents: priorRows.length,
    sourceRows: sources.length,
    missingSources: Math.max(0, priorRows.length - sources.length),
    candidateCount,
    exactRawLineageCandidates: exactLineageCount,
    missingRawLineageCandidates: candidateCount - exactLineageCount,
    persistedRows: persistedRows.length,
    persistedMatches: write ? ids.length - mismatches.length : 0,
    persistedMismatches: mismatches.length,
    mismatchSamples: mismatches.slice(0, 20),
    firstSourceId: ids[0] || null,
    lastSourceId: ids.at(-1) || null,
    safety: {
      sourceRowsImmutable: true,
      liveRowsMutated: false,
      promotionDecision: 'none',
    },
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'bundle_cohort_complete', ...report }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'bundle_cohort_error', error: error.message })}\n`);
  process.exitCode = 1;
});
