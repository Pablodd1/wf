'use strict';

const { parseEcbRates, SUPPORTED_CURRENCIES } = require('./_lib/fx-rates.cjs');

let cached = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!cached || Date.now() - cached.fetchedAt > CACHE_MS) {
      const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const currencies = SUPPORTED_CURRENCIES.filter(code => code !== 'EUR').join('+');
      const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies}.EUR.SP00.A?startPeriod=${start}&format=csvdata`;
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`ECB returned ${response.status}`);
      const parsed = await parseEcbRates(await response.text());
      cached = { ...parsed, fetchedAt: Date.now() };
    }
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({
      status: 'ok',
      base: 'USD',
      source: 'European Central Bank reference rates',
      sourceUrl: 'https://data.ecb.europa.eu/data/datasets/EXR',
      observedAt: cached.observedAt,
      rates: cached.rates,
    });
  } catch (error) {
    return res.status(502).json({ status: 'unavailable', error: error.message });
  }
};
