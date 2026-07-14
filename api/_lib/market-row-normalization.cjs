'use strict';

const { parseNumber } = require('./normalization-v4.cjs');

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function explicitAmount(line, currencies) {
  const labels = currencies.join('|');
  const before = new RegExp(`(?:${labels})\\s*[:=$-]?\\s*([\\d][\\d.,]*)\\s*(K|M|MN|W|万)?`, 'i');
  const after = new RegExp(`([\\d][\\d.,]*)\\s*(K|M|MN|W|万)?\\s*(?:${labels})`, 'i');
  const match = line.match(before) || line.match(after);
  if (!match) return null;
  const amount = parseNumber(match[1], match[2]);
  return amount ? { amount, raw: match[0].trim() } : null;
}

function referenceLine(rawMessage, reference) {
  const ref = compact(reference);
  if (!ref) return null;
  return String(rawMessage || '').split(/\r?\n|\\r\\n/).find(line => compact(line).includes(ref)) || null;
}

function normalizeMarketRow(row, reference) {
  const stored = Number(row.price_usd);
  const line = referenceLine(row.raw_message, reference);
  if (!line) return { ...row, analytics_price_usd: stored, price_normalization: null, price_evidence: null };
  const usd = explicitAmount(line, ['USDT', 'USD', 'US\\$', 'U\\$']);
  if (usd) {
    const converted = Math.round(usd.amount);
    return { ...row, analytics_price_usd: converted, price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_USD_FROM_REFERENCE_LINE' : null, price_evidence: usd.raw };
  }
  const hkd = explicitAmount(line, ['HKD', 'HK\\$']);
  if (hkd) {
    const converted = Math.round(hkd.amount / 7.8);
    return { ...row, analytics_price_usd: converted, price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_HKD_FROM_REFERENCE_LINE' : null, price_evidence: hkd.raw };
  }
  return { ...row, analytics_price_usd: stored, price_normalization: null, price_evidence: null };
}

module.exports = { normalizeMarketRow, referenceLine };
