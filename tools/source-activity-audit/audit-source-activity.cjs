'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { intentBucket, observedPoster, postingYear, pseudonym } = require('./source-identity.cjs');

const pageSize = Math.min(1000, Math.max(50, Number(process.env.SOURCE_AUDIT_PAGE_SIZE || 500)));
const maxRows = Math.max(0, Number(process.env.SOURCE_AUDIT_MAX_ROWS || 0));
const outputDir = path.resolve(process.env.SOURCE_AUDIT_OUTPUT || 'audit-output/source-activity');
const statePath = path.join(outputDir, 'checkpoint.json');
const resume = String(process.env.SOURCE_AUDIT_RESUME || 'true').toLowerCase() !== 'false';
const includeRawMessage = String(process.env.SOURCE_AUDIT_INCLUDE_RAW_MESSAGE || 'false').toLowerCase() === 'true';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function newState(keyFingerprint) {
  return {
    version: 2,
    keyFingerprint,
    lastId: '',
    rowsScanned: 0,
    resolvedRows: 0,
    unresolvedRows: 0,
    evidence: {},
    intents: {},
    postingYears: {},
    sources: {},
    posters: {},
  };
}

function loadState(keyFingerprint) {
  if (!resume || !fs.existsSync(statePath)) return newState(keyFingerprint);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.version !== 2) {
    throw new Error('Existing checkpoint used import timestamps as posting dates; use a new output directory');
  }
  if (state.keyFingerprint !== keyFingerprint) {
    throw new Error('SOURCE_AUDIT_HASH_KEY does not match the existing checkpoint; use the original key or a new output directory');
  }
  return state;
}

function increment(target, key, amount = 1) {
  const normalized = String(key || 'UNKNOWN');
  target[normalized] = (target[normalized] || 0) + amount;
}

async function fetchPage(baseUrl, serviceKey, lastId) {
  const columns = ['id', 'seller_phone', 'seller_name', 'listing_type', 'listing_date', 'created_at', 'source', 'source_type', 'flags'];
  if (includeRawMessage) columns.push('raw_message');
  const params = new URLSearchParams({
    select: columns.join(','),
    order: 'id.asc',
    limit: String(pageSize),
  });
  if (lastId) params.set('id', `gt.${lastId}`);
  const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
}

function lineageKey(sourceTable, sourceId) {
  const table = String(sourceTable || '').trim().toLowerCase();
  const id = String(sourceId || '').trim().toLowerCase();
  return table && id ? `${table}|${id}` : '';
}

async function loadRawLineage(baseUrl, serviceKey) {
  const lineage = new Map();
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      select: 'source_table,raw_data',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${baseUrl}/rest/v1/raw_records?${params}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) throw new Error(`Supabase raw lineage ${response.status}: ${await response.text()}`);
    const rows = await response.json();
    for (const row of rows) {
      const key = lineageKey(row.source_table, row.raw_data?.id);
      const companyId = String(row.raw_data?.company_id || '').trim();
      if (key && companyId) lineage.set(key, companyId);
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return lineage;
}

function writeCheckpoint(state) {
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`);
  fs.renameSync(temporary, statePath);
}

function csv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeReports(state) {
  const posters = Object.entries(state.posters)
    .map(([posterId, values]) => ({ posterId, ...values }))
    .sort((left, right) => right.total - left.total);
  const rows = ['poster_id,evidence,total,wts,wtb,trade,multi,other,unknown,first_post,last_post,posting_years,source_systems'];
  for (const poster of posters) {
    rows.push([
      poster.posterId,
      Object.keys(poster.evidence).join('|'),
      poster.total,
      poster.intents.WTS || 0,
      poster.intents.WTB || 0,
      poster.intents.TRADE || 0,
      poster.intents.MULTI || 0,
      poster.intents.OTHER || 0,
      poster.intents.UNKNOWN || 0,
      poster.firstPost || '',
      poster.lastPost || '',
      Object.entries(poster.years).sort().map(([year, count]) => `${year}:${count}`).join('|'),
      Object.entries(poster.sources).sort().map(([source, count]) => `${source}:${count}`).join('|'),
    ].map(csv).join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'poster-activity.csv'), `${rows.join('\n')}\n`);

  const summary = {
    generatedAt: new Date().toISOString(),
    complete: !maxRows,
    rawMessageEnvelopeScan: includeRawMessage,
    rowsScanned: state.rowsScanned,
    observedPosterCount: posters.length,
    resolvedRows: state.resolvedRows,
    unresolvedRows: state.unresolvedRows,
    coveragePercent: state.rowsScanned ? Number((state.resolvedRows / state.rowsScanned * 100).toFixed(2)) : 0,
    evidence: state.evidence,
    intents: state.intents,
    postingYears: state.postingYears,
    sources: state.sources,
  };
  fs.writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [
    '# Source And Poster Activity Audit', '',
    `Generated: ${summary.generatedAt}`, '',
    '## Coverage', '',
    `- Rows scanned: ${summary.rowsScanned.toLocaleString()}`,
    `- Distinct observed poster pseudonyms: ${summary.observedPosterCount.toLocaleString()}`,
    `- Rows with observed poster evidence: ${summary.resolvedRows.toLocaleString()}`,
    `- Rows without poster evidence: ${summary.unresolvedRows.toLocaleString()}`,
    `- Observed-poster coverage: ${summary.coveragePercent}%`, '',
    '## Intent', '',
    ...Object.entries(summary.intents).sort().map(([key, value]) => `- ${key}: ${value.toLocaleString()}`), '',
    '## Posting Years', '',
    ...Object.entries(summary.postingYears).sort().map(([key, value]) => `- ${key}: ${value.toLocaleString()}`), '',
    '## Safety And Interpretation', '',
    '- This is a read-only operational report. It does not update, delete, suppress, or publish any listing.',
    '- Poster IDs are keyed HMAC pseudonyms; phone numbers and names are never written to report files.',
    '- An observed poster is not a verified dealer. Customer attribution remains blocked until dealer lineage and consent are verified.',
    '- NTQ is counted with WTB according to the current product rule.',
    '- Posting year uses only listing_date, the preserved original source timestamp; import created_at is never substituted.', '',
  ];
  fs.writeFileSync(path.join(outputDir, 'summary.md'), lines.join('\n'));
  return summary;
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const hashKey = required('SOURCE_AUDIT_HASH_KEY');
  const keyFingerprint = crypto.createHash('sha256').update(hashKey).digest('hex').slice(0, 12);
  fs.mkdirSync(outputDir, { recursive: true });
  const state = loadState(keyFingerprint);
  const rawLineage = await loadRawLineage(baseUrl, serviceKey);
  process.stdout.write(`${JSON.stringify({ event: 'source_audit_lineage_loaded', matchedSourceRows: rawLineage.size })}\n`);

  while (!maxRows || state.rowsScanned < maxRows) {
    const records = await fetchPage(baseUrl, serviceKey, state.lastId);
    if (!records.length) break;
    for (const row of records) {
      if (maxRows && state.rowsScanned >= maxRows) break;
      state.rowsScanned += 1;
      state.lastId = row.id;
      const intent = intentBucket(row.listing_type);
      const year = postingYear(row);
      const source = String(row.flags?.source_table || row.source_type || row.source || 'UNKNOWN').trim() || 'UNKNOWN';
      increment(state.intents, intent);
      increment(state.postingYears, year || 'UNKNOWN');
      increment(state.sources, source);

      const companyId = rawLineage.get(lineageKey(row.flags?.source_table, row.flags?.mysql_id));
      const poster = companyId
        ? { value: companyId, evidence: 'RAW_COMPANY_ID' }
        : observedPoster(row);
      if (!poster) {
        state.unresolvedRows += 1;
        continue;
      }
      state.resolvedRows += 1;
      increment(state.evidence, poster.evidence);
      const posterId = pseudonym(poster.value, hashKey);
      const activity = state.posters[posterId] || { total: 0, intents: {}, years: {}, evidence: {}, sources: {}, firstPost: null, lastPost: null };
      activity.total += 1;
      increment(activity.intents, intent);
      increment(activity.years, year || 'UNKNOWN');
      increment(activity.evidence, poster.evidence);
      increment(activity.sources, source);
      const postDate = row.listing_date || null;
      if (postDate && (!activity.firstPost || postDate < activity.firstPost)) activity.firstPost = postDate;
      if (postDate && (!activity.lastPost || postDate > activity.lastPost)) activity.lastPost = postDate;
      state.posters[posterId] = activity;
    }
    writeCheckpoint(state);
    process.stdout.write(`${JSON.stringify({ event: 'source_audit_page', rowsScanned: state.rowsScanned, observedPosters: Object.keys(state.posters).length, resolvedRows: state.resolvedRows, lastId: state.lastId })}\n`);
    if (records.length < pageSize) break;
  }

  const summary = writeReports(state);
  process.stdout.write(`${JSON.stringify({ event: 'source_audit_complete', outputDir, ...summary })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'source_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});
