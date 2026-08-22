'use strict';

const { parseNumber, splitMessageLines } = require('./normalization-v4.cjs');

function compact(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function explicitAmount(line, currencies) {
  const labels = currencies.join('|');
  const before = new RegExp(`(?:${labels})\\s*[:=$-]?\\s*([\\d][\\d.,]*)\\s*(K|M|MN|W|\\u4E07)?(?![\\dA-Z])`, 'i');
  const after = new RegExp(`([\\d][\\d.,]*)\\s*(K|M|MN|W|\\u4E07)?\\s*(?:${labels})`, 'i');
  const currentYear = new Date().getUTCFullYear();
  return [line.match(before), line.match(after)]
    .filter(Boolean)
    .map(match => parseNumber(match[1], match[2]))
    .find(amount => amount && !(Number.isInteger(amount) && amount >= 1900 && amount <= currentYear + 2)) || null;
}

function hasCurrencyToken(line, currencies) {
  const labels = currencies.join('|');
  return new RegExp(`(?:${labels})`, 'i').test(String(line || ''));
}

function referenceLine(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  if (!refs.length) return null;
  return splitMessageLines(rawMessage).find(line => refs.some(ref => compact(line).includes(ref))) || null;
}

function referenceBlock(rawMessage, reference) {
  const refs = (Array.isArray(reference) ? reference : [reference]).map(compact).filter(Boolean);
  const lines = splitMessageLines(rawMessage);
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
  const parsedStored = Number(row.price_usd);
  const stored = Number.isFinite(parsedStored) && parsedStored > 0 ? parsedStored : null;
  const line = referenceBlock(row.raw_message, reference);
  // Price Research is intentionally stricter than the Trading Floor. A stored
  // number without reference-line currency proof can be displayed as a listing,
  // but cannot influence market statistics.
  if (!line) {
    return { ...row, analytics_price_usd: stored, price_normalization: null, analytics_currency_status: stored ? 'CURRENCY_UNVERIFIED' : 'MISSING_PRICE' };
  }
  const usd = explicitAmount(line, ['USDT', 'USD', 'US\\$', 'U\\$']);
  if (usd) {
    const converted = Math.round(usd);
    return {
      ...row,
      analytics_price_usd: converted,
      price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_USD_FROM_REFERENCE_LINE' : null,
      analytics_currency_status: 'VERIFIED',
      source_price_amount: converted,
      source_currency: 'USD',
    };
  }
  const hkd = explicitAmount(line, ['HKD', 'HDK', 'HK\\$']);
  if (hkd) {
    const usdPerUnit = Number(row.conversion_rate || row.analytics_fx_rate);
    const hasDatedRate = Number.isFinite(usdPerUnit) && usdPerUnit > 0
      && Boolean(row.conversion_timestamp || row.analytics_fx_date);
    const converted = hasDatedRate ? Math.round(hkd * usdPerUnit) : Math.round(hkd / 7.8);
    return {
      ...row,
      analytics_price_usd: converted,
      price_normalization: converted !== Math.round(stored) ? 'EXPLICIT_HKD_FROM_REFERENCE_LINE' : null,
      analytics_currency_status: hasDatedRate ? 'VERIFIED' : 'CURRENCY_RATE_UNVERIFIED',
      analytics_fx_rate: hasDatedRate ? usdPerUnit : 7.8,
      analytics_fx_rate_basis: hasDatedRate ? 'USD_PER_SOURCE_UNIT' : 'HKD_PER_USD',
      analytics_fx_source: hasDatedRate ? (row.conversion_source || row.analytics_fx_source || 'PIPELINE_DATED_RATE') : 'LEGACY_FIXED_RATE_REVIEW_ONLY',
      analytics_fx_date: hasDatedRate ? (row.conversion_timestamp || row.analytics_fx_date) : null,
      source_price_amount: hkd,
      source_currency: 'HKD',
    };
  }
  if (hasCurrencyToken(line, ['EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD'])) {
    return { ...row, analytics_price_usd: stored, price_normalization: null, analytics_currency_status: 'CURRENCY_RATE_UNVERIFIED' };
  }
  if (/\$\s*\d/.test(line)) {
    const amount = explicitAmount(line, ['\\$']);
    return {
      ...row,
      analytics_price_usd: amount || stored,
      price_normalization: null,
      analytics_currency_status: amount || stored ? 'AMBIGUOUS_DOLLAR_CURRENCY' : 'MISSING_PRICE',
      source_price_amount: amount || stored,
      source_currency: null,
      source_currency_evidence: 'BARE_DOLLAR_UNRESOLVED',
    };
  }
  return { ...row, analytics_price_usd: stored, price_normalization: null, analytics_currency_status: stored ? 'CURRENCY_UNVERIFIED' : 'MISSING_PRICE' };
}

module.exports = { explicitAmount, hasCurrencyToken, normalizeMarketRow, referenceBlock, referenceLine };
