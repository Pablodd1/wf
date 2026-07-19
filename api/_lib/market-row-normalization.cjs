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
  return match ? parseNumber(match[1], match[2]) : null;
}

function structuredAmount(row) {
  const amount = Number(row?.price_raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = String(row?.currency || '').trim().toUpperCase().replace(/[^A-Z$]/g, '');
  if (['USD', 'USDT', 'US$', 'U$'].includes(currency)) {
    return { amountUsd: Math.round(amount), reason: 'STRUCTURED_ORIGINAL_PRICE_USD' };
  }
  if (['HKD', 'HDK', 'HK$', 'HK'].includes(currency)) {
    return { amountUsd: Math.round(amount / 7.8), reason: 'STRUCTURED_ORIGINAL_PRICE_HKD' };
  }
  return null;
}

function referenceLine(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  if (!refs.length) return null;
  return String(rawMessage || '').split(/\r?\n|\\r\\n/).find(line => refs.some(ref => compact(line).includes(ref))) || null;
}

function referenceBlock(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  const lines = String(rawMessage || '').split(/\r?\n|\\r\\n/);
  const index = lines.findIndex(line => refs.some(ref => compact(line).includes(ref)));
  if (index < 0) return null;
  const block = [lines[index]];
  for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
    const next = lines[index + offset].trim();
    if (!next) break;
    const tokens = next.toUpperCase().match(/[A-Z0-9]+(?:\/[A-Z0-9-]+)?/g) || [];
    const containsOtherReference = tokens.some(token => {
      const normalized = compact(token);
      if (refs.some(ref => normalized.includes(ref))) return false;
      if (/^(?:19|20)\d{2}$/.test(normalized)) return false;
      return token.includes('/') || /\d/.test(token) && normalized.length >= 5;
    });
    if (containsOtherReference) break;
    block.push(next);
  }
  return block.join(' ');
}

function normalizeMarketRow(row, reference) {
  const stored = Number(row.price_usd);
  const line = referenceBlock(row.raw_message, reference);
  if (line) {
    const usd = explicitAmount(line, ['USDT', 'USD', 'US\\$', 'U\\$']);
    if (usd) {
      const converted = Math.round(usd);
      return { ...row, analytics_price_usd: converted, price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_USD_FROM_REFERENCE_LINE' : null };
    }
    const hkd = explicitAmount(line, ['HKD', 'HDK', 'HK\\$', 'HK']);
    if (hkd) {
      const converted = Math.round(hkd / 7.8);
      return { ...row, analytics_price_usd: converted, price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_HKD_FROM_REFERENCE_LINE' : null };
    }
  }
  const structured = structuredAmount(row);
  if (structured) {
    return {
      ...row,
      analytics_price_usd: structured.amountUsd,
      price_normalization: structured.amountUsd !== Math.round(stored) ? structured.reason : null,
    };
  }
  return {
    ...row,
    analytics_price_usd: Number.isFinite(stored) && stored > 0 ? stored : null,
    price_normalization: null,
  };
}

module.exports = { normalizeMarketRow, referenceBlock, referenceLine };
