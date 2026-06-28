/**
 * GET /api/insight-details?reference=52508&month=2026-03
 * Full pipeline: original → dedupe → outlier detection → stats — SUPABASE
 */
const { getListingsByMonth } = require('./_lib/supabase');

function detectOutliers(records) {
  const prices = records.map(r => r.price_usd).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length < 4) return { clean: records, outliers: [] };
  
  const q1Idx = Math.floor(prices.length * 0.25);
  const q3Idx = Math.floor(prices.length * 0.75);
  const q1 = prices[q1Idx];
  const q3 = prices[q3Idx];
  const iqr = q3 - q1;
  const lower = Math.max(0, q1 - 1.5 * iqr);
  const upper = q3 + 1.5 * iqr;
  
  const clean = [];
  const outliers = [];
  for (const r of records) {
    const p = r.price_usd || 0;
    if (p >= lower && p <= upper) clean.push(r);
    else outliers.push(r);
  }
  return { clean, outliers };
}

function calcStats(records) {
  const prices = records.map(r => r.price_usd).filter(p => p > 0);
  if (!prices.length) return { count: 0, min: 0, avg: 0, max: 0 };
  const sum = prices.reduce((a, b) => a + b, 0);
  return { count: prices.length, min: Math.min(...prices), avg: Math.round(sum / prices.length), max: Math.max(...prices) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { reference, month } = req.query;
    if (!reference || !month) return res.status(400).json({ error: 'reference and month required' });
    
    const records = await getListingsByMonth(reference, month);
    if (!records.length) return res.status(200).json({ rows: [], message: 'No data' });
    
    const original = calcStats(records);
    const { clean, outliers } = detectOutliers(records);
    const filtered = calcStats(clean);
    
    res.status(200).json({
      original,
      filtered,
      outliers: { count: outliers.length, prices: outliers.map(r => r.price_usd) },
      records: clean,
      meta: { reference, month, total: records.length },
    });
  } catch (err) {
    console.error('Insight error:', err.message);
    res.status(200).json({ rows: [], error: err.message, demo: true });
  }
};
