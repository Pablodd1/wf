'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeRecord } = require('../shadow-reprocess/shadow-reprocess.cjs');

const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_OUTPUT = 'audit-output/emoji-prices/private-samples.json';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function boundedNumber(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function pseudonym(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function maskPrivateContact(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/\+\d[\d\s().-]{7,}\d/g, '[PHONE]')
    .replace(/\b(?:\d[\s().-]){7,}\d\b/g, '[PHONE]');
}

function pictographs(value) {
  const withoutKeycaps = String(value || '').replace(/[0-9]\uFE0F?\u20E3/gu, '');
  return [...withoutKeycaps.matchAll(/\p{Extended_Pictographic}(?:\uFE0F)?/gu)].map(match => match[0]);
}

function codePoints(value) {
  return [...String(value || '')]
    .map(character => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

function summarizeRows(rows) {
  const tokens = new Map();
  const privateSamples = [];

  for (const row of rows) {
    const candidates = Array.isArray(row.proposed_candidates) ? row.proposed_candidates : [];
    const rawLines = candidates.map(candidate => candidate?.raw_line).filter(Boolean);
    for (const rawLine of rawLines) {
      const symbols = pictographs(rawLine);
      if (!symbols.length) continue;
      for (const symbol of symbols) {
        const key = `${symbol}|${codePoints(symbol)}`;
        const current = tokens.get(key) || {
          token: symbol,
          code_points: codePoints(symbol),
          occurrences: 0,
          records: new Set(),
          brands: new Set(),
          currencies: new Set(),
        };
        current.occurrences += 1;
        current.records.add(pseudonym(row.source_record_id));
        if (row.source_brand) current.brands.add(row.source_brand);
        if (row.source_currency) current.currencies.add(row.source_currency);
        tokens.set(key, current);
      }

      privateSamples.push({
        source_record_pseudonym: pseudonym(row.source_record_id),
        source_brand: row.source_brand || null,
        source_reference: row.source_reference || null,
        source_currency: row.source_currency || null,
        pictographs: [...new Set(symbols)].map(symbol => ({ token: symbol, code_points: codePoints(symbol) })),
        masked_raw_line: maskPrivateContact(rawLine),
      });
    }
  }

  return {
    tokens: [...tokens.values()]
      .map(item => ({
        token: item.token,
        code_points: item.code_points,
        occurrences: item.occurrences,
        record_count: item.records.size,
        brands: [...item.brands].sort(),
        currencies: [...item.currencies].sort(),
      }))
      .sort((left, right) => right.record_count - left.record_count || left.code_points.localeCompare(right.code_points)),
    privateSamples,
  };
}

async function supabaseRequest(baseUrl, key, relativePath, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${relativePath}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function readRows(baseUrl, key, maxRows, pageSize) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - offset);
    const params = new URLSearchParams({
      select: 'source_record_id,source_brand,source_reference,source_currency,proposed_candidates,change_flags,analyzed_at',
      change_flags: 'cs.{EMOJI_PRICE_AMBIGUOUS}',
      order: 'source_record_id.asc',
      limit: String(limit),
      offset: String(offset),
    });
    const response = await supabaseRequest(baseUrl, key, `normalization_shadow_v4?${params}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

async function countRows(baseUrl, key, mode) {
  const response = await supabaseRequest(
    baseUrl,
    key,
    'normalization_shadow_v4?select=source_record_id&change_flags=cs.{EMOJI_PRICE_AMBIGUOUS}',
    { method: 'HEAD', headers: { Prefer: `count=${mode}` } },
  );
  return Number((response.headers.get('content-range') || '').split('/')[1] || 0);
}

function currentParserFindings(records) {
  return records
    // Avoid expensive catalog/parser work for rows that cannot contain a
    // private pictographic code. Numeric keycaps are intentionally excluded.
    .filter(row => pictographs(row.raw_message).length > 0)
    .map(analyzeRecord)
    .filter(row => row.change_flags.includes('EMOJI_PRICE_AMBIGUOUS'));
}

async function readCurrentParserFindings(baseUrl, key, maxRows, pageSize) {
  const findings = [];
  let scanned = 0;
  let lastId = String(process.env.EMOJI_AUDIT_START_ID || '').trim();

  while (scanned < maxRows) {
    const limit = Math.min(pageSize, maxRows - scanned);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('id', `gt.${lastId}`);
    const response = await supabaseRequest(baseUrl, key, `watch_records?${params}`);
    const page = await response.json();
    if (!page.length) break;
    scanned += page.length;
    lastId = page[page.length - 1].id;
    findings.push(...currentParserFindings(page));
    if (page.length < limit) break;
  }

  return { findings, scanned, lastId };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SECRET_KEY || required('SUPABASE_SERVICE_ROLE_KEY');
  const maxRows = boundedNumber('EMOJI_AUDIT_MAX_ROWS', DEFAULT_MAX_ROWS, 1, 25000);
  const pageSize = boundedNumber('EMOJI_AUDIT_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 1000);
  const outputPath = path.resolve(process.env.EMOJI_AUDIT_OUTPUT || DEFAULT_OUTPUT);
  const totalPlanned = await countRows(baseUrl, key, 'planned');
  const totalExact = await countRows(baseUrl, key, 'exact');
  const rows = await readRows(baseUrl, key, maxRows, pageSize);
  const scanCurrent = String(process.env.EMOJI_AUDIT_SCAN_CURRENT || '').toLowerCase() === 'true';
  const current = scanCurrent
    ? await readCurrentParserFindings(baseUrl, key, maxRows, pageSize)
    : { findings: [], scanned: 0, lastId: null };
  const summary = summarizeRows(scanCurrent ? current.findings : rows);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: scanCurrent ? 'bounded_current_parser_rescan' : 'materialized_shadow_flags',
    rows_scanned: scanCurrent ? current.scanned : rows.length,
    last_source_record_id: scanCurrent && current.lastId ? pseudonym(current.lastId) : null,
    flagged_rows: scanCurrent ? current.findings.length : rows.length,
    samples: summary.privateSamples,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    total_flagged_exact: totalExact,
    total_flagged_planned: totalPlanned,
    rows_scanned: rows.length,
    scan_truncated: rows.length < totalExact,
    current_parser_rescan: {
      enabled: scanCurrent,
      rows_scanned: current.scanned,
      flagged_rows: current.findings.length,
      last_source_record_pseudonym: current.lastId ? pseudonym(current.lastId) : null,
    },
    token_summary: summary.tokens,
    private_output: outputPath,
    safety: {
      read_only: true,
      meanings_inferred: false,
      prices_changed: false,
      seller_contact_published: false,
    },
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'emoji_price_audit_error', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = {
  codePoints,
  currentParserFindings,
  maskPrivateContact,
  pictographs,
  pseudonym,
  summarizeRows,
};
