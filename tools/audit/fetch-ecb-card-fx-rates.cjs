'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const DEFAULT_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'IDR', 'MYR', 'SGD', 'USD',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parse = line => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { values.push(value); value = ''; }
      else value += char;
    }
    values.push(value);
    return values;
  };
  const headers = parse(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(headers.map((header, index) => [header, parse(line)[index]])));
}

function calendarDates(start, end) {
  const values = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);
  while (cursor <= final) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

function buildRates(csv, start, end, sourceUrl) {
  const responseSha = sha256(Buffer.from(csv));
  const observations = new Map();
  for (const row of csvRows(csv)) {
    const currency = String(row.CURRENCY || row.currency || '').toUpperCase();
    const date = String(row.TIME_PERIOD || row.time_period || '');
    const value = Number(row.OBS_VALUE || row.obs_value);
    if (currency && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) {
      observations.set(`${date}|${currency}`, value);
    }
  }
  const currencies = [...new Set([...observations.keys()].map(key => key.split('|')[1]))]
    .filter(currency => currency !== 'USD');
  const effectiveDates = [...new Set([...observations.keys()].map(key => key.split('|')[0]))].sort();
  const result = [];
  for (const applicable of calendarDates(start, end)) {
    const effective = [...effectiveDates].reverse().find(date => date <= applicable
      && (Date.parse(`${applicable}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000 <= 7);
    if (!effective) continue;
    const usdPerEur = observations.get(`${effective}|USD`);
    if (!usdPerEur) continue;
    const lookback = Math.round((Date.parse(`${applicable}T00:00:00Z`) - Date.parse(`${effective}T00:00:00Z`)) / 86400000);
    result.push({ provider: 'ECB', source_currency: 'EUR', applicable_date: applicable,
      effective_date: effective, lookback_days: lookback, rate_direction: 'USD_PER_SOURCE_UNIT',
      usd_per_source_unit: usdPerEur, source_url: sourceUrl, source_response_sha256: responseSha });
    for (const currency of currencies) {
      const sourcePerEur = observations.get(`${effective}|${currency}`);
      if (!sourcePerEur) continue;
      result.push({ provider: 'ECB', source_currency: currency, applicable_date: applicable,
        effective_date: effective, lookback_days: lookback, rate_direction: 'USD_PER_SOURCE_UNIT',
        usd_per_source_unit: usdPerEur / sourcePerEur, source_url: sourceUrl,
        source_response_sha256: responseSha });
    }
  }
  return result;
}

async function main() {
  const start = process.env.CARD_EVIDENCE_FX_START_DATE;
  const end = process.env.CARD_EVIDENCE_FX_END_DATE;
  const output = process.env.CARD_EVIDENCE_FX_OUTPUT;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || !output) {
    throw new Error('CARD_EVIDENCE_FX_START_DATE, CARD_EVIDENCE_FX_END_DATE, and CARD_EVIDENCE_FX_OUTPUT are required');
  }
  const requested = [...new Set(String(process.env.CARD_EVIDENCE_FX_CURRENCIES || DEFAULT_CURRENCIES.join(','))
    .split(',').map(value => value.trim().toUpperCase()).filter(Boolean))];
  if (!requested.includes('USD')) requested.push('USD');
  const series = requested.filter(currency => currency !== 'EUR').join('+');
  const sourceUrl = `https://data-api.ecb.europa.eu/service/data/EXR/D.${series}.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
  const response = await fetch(sourceUrl, { headers: { accept: 'text/csv' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`ECB request failed: ${response.status}`);
  const csv = await response.text();
  const rates = buildRates(csv, start, end, sourceUrl);
  if (!rates.length) throw new Error('ECB response produced no verified rates');
  fs.writeFileSync(output, `${JSON.stringify(rates)}\n`);
  process.stdout.write(`${JSON.stringify({ provider: 'ECB', start, end, rates: rates.length,
    currencies: [...new Set(rates.map(row => row.source_currency))] })}\n`);
}

if (require.main === module) {
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}

module.exports = { buildRates, calendarDates, csvRows, sha256 };
