'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const inputPath = process.env.DUPLICATE_CANDIDATE_CSV;
const apply = String(process.env.APPLY_DUPLICATE_REVIEW_CANDIDATES || 'false').toLowerCase() === 'true';
const maxRows = Math.max(1, Math.min(Number(process.env.DUPLICATE_CANDIDATE_MAX_ROWS || 100), 1000));
const scanLimit = Math.max(maxRows, Math.min(Number(process.env.DUPLICATE_CANDIDATE_SCAN_LIMIT || maxRows * 20), 20_000));

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readCandidates(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('DUPLICATE_CANDIDATE_CSV must point to a readable candidate-clusters.csv');
  const input = fs.createReadStream(filePath);
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const rows = [];
  const blocked = { bundleRisk: 0, syntheticChildId: 0, invalid: 0 };
  let scanned = 0;
  let headers = null;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!headers) {
      headers = cells;
      continue;
    }
    scanned += 1;
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    if (!row.canonical_id || !row.candidate_id || row.canonical_id === row.candidate_id) {
      blocked.invalid += 1;
    } else if (String(row.bundle_risk).toLowerCase() === 'true') {
      blocked.bundleRisk += 1;
    } else if (String(row.canonical_id).includes('#') || String(row.candidate_id).includes('#')) {
      blocked.syntheticChildId += 1;
    } else {
      rows.push(row);
    }
    if (rows.length >= maxRows || scanned >= scanLimit) break;
  }
  return { rows, scanned, blocked, headers };
}

function writeSelection(filePath, headers, rows) {
  if (!filePath || !rows.length) return null;
  const target = require('node:path').resolve(filePath);
  fs.mkdirSync(require('node:path').dirname(target), { recursive: true });
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(','));
  fs.writeFileSync(target, `${lines.join('\n')}\n`);
  return target;
}

async function validateSourceIds(baseUrl, key, rows) {
  const ids = [...new Set(rows.flatMap(row => [row.canonical_id, row.candidate_id]))];
  if (!ids.length) return { missing: [] };
  const params = new URLSearchParams({ select: 'id', id: `in.(${ids.join(',')})`, limit: String(ids.length) });
  const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const found = new Set((await response.json()).map(row => String(row.id)));
  return { missing: ids.filter(id => !found.has(id)) };
}

async function upsertRows(baseUrl, key, rows) {
  const payload = rows.map(row => ({
    canonical_id: row.canonical_id,
    duplicate_id: row.candidate_id,
    match_type: row.category || 'UNCLASSIFIED',
    confidence: Math.min(1, Math.max(0, Number(row.confidence) || 0)),
    suppress_from_analytics: String(row.suppress_from_analytics).toLowerCase() === 'true',
    bundle_risk: String(row.bundle_risk).toLowerCase() === 'true',
    evidence: {
      canonical_date: row.canonical_date || null,
      candidate_date: row.candidate_date || null,
      reference: row.reference || null,
      dial: row.dial || null,
      condition: row.condition || null,
      canonical_price: row.canonical_price || null,
      candidate_price: row.candidate_price || null,
      source_hash: row.source_hash || null,
      source_report: inputPath,
    },
  }));
  const response = await fetch(`${baseUrl}/rest/v1/duplicate_review_candidates?on_conflict=canonical_id,duplicate_id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

async function main() {
  const selection = await readCandidates(inputPath);
  const rows = selection.rows;
  const selectionOutput = writeSelection(process.env.DUPLICATE_REVIEW_SELECTION_OUTPUT, selection.headers, rows);
  let missing = [];
  if (apply && rows.length) {
    const baseUrl = required('SUPABASE_URL');
    const key = required('SUPABASE_SERVICE_ROLE_KEY');
    ({ missing } = await validateSourceIds(baseUrl, key, rows));
    if (missing.length) throw new Error(`Candidate source IDs are missing from watch_records: ${missing.slice(0, 10).join(',')}`);
    await upsertRows(baseUrl, key, rows);
  }
  process.stdout.write(`${JSON.stringify({
    event: 'duplicate_review_candidates_staged',
    rows: rows.length,
    scanned: selection.scanned,
    blocked: selection.blocked,
    missingSourceIds: missing.length,
    selectionOutput,
    write: apply,
    publicRowsMutated: 0,
  })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'duplicate_review_candidates_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { parseCsvLine, readCandidates, validateSourceIds };
