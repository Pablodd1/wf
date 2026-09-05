'use strict';

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function marketPlausibilityFloor(values) {
  const sorted = values.map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const median = sorted.length ? percentile(sorted, 0.5) : 0;
  // Exact reference + dial offers below one quarter of the cohort
  // median are not comparable luxury-watch prices. Preserve them as excluded
  // evidence so currency/parser errors remain auditable.
  return Math.max(1000, Math.round(median * 0.25));
}

function summarizePrices(values) {
  const raw = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  const sortedRaw = [...raw].sort((a, b) => a - b);
  const sample_quality = raw.length < 2 ? 'observational' : raw.length < 10 ? 'provisional' : 'robust';

  if (raw.length < 2) {
    return {
      sample_quality,
      analytics_ready: false,
      raw_count: raw.length,
      included_count: raw.length,
      outlier_count: 0,
      included: raw,
      outliers: [],
      stats: null,
    };
  }

  const q1 = percentile(sortedRaw, 0.25);
  const q3 = percentile(sortedRaw, 0.75);
  const iqr = q3 - q1;
  const lower_fence = raw.length >= 2 ? q1 - 3.0 * iqr : null;
  const upper_fence = raw.length >= 2 ? q3 + 3.0 * iqr : null;
  const included = lower_fence == null
    ? raw
    : raw.filter(value => value >= lower_fence && value <= upper_fence);
  const outliers = lower_fence == null
    ? []
    : raw.filter(value => value < lower_fence || value > upper_fence);
  const sorted = [...included].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  return {
    sample_quality,
    analytics_ready: raw.length >= 2,
    raw_count: raw.length,
    included_count: included.length,
    outlier_count: outliers.length,
    included,
    outliers,
    stats: {
      avg: Math.round(avg),
      median: Math.round(percentile(sorted, 0.5)),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      range: sorted[sorted.length - 1] - sorted[0],
      q1: Math.round(q1),
      q3: Math.round(q3),
      iqr: Math.round(iqr),
      lower_fence: lower_fence == null ? null : Math.round(lower_fence),
      upper_fence: upper_fence == null ? null : Math.round(upper_fence),
      iqr_multiplier: 3.0,
    },
  };
}

function classifyPrice(value, stats, options = {}) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return { included: false, reason: 'INVALID_PRICE' };
  const minimumPrice = Number(options.minimumPrice || 0);
  if (minimumPrice > 0 && price < minimumPrice) {
    return { included: false, reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' };
  }
  if (!stats || stats.lower_fence == null || stats.upper_fence == null) {
    return { included: true, reason: null };
  }
  if (price < stats.lower_fence) return { included: false, reason: 'BELOW_IQR_FENCE' };
  if (price > stats.upper_fence) return { included: false, reason: 'ABOVE_IQR_FENCE' };
  return { included: true, reason: null };
}

function normalizeDimension(value, fallback = 'Unspecified') {
  const clean = String(value || '').trim();
  return clean || fallback;
}

function normalizeConditionDimension(value) {
  const condition = normalizeDimension(value);
  return ['unknown', 'unspecified'].includes(condition.toLowerCase()) ? 'Unspecified' : condition;
}

function buildComparableCohorts(rows) {
  const groups = new Map();
  for (const row of rows) {
    const dial_color = normalizeDimension(row.dial_color);
    const key = dial_color.toLowerCase();
    if (!groups.has(key)) groups.set(key, {
      key,
      condition: 'All conditions',
      dial_color,
      rows: [],
      condition_counts: {},
    });
    const group = groups.get(key);
    const condition = normalizeConditionDimension(row.condition);
    group.rows.push(row);
    group.condition_counts[condition] = (group.condition_counts[condition] || 0) + 1;
  }
  return [...groups.values()]
    .map(group => ({ ...group, count: group.rows.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function buildDialGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const dial_color = normalizeDimension(row.dial_color);
    const key = dial_color.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, dial_color, rows: [], condition_counts: {} });
    const group = groups.get(key);
    const condition = normalizeConditionDimension(row.condition);
    group.rows.push(row);
    group.condition_counts[condition] = (group.condition_counts[condition] || 0) + 1;
  }
  return [...groups.values()]
    .map(group => ({ ...group, count: group.rows.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

module.exports = {
  buildComparableCohorts,
  buildDialGroups,
  classifyPrice,
  marketPlausibilityFloor,
  percentile,
  summarizePrices,
};

