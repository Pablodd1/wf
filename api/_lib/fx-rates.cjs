'use strict';

const { Readable } = require('node:stream');
const csv = require('csv-parser');

// Currencies recognized by the listing parser for which the ECB publishes a
// daily reference rate. Recognized currencies without an ECB quote remain
// explicitly withheld instead of receiving an invented or pegged rate.
const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'HKD', 'GBP', 'CHF', 'CNY', 'JPY', 'SGD',
  'KRW', 'THB', 'CAD', 'AUD', 'NZD', 'MYR', 'IDR', 'INR',
  'PHP', 'BRL', 'MXN', 'ZAR', 'SEK', 'NOK', 'DKK',
];
const RECOGNIZED_WITHHELD_CURRENCIES = ['AED', 'SAR', 'TWD', 'VND'];

async function parseEcbRates(csvText) {
  const observations = new Map();
  await new Promise((resolve, reject) => {
    Readable.from([csvText])
      .pipe(csv())
      .on('data', row => {
        const currency = String(row.CURRENCY || '').toUpperCase();
        const value = Number(row.OBS_VALUE);
        const date = String(row.TIME_PERIOD || '');
        if (!SUPPORTED_CURRENCIES.includes(currency) || !Number.isFinite(value) || value <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        if (!observations.has(currency)) observations.set(currency, new Map());
        observations.get(currency).set(date, value);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const observedAt = [...(observations.get('USD')?.keys() || [])].sort().at(-1);
  if (!observedAt) throw new Error('ECB response did not include USD');
  const usdPerEur = observations.get('USD').get(observedAt);
  const rates = { USD: 1, EUR: 1 / usdPerEur };
  for (const currency of SUPPORTED_CURRENCIES) {
    if (currency === 'USD' || currency === 'EUR') continue;
    const quote = observations.get(currency)?.get(observedAt);
    if (quote) rates[currency] = quote / usdPerEur;
  }
  return { observedAt, rates };
}

function convertCurrency(amount, from, to, rates) {
  const numeric = Number(amount);
  const fromRate = Number(rates?.[from]);
  const toRate = Number(rates?.[to]);
  if (!Number.isFinite(numeric) || !Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) return null;
  return (numeric / fromRate) * toRate;
}

module.exports = { RECOGNIZED_WITHHELD_CURRENCIES, SUPPORTED_CURRENCIES, convertCurrency, parseEcbRates };
