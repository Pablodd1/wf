'use strict';

const { normalizeMarketRow, referenceBlock } = require('./market-row-normalization.cjs');

const UNKNOWN = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', 'UNDEFINED']);

function clean(value) {
  const text = String(value ?? '').trim();
  return UNKNOWN.has(text.toUpperCase()) ? null : text;
}

function norm(value) {
  return clean(value)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

function hasPriceToken(line, reference) {
  if (!line) return false;
  const escapedReference = String(reference || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutReference = String(line).replace(new RegExp(escapedReference, 'ig'), ' ');
  const tokens = withoutReference.match(/\b\d[\d,.]*(?:\s*(?:K|M|MN|W|MIL|MILLION|万))?\b/gi) || [];
  return tokens.some(token => !/^\d{4}$/.test(token.replace(/[^0-9]/g, '')));
}

function catalogReferenceIsExact(listing, catalog) {
  if (!catalog?.found || catalog.matchType === 'partial' || catalog.matchType === 'ambiguous_reference') return false;
  const sourceReference = norm(listing.reference);
  const matchedReference = norm(catalog.matchedRef || catalog.reference);
  return Boolean(sourceReference && matchedReference && sourceReference === matchedReference);
}

function catalogDialIsCompatible(dial, catalog) {
  const allowed = Array.isArray(catalog?.dialColors) ? catalog.dialColors.map(norm).filter(Boolean) : [];
  if (!allowed.length) return true;
  return allowed.includes(norm(dial));
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function comparableStats(rows) {
  const prices = rows
    .map(row => Number(row.price_usd))
    .filter(price => Number.isFinite(price) && price >= 1000 && price <= 2500000)
    .sort((a, b) => a - b);
  if (prices.length < 5) return null;
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q3 - q1;
  const low = Math.max(1000, q1 - 1.5 * iqr);
  const high = Math.min(2500000, q3 + 1.5 * iqr);
  const included = prices.filter(price => price >= low && price <= high);
  if (included.length < 5) return null;
  return {
    count: included.length,
    min: included[0],
    max: included[included.length - 1],
    avg: included.reduce((sum, price) => sum + price, 0) / included.length,
    low,
    high,
  };
}

function verifyFeaturedRecord(listing, source, catalog, comparableRows) {
  if (!catalogReferenceIsExact(listing, catalog)) return { verified: false, reason: 'REFERENCE_NOT_CATALOG_EXACT' };
  if (!catalogDialIsCompatible(listing.dial_color, catalog)) return { verified: false, reason: 'DIAL_NOT_CATALOG_COMPATIBLE' };

  const sourceLine = referenceBlock(source?.raw_message, listing.reference);
  if (!sourceLine || !hasPriceToken(sourceLine, listing.reference)) {
    return { verified: false, reason: 'RAW_PRICE_EVIDENCE_MISSING' };
  }

  const currency = clean(listing.currency)?.toUpperCase();
  if (!['USD', 'HKD', 'HDK', 'HK$', 'USDT', 'US$', 'U$'].includes(currency)) {
    return { verified: false, reason: 'UNSUPPORTED_CURRENCY' };
  }
  const currencyEvidence = currency === 'USD' || currency === 'USDT' || currency === 'US$' || currency === 'U$'
    ? /(?:USD|USDT|US\$|U\$|\$)/i.test(sourceLine)
    : /(?:HKD|HDK|HK\$)/i.test(sourceLine);
  if (!currencyEvidence) return { verified: false, reason: 'RAW_CURRENCY_EVIDENCE_MISSING' };

  const normalized = normalizeMarketRow({ ...listing, raw_message: source.raw_message }, listing.reference);
  const price = Number(normalized.analytics_price_usd);
  if (!Number.isFinite(price) || price < 1000 || price > 2500000) {
    return { verified: false, reason: 'PRICE_OUTSIDE_PLAUSIBLE_RANGE' };
  }

  const stats = comparableStats(comparableRows);
  if (!stats) return { verified: false, reason: 'INSUFFICIENT_COMPARABLE_DATA' };
  if (price < stats.low || price > stats.high) return { verified: false, reason: 'PRICE_OUTLIER' };

  return {
    verified: true,
    reference: catalog.reference || catalog.matchedRef || listing.reference,
    price_usd: Math.round(price),
    price_source: 'source_line',
    reference_source: 'catalog_exact',
    comparable_count: stats.count,
    comparable_min: Math.round(stats.min),
    comparable_max: Math.round(stats.max),
    comparable_avg: Math.round(stats.avg),
  };
}

module.exports = { catalogReferenceIsExact, comparableStats, hasPriceToken, verifyFeaturedRecord };
