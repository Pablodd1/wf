'use strict';

const { percentile } = require('./market-stats.cjs');

function monthIndex(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

function monthLabel(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? percentile(sorted, 0.5) : null;
}

function buildMonthlyMedians(rows) {
  const months = new Map();
  for (const row of rows) {
    const date = new Date(row.listing_date || '');
    const price = Number(row.price_usd);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(price) || price <= 0) continue;
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(price);
  }
  return [...months.entries()].map(([month, prices]) => ({
    month, month_index: monthIndex(month), count: prices.length, median_price: Math.round(median(prices)),
  })).sort((a, b) => a.month.localeCompare(b.month));
}

function linearFit(points) {
  if (points.length < 2) return null;
  const xMean = points.reduce((sum, point) => sum + point.month_index, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.median_price, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + ((point.month_index - xMean) ** 2), 0);
  if (!denominator) return null;
  const slope = points.reduce((sum, point) => sum + ((point.month_index - xMean) * (point.median_price - yMean)), 0) / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

function predict(fit, index) {
  return Math.max(0, fit.intercept + fit.slope * index);
}

function buildMarketForecast(rows, options = {}) {
  const minimumMonths = options.minimumMonths || 12;
  const minimumOffers = options.minimumOffers || 30;
  const minimumDealers = options.minimumDealers || 5;
  const minimumBacktestPoints = options.minimumBacktestPoints || 4;
  const now = options.now ? new Date(options.now) : new Date();
  const monthly = buildMonthlyMedians(rows);
  const dealerCount = new Set(rows.map(row => row.dealer_id || row.seller_phone).filter(Boolean)).size;
  const reasons = [];
  if (rows.length < minimumOffers) reasons.push('MINIMUM_OFFERS_NOT_MET');
  if (monthly.length < minimumMonths) reasons.push('MINIMUM_MONTHS_NOT_MET');
  if (dealerCount < minimumDealers) reasons.push('MINIMUM_VERIFIED_DEALERS_NOT_MET');
  const latestIndex = monthly.at(-1)?.month_index;
  const currentIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (latestIndex == null || currentIndex - latestIndex > 3) reasons.push('RECENT_DATA_NOT_MET');
  if (reasons.length) return { ready: false, reasons, monthly, offer_count: rows.length, verified_dealer_count: dealerCount };

  const modelErrors = [];
  const naiveErrors = [];
  for (let index = 6; index < monthly.length; index += 1) {
    const training = monthly.slice(0, index);
    const fit = linearFit(training);
    if (!fit) continue;
    const actual = monthly[index].median_price;
    modelErrors.push(Math.abs(actual - predict(fit, monthly[index].month_index)));
    naiveErrors.push(Math.abs(actual - training.at(-1).median_price));
  }
  if (modelErrors.length < minimumBacktestPoints) {
    return { ready: false, reasons: ['BACKTEST_HISTORY_NOT_MET'], monthly, offer_count: rows.length, verified_dealer_count: dealerCount };
  }
  const modelMae = modelErrors.reduce((sum, value) => sum + value, 0) / modelErrors.length;
  const naiveMae = naiveErrors.reduce((sum, value) => sum + value, 0) / naiveErrors.length;
  if (!(modelMae < naiveMae * 0.95)) {
    return {
      ready: false, reasons: ['MODEL_DID_NOT_BEAT_NAIVE_BASELINE'], monthly,
      offer_count: rows.length, verified_dealer_count: dealerCount,
      backtest: { points: modelErrors.length, model_mae: Math.round(modelMae), naive_mae: Math.round(naiveMae) },
    };
  }

  const fit = linearFit(monthly);
  const uncertainty = Math.max(1, Math.round(percentile([...modelErrors].sort((a, b) => a - b), 0.8)));
  const points = [1, 2, 3].map(offset => {
    const index = latestIndex + offset;
    const expected = Math.round(predict(fit, index));
    return { month: monthLabel(index), expected_price: expected, lower: Math.max(0, expected - uncertainty), upper: expected + uncertainty };
  });
  return {
    ready: true, reasons: [], monthly, points, offer_count: rows.length, verified_dealer_count: dealerCount,
    method: 'MONTHLY_MEDIAN_LINEAR_TREND', horizon_months: 3,
    backtest: { points: modelErrors.length, model_mae: Math.round(modelMae), naive_mae: Math.round(naiveMae) },
    uncertainty_method: '80TH_PERCENTILE_ROLLING_ABSOLUTE_ERROR',
  };
}

function buildIndicativeForecast(rows, options = {}) {
  const minimumOffers = options.minimumOffers || 10;
  const monthly = buildMonthlyMedians(rows);
  const prices = rows.map(row => Number(row.price_usd)).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const dealerCount = new Set(rows.map(row => row.dealer_id || row.seller_phone).filter(Boolean)).size;
  if (prices.length < minimumOffers || !monthly.length) {
    return {
      ready: false,
      provisional: true,
      reasons: [prices.length < minimumOffers ? 'MINIMUM_OFFERS_NOT_MET' : 'MINIMUM_MONTHS_NOT_MET'],
      monthly,
      offer_count: prices.length,
      verified_dealer_count: dealerCount,
    };
  }
  const latestIndex = monthly.at(-1).month_index;
  const baseline = Math.round(median(prices));
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const uncertainty = Math.max(1, Math.round((q3 - q1) / 2));
  return {
    ready: true,
    provisional: true,
    reasons: ['INSUFFICIENT_HISTORY_FOR_TREND_MODEL'],
    monthly,
    points: [1, 2, 3].map(offset => ({
      month: monthLabel(latestIndex + offset),
      expected_price: baseline,
      lower: Math.max(0, baseline - uncertainty),
      upper: baseline + uncertainty,
    })),
    offer_count: prices.length,
    verified_dealer_count: dealerCount,
    method: 'CURRENT_COHORT_MEDIAN_BASELINE',
    horizon_months: 3,
    uncertainty_method: 'HALF_INTERQUARTILE_RANGE',
  };
}

module.exports = { buildIndicativeForecast, buildMarketForecast, buildMonthlyMedians, linearFit, monthIndex };
