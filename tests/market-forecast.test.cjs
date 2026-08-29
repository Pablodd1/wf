'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIndicativeForecast, buildMarketForecast, buildMonthlyMedians } = require('../api/_lib/market-forecast.cjs');

function rows({ months = 15, perMonth = 5, dealers = 5, noisy = false } = {}) {
  const result = [];
  for (let month = 0; month < months; month += 1) {
    const date = new Date(Date.UTC(2025, 4 + month, 15));
    for (let offer = 0; offer < perMonth; offer += 1) {
      result.push({
        listing_date: date.toISOString(), dealer_id: `dealer-${offer % dealers}`,
        price_usd: 20000 + month * 500 + (noisy ? ((month % 2) * 1400) : offer * 10),
      });
    }
  }
  return result;
}

test('builds monthly medians without allowing high offers to dominate', () => {
  const monthly = buildMonthlyMedians([
    { listing_date: '2026-01-02', price_usd: 100 },
    { listing_date: '2026-01-03', price_usd: 101 },
    { listing_date: '2026-01-04', price_usd: 10000 },
  ]);
  assert.equal(monthly[0].median_price, 101);
});

test('publishes three months only after sample, identity and backtest gates pass', () => {
  const forecast = buildMarketForecast(rows(), { now: '2026-07-20T00:00:00Z' });
  assert.equal(forecast.ready, true);
  assert.equal(forecast.points.length, 3);
  assert.ok(forecast.backtest.model_mae < forecast.backtest.naive_mae);
});

test('withholds forecasts with insufficient verified dealer diversity', () => {
  const forecast = buildMarketForecast(rows({ dealers: 1 }), { now: '2026-07-20T00:00:00Z' });
  assert.equal(forecast.ready, false);
  assert.ok(forecast.reasons.includes('MINIMUM_VERIFIED_DEALERS_NOT_MET'));
});

test('withholds a trend model that does not beat the naive baseline', () => {
  const flat = rows().map(row => ({ ...row, price_usd: 20000 }));
  const forecast = buildMarketForecast(flat, { now: '2026-07-20T00:00:00Z' });
  assert.equal(forecast.ready, false);
  assert.ok(forecast.reasons.includes('MODEL_DID_NOT_BEAT_NAIVE_BASELINE'));
});

test('builds three clearly provisional flat median points when dated trend history is insufficient', () => {
  const sparse = rows().slice(0, 18).map(row => ({ ...row, listing_date: '2026-07-10T00:00:00Z' }));
  const forecast = buildIndicativeForecast(sparse, { minimumOffers: 10 });
  assert.equal(forecast.ready, true);
  assert.equal(forecast.provisional, true);
  assert.equal(forecast.method, 'CURRENT_COHORT_MEDIAN_BASELINE');
  assert.equal(forecast.points.length, 3);
  assert.equal(new Set(forecast.points.map(point => point.expected_price)).size, 1);
  assert.ok(forecast.reasons.includes('INSUFFICIENT_HISTORY_FOR_TREND_MODEL'));
});
