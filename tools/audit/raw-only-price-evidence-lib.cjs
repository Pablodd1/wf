'use strict';

const DIRECT_USD_CURRENCIES = new Set(['USD', 'USDT']);
const ECB_CURRENCIES = new Set([
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'DKK', 'EUR', 'GBP', 'HKD', 'IDR', 'INR',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'SEK', 'SGD', 'THB', 'ZAR',
]);

function applicableDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function validFx(fx, currency, date) {
  const rate = Number(fx?.usd_per_source_unit);
  const lookback = Number(fx?.lookback_days);
  return ECB_CURRENCIES.has(currency) && fx?.provider === 'ECB'
    && fx.rate_direction === 'USD_PER_SOURCE_UNIT' && fx.applicable_date === date
    && /^https:\/\/data-api\.ecb\.europa\.eu\//.test(String(fx.source_url || ''))
    && Number.isFinite(rate) && rate > 0 && Number.isInteger(lookback) && lookback >= 0 && lookback <= 7;
}

function verifiedUsdPrice(row, fx = null) {
  const amount = Number(row?.source_price_amount);
  const currency = String(row?.source_currency || '').toUpperCase();
  const date = applicableDate(row?.timestamp ?? row?.source_timestamp);
  if (row?.price_status !== 'AUTO_APPROVED' || !(amount > 0) || !currency || !date) return null;
  if (DIRECT_USD_CURRENCIES.has(currency)) {
    return { normalized_usd_amount: amount,
      price_evidence_classification: currency === 'USDT' ? 'SOURCE_EXPLICIT_USD_USDT' : 'SOURCE_EXPLICIT_USD_MATCH',
      fx: null };
  }
  if (!validFx(fx, currency, date)) return null;
  return { normalized_usd_amount: Math.round(amount * Number(fx.usd_per_source_unit) * 100) / 100,
    price_evidence_classification: 'DATED_VERIFIED_FX', fx };
}

module.exports = { DIRECT_USD_CURRENCIES, ECB_CURRENCIES, applicableDate, validFx, verifiedUsdPrice };
