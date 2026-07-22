'use strict';

const fs = require('node:fs');
const path = require('node:path');

const references = [
  { brand: 'Patek Philippe', reference: '5712/1A' },
  { brand: 'Patek Philippe', reference: '5712/1R' },
  { brand: 'Patek Philippe', reference: '3712/1A' },
  { brand: 'Rolex', reference: '116500LN' },
  { brand: 'Rolex', reference: '52506' },
];

function required(name) {
  const value = String(process.env[name] || '').trim().replace(/\/$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function counts(rows, field) {
  return Object.fromEntries(
    [...rows.reduce((map, row) => {
      const value = String(row[field] || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
      map.set(value, (map.get(value) || 0) + 1);
      return map;
    }, new Map())].sort((a, b) => b[1] - a[1])
  );
}

async function fetchReference(baseUrl, key, reference) {
  const rows = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const params = new URLSearchParams({
      select: 'id,brand,reference,dial_color,condition,price_usd,currency,listing_type,created_at,listing_date,verdict,listing_status,flags',
      brand: `eq.${reference.brand}`,
      reference: `eq.${reference.reference}`,
      order: 'id.asc',
      offset: String(offset),
      limit: String(pageSize),
    });
    const response = await fetch(`${baseUrl}/rest/v1/watch_records?${params.toString()}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 500)}`);
    const page = JSON.parse(body || '[]');
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function summarize(reference, rows) {
  const prices = rows.map(row => numeric(row.price_usd)).filter(Boolean);
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  const lowerFence = iqr === null ? null : q1 - 1.5 * iqr;
  const upperFence = iqr === null ? null : q3 + 1.5 * iqr;
  const statisticalOutliers = lowerFence === null ? 0 : prices.filter(price => price < lowerFence || price > upperFence).length;
  const isUnknownDial = value => !value || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-'].includes(String(value).trim().toUpperCase());
  const wts = rows.filter(row => String(row.listing_type || '').toUpperCase() === 'WTS');
  return {
    brand: reference.brand,
    reference: reference.reference,
    totalRows: rows.length,
    intentCounts: counts(rows, 'listing_type'),
    conditionCounts: counts(rows, 'condition'),
    dialCounts: counts(rows, 'dial_color'),
    unknownDialCount: rows.filter(row => isUnknownDial(row.dial_color)).length,
    missingWtsPriceCount: wts.filter(row => numeric(row.price_usd) === null).length,
    pricedRowCount: prices.length,
    price: prices.length ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      average: prices.reduce((sum, value) => sum + value, 0) / prices.length,
      median: median(prices),
      q1,
      q3,
      iqr,
      lowerFence,
      upperFence,
      statisticalOutliers,
    } : null,
    statusCounts: counts(rows, 'listing_status'),
    verdictCounts: counts(rows, 'verdict'),
    rowsWithFlags: rows.filter(row => row.flags && Object.keys(row.flags).length).length,
  };
}

async function main() {
  const baseUrl = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const summaries = [];
  for (const reference of references) {
    const rows = await fetchReference(baseUrl, key, reference);
    summaries.push(summarize(reference, rows));
  }
  const report = { generatedAt: new Date().toISOString(), source: 'public.watch_records read-only REST query', references: summaries };
  const output = path.resolve(process.env.PRIORITY_REFERENCE_AUDIT_OUTPUT || 'audit-output/price-normalization/priority-reference-audit.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'priority_reference_audit_complete', output, references: summaries.map(item => ({ brand: item.brand, reference: item.reference, totalRows: item.totalRows, pricedRowCount: item.pricedRowCount, unknownDialCount: item.unknownDialCount, statisticalOutliers: item.price?.statisticalOutliers || 0 })) })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ event: 'priority_reference_audit_error', error: error.message })}\n`);
  process.exitCode = 1;
});

module.exports = { median, percentile, summarize };
