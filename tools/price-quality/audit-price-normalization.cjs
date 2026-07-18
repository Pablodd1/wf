'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeMarketRow, referenceBlock } = require('../../api/_lib/market-row-normalization.cjs');

const DEFAULT_OUTPUT = 'audit-output/price-normalization/mismatches.json';
const DEFAULT_CSV_OUTPUT = 'audit-output/price-normalization/mismatches.csv';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_MIN_DELTA_PCT = 5;
const DEFAULT_SAMPLE_LIMIT = 200;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function percentDelta(stored, normalized) {
  if (!Number.isFinite(stored) || stored <= 0 || !Number.isFinite(normalized) || normalized <= 0) return null;
  return Math.abs((normalized - stored) / stored) * 100;
}

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function repeatedReferenceCount(evidenceLine, reference) {
  const ref = compact(reference);
  const text = compact(evidenceLine);
  if (!ref || !text) return 0;
  return text.split(ref).length - 1;
}

function classifyMismatch(row, normalizedPrice, normalizationReason, evidenceLine = '') {
  const stored = Number(row.price_usd);
  const deltaPct = percentDelta(stored, normalizedPrice);
  const ratio = Number.isFinite(stored) && stored > 0 ? normalizedPrice / stored : null;
  const flags = [];

  if (normalizationReason) flags.push(normalizationReason);
  if (repeatedReferenceCount(evidenceLine, row.reference) > 1) flags.push('REPEATED_REFERENCE_BLOCK_REVIEW');
  if (Number.isFinite(ratio) && ratio >= 6.5 && ratio <= 9.5) flags.push('LIKELY_LEGACY_HKD_DOUBLE_CONVERSION');
  if (Number.isFinite(normalizedPrice) && normalizedPrice > 0 && normalizedPrice < 500) flags.push('NORMALIZED_PRICE_BELOW_LUXURY_FLOOR');
  if (Number.isFinite(stored) && stored > 0 && stored < 500) flags.push('STORED_PRICE_BELOW_LUXURY_FLOOR');
  if (Number.isFinite(deltaPct) && deltaPct >= 50) flags.push('MAJOR_PRICE_DELTA');
  else if (Number.isFinite(deltaPct) && deltaPct >= 20) flags.push('MATERIAL_PRICE_DELTA');
  else if (Number.isFinite(deltaPct) && deltaPct > 0) flags.push('MINOR_PRICE_DELTA');

  let severity = 'low';
  if (
    flags.includes('LIKELY_LEGACY_HKD_DOUBLE_CONVERSION') ||
    flags.includes('NORMALIZED_PRICE_BELOW_LUXURY_FLOOR') ||
    flags.includes('STORED_PRICE_BELOW_LUXURY_FLOOR') ||
    flags.includes('MAJOR_PRICE_DELTA')
  ) {
    severity = 'high';
  } else if (flags.includes('MATERIAL_PRICE_DELTA')) {
    severity = 'medium';
  }

  return {
    flags,
    severity,
    delta_pct: deltaPct == null ? null : Number(deltaPct.toFixed(2)),
    ratio: ratio == null ? null : Number(ratio.toFixed(4)),
  };
}

function auditRow(row, options = {}) {
  const minDeltaPct = options.minDeltaPct ?? DEFAULT_MIN_DELTA_PCT;
  const stored = Number(row.price_usd);
  if (!row.reference || !Number.isFinite(stored) || stored <= 0 || !row.raw_message) return null;

  const normalized = normalizeMarketRow(row, row.reference);
  const normalizedPrice = Number(normalized.analytics_price_usd);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) return null;

  const deltaPct = percentDelta(stored, normalizedPrice);
  if (!normalized.price_normalization || deltaPct == null || deltaPct < minDeltaPct) return null;

  const evidenceLine = referenceBlock(row.raw_message, row.reference);
  const classification = classifyMismatch(row, normalizedPrice, normalized.price_normalization, evidenceLine);
  return {
    id: row.id,
    brand: row.brand || null,
    reference: row.reference || null,
    dial_color: row.dial_color || null,
    condition: row.condition || null,
    listing_type: row.listing_type || null,
    created_at: row.created_at || null,
    listing_date: row.listing_date || null,
    currency: row.currency || null,
    stored_price_usd: Math.round(stored),
    normalized_price_usd: Math.round(normalizedPrice),
    price_normalization: normalized.price_normalization,
    ...classification,
    evidence_line: evidenceLine,
    raw_message_preview: String(row.raw_message || '').slice(0, 500),
  };
}

function bump(map, key) {
  const label = key || 'UNKNOWN';
  map[label] = (map[label] || 0) + 1;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeOutputs(report, outputPath, csvPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  const columns = [
    'id',
    'brand',
    'reference',
    'dial_color',
    'condition',
    'listing_type',
    'stored_price_usd',
    'normalized_price_usd',
    'delta_pct',
    'ratio',
    'severity',
    'price_normalization',
    'flags',
    'evidence_line',
  ];
  const lines = [
    columns.join(','),
    ...report.samples.map(row => columns.map(column => {
      const value = column === 'flags' ? row.flags.join('|') : row[column];
      return csvEscape(value);
    }).join(',')),
  ];
  fs.writeFileSync(csvPath, `${lines.join('\n')}\n`);
}

async function rest(baseUrl, key, pathname) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchPage(baseUrl, key, lastId, limit) {
  const params = new URLSearchParams({
    select: 'id,brand,reference,dial_color,condition,listing_type,created_at,listing_date,currency,price_usd,raw_message',
    order: 'id.asc',
    limit: String(limit),
    price_usd: 'gt.0',
    reference: 'not.is.null',
    raw_message: 'not.is.null',
  });
  if (lastId) params.set('id', `gt.${lastId}`);
  return rest(baseUrl, key, `watch_records?${params.toString()}`);
}

async function scan() {
  const baseUrl = required('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const pageSize = numberFromEnv('PRICE_AUDIT_PAGE_SIZE', DEFAULT_PAGE_SIZE, 50, 1000);
  const maxRows = numberFromEnv('PRICE_AUDIT_MAX_ROWS', DEFAULT_MAX_ROWS, 1, 500000);
  const minDeltaPct = numberFromEnv('PRICE_AUDIT_MIN_DELTA_PCT', DEFAULT_MIN_DELTA_PCT, 0.01, 100);
  const sampleLimit = numberFromEnv('PRICE_AUDIT_SAMPLE_LIMIT', DEFAULT_SAMPLE_LIMIT, 1, 10000);
  const outputPath = path.resolve(process.env.PRICE_AUDIT_OUTPUT || DEFAULT_OUTPUT);
  const csvPath = path.resolve(process.env.PRICE_AUDIT_CSV_OUTPUT || DEFAULT_CSV_OUTPUT);

  let scanned = 0;
  let lastId = '';
  const samples = [];
  const counts = {
    mismatchRows: 0,
    bySeverity: {},
    byReason: {},
    byFlag: {},
    byBrand: {},
  };

  while (scanned < maxRows) {
    const limit = Math.min(pageSize, maxRows - scanned);
    const rows = await fetchPage(baseUrl, key, lastId, limit);
    if (!rows.length) break;
    scanned += rows.length;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      const finding = auditRow(row, { minDeltaPct });
      if (!finding) continue;
      counts.mismatchRows += 1;
      bump(counts.bySeverity, finding.severity);
      bump(counts.byReason, finding.price_normalization);
      bump(counts.byBrand, finding.brand);
      for (const flag of finding.flags) bump(counts.byFlag, flag);
      if (samples.length < sampleLimit) samples.push(finding);
    }

    process.stdout.write(`${JSON.stringify({
      event: 'price_audit_page',
      scanned,
      mismatches: counts.mismatchRows,
      lastId,
    })}\n`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    scope: {
      table: 'watch_records',
      grain: 'one dated listing observation',
      scannedRows: scanned,
      lastId,
      pageSize,
      maxRows,
      minDeltaPct,
      sampleLimit,
    },
    counts,
    samples,
    recommendations: [
      'Keep Price Research and detail modals using raw-message-derived prices when explicit line currency evidence exists.',
      'Use this report as the review queue for any future stored price_usd remediation.',
      'Only auto-apply corrections when evidence_line has explicit USD/USDT or HKD/HK$ tied to the same reference block.',
      'Keep rows with bundle or ambiguous reference context in human review until line splitting is approved.',
    ],
  };

  writeOutputs(report, outputPath, csvPath);
  console.log(JSON.stringify({ event: 'price_audit_complete', outputPath, csvPath, scanned, mismatches: counts.mismatchRows }));
}

if (require.main === module) {
  scan().catch(error => {
    console.error(JSON.stringify({ event: 'price_audit_error', error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { auditRow, classifyMismatch, percentDelta };
