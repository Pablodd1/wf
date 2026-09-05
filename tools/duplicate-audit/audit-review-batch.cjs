'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const inputPath = process.env.DUPLICATE_REVIEW_SELECTION_CSV;
const outputPath = process.env.DUPLICATE_REVIEW_EVIDENCE_OUTPUT || 'audit-output/duplicates/review-batch-001-evidence.json';
const batchSize = Math.max(10, Math.min(Number(process.env.DUPLICATE_REVIEW_FETCH_BATCH_SIZE || 50), 100));

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

async function readCsv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('DUPLICATE_REVIEW_SELECTION_CSV must point to the selected review batch');
  const reader = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  const rows = [];
  let headers = null;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!headers) {
      headers = cells;
      continue;
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
  }
  return rows;
}

function normalizedText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function sellerRelation(left, right) {
  const leftPhone = normalizedPhone(left?.seller_phone);
  const rightPhone = normalizedPhone(right?.seller_phone);
  if (leftPhone && rightPhone) return leftPhone === rightPhone ? 'MATCHED' : 'CONFLICTING';
  const leftName = normalizedText(left?.seller_name);
  const rightName = normalizedText(right?.seller_name);
  if (leftName && rightName) return leftName === rightName ? 'MATCHED' : 'CONFLICTING';
  return 'UNKNOWN';
}

function rawRelation(left, right) {
  const a = normalizedText(left?.raw_message);
  const b = normalizedText(right?.raw_message);
  if (!a || !b) return 'UNKNOWN';
  return a === b ? 'MATCHED' : 'DIFFERENT';
}

function intentRelation(left, right) {
  const a = normalizedText(left?.listing_type);
  const b = normalizedText(right?.listing_type);
  if (!a || !b) return 'UNKNOWN';
  return a === b ? 'MATCHED' : 'CONFLICTING';
}

function recommendation(row, canonical, candidate) {
  if (!canonical || !candidate) return 'DEFER';
  if (row.bundle_risk === 'true' || String(row.canonical_id).includes('#') || String(row.candidate_id).includes('#')) return 'DEFER';
  const seller = sellerRelation(canonical, candidate);
  const raw = rawRelation(canonical, candidate);
  const intent = intentRelation(canonical, candidate);
  if (seller === 'MATCHED' && raw === 'MATCHED' && intent === 'MATCHED') return 'SUPPRESS_CANDIDATE';
  if (seller === 'CONFLICTING' || intent === 'CONFLICTING' || raw === 'DIFFERENT') return 'KEEP_BOTH_RECOMMENDED';
  return 'DEFER';
}

async function fetchRecords(baseUrl, key, ids) {
  const params = new URLSearchParams({
    select: 'id,brand,reference,dial_color,condition,price_usd,currency,raw_message,seller_name,seller_phone,listing_date,created_at,source,source_type,listing_type,flags',
    id: `in.(${ids.join(',')})`,
    limit: String(ids.length),
  });
  const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body || '[]');
}

async function main() {
  const rows = await readCsv(inputPath);
  const baseUrl = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const ids = [...new Set(rows.flatMap(row => [row.canonical_id, row.candidate_id]))];
  const sourceById = new Map();
  for (let index = 0; index < ids.length; index += batchSize) {
    const records = await fetchRecords(baseUrl, key, ids.slice(index, index + batchSize));
    records.forEach(record => sourceById.set(String(record.id), record));
  }

  const evidence = rows.map(row => {
    const canonical = sourceById.get(row.canonical_id) || null;
    const candidate = sourceById.get(row.candidate_id) || null;
    return {
      candidate: row,
      source: {
        canonical,
        duplicate: candidate,
        seller_relation: sellerRelation(canonical, candidate),
        raw_relation: rawRelation(canonical, candidate),
        intent_relation: intentRelation(canonical, candidate),
        source_rows_found: Boolean(canonical && candidate),
      },
      review_status: 'PENDING',
      recommendation: recommendation(row, canonical, candidate),
      safe_to_auto_apply: false,
    };
  });
  const summary = {
    rowsAudited: evidence.length,
    sourcePairsMatched: evidence.filter(item => item.source.source_rows_found).length,
    sourcePairsMissing: evidence.filter(item => !item.source.source_rows_found).length,
    sellerMatched: evidence.filter(item => item.source.seller_relation === 'MATCHED').length,
    sellerConflicting: evidence.filter(item => item.source.seller_relation === 'CONFLICTING').length,
    sellerUnknown: evidence.filter(item => item.source.seller_relation === 'UNKNOWN').length,
    rawMatched: evidence.filter(item => item.source.raw_relation === 'MATCHED').length,
    intentConflicting: evidence.filter(item => item.source.intent_relation === 'CONFLICTING').length,
    recommendations: Object.fromEntries([...new Set(evidence.map(item => item.recommendation))].map(value => [value, evidence.filter(item => item.recommendation === value).length])),
    writesApplied: 0,
  };
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, evidence }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'duplicate_review_batch_audited', output: target, ...summary })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'duplicate_review_batch_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { intentRelation, normalizedPhone, normalizedText, rawRelation, sellerRelation };
