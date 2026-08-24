'use strict';

const { Readable } = require('node:stream');
const csv = require('csv-parser');
const {
  RECOGNIZED_WITHHELD_CURRENCIES,
  SUPPORTED_CURRENCIES,
} = require('../../api/_lib/fx-rates.cjs');
const { SOURCE, SOURCE_URL } = require('../mariadb-live/fetch-fx-snapshot.cjs');

const CONTRACT = 'wf-phase7b-ecb-historical-previous-published-day-v1';
const DIRECTION = 'USD_PER_SOURCE_UNIT';
const MAX_LOOKBACK_DAYS = 7;

function applicableSourceDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match.slice(1).join('-');
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function parseHistoricalEcbCsv(csvText) {
  const byDate = new Map();
  await new Promise((resolve, reject) => {
    Readable.from([csvText])
      .pipe(csv())
      .on('data', row => {
        const currency = String(row.CURRENCY || '').toUpperCase();
        const date = applicableSourceDate(row.TIME_PERIOD);
        const quotePerEur = Number(row.OBS_VALUE);
        if (!date || !SUPPORTED_CURRENCIES.includes(currency)
          || currency === 'EUR' || !Number.isFinite(quotePerEur) || quotePerEur <= 0) return;
        if (!byDate.has(date)) byDate.set(date, new Map());
        byDate.get(date).set(currency, quotePerEur);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  return byDate;
}

function yearUrl(year) {
  const currencies = SUPPORTED_CURRENCIES.filter(code => code !== 'EUR').join('+');
  return `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies}.EUR.SP00.A?startPeriod=${year}-01-01&endPeriod=${year}-12-31&format=csvdata`;
}

class HistoricalEcbResolver {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Number(options.timeoutMs || 20_000);
    this.years = new Map();
  }

  async loadYear(year) {
    if (!this.years.has(year)) {
      this.years.set(year, (async () => {
        const response = await this.fetchImpl(yearUrl(year), { signal: AbortSignal.timeout(this.timeoutMs) });
        if (!response.ok) throw new Error(`ECB historical rates returned ${response.status} for ${year}`);
        return parseHistoricalEcbCsv(await response.text());
      })());
    }
    return this.years.get(year);
  }

  async resolve(currencyValue, applicableDateValue) {
    const currency = String(currencyValue || '').trim().toUpperCase();
    const applicableDate = applicableSourceDate(applicableDateValue);
    if (!applicableDate || RECOGNIZED_WITHHELD_CURRENCIES.includes(currency)
      || !SUPPORTED_CURRENCIES.includes(currency) || ['USD', 'USDT'].includes(currency)) return null;
    const requiredYears = new Set([Number(applicableDate.slice(0, 4)), Number(shiftDate(applicableDate, -MAX_LOOKBACK_DAYS).slice(0, 4))]);
    const data = new Map();
    for (const year of requiredYears) {
      for (const [date, quotes] of await this.loadYear(year)) data.set(date, quotes);
    }
    for (let lookbackDays = 0; lookbackDays <= MAX_LOOKBACK_DAYS; lookbackDays += 1) {
      const effectiveDate = shiftDate(applicableDate, -lookbackDays);
      const quotes = data.get(effectiveDate);
      const usdPerEur = Number(quotes?.get('USD'));
      const sourcePerEur = currency === 'EUR' ? 1 : Number(quotes?.get(currency));
      if (!Number.isFinite(usdPerEur) || usdPerEur <= 0
        || !Number.isFinite(sourcePerEur) || sourcePerEur <= 0) continue;
      const rate = usdPerEur / sourcePerEur;
      if (!Number.isFinite(rate) || rate <= 0) return null;
      return {
        contract: CONTRACT,
        provider: SOURCE,
        source_url: SOURCE_URL,
        applicable_date: applicableDate,
        effective_date: effectiveDate,
        lookback_days: lookbackDays,
        rate_direction: DIRECTION,
        usd_per_source_unit: rate,
      };
    }
    return null;
  }
}

module.exports = { CONTRACT, DIRECTION, HistoricalEcbResolver, MAX_LOOKBACK_DAYS,
  applicableSourceDate, parseHistoricalEcbCsv, shiftDate, yearUrl };
