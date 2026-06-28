/**
 * GET /api/monthly-prices?reference=52508&months=6
 * Returns monthly min/avg/max price data for chart
 */
const { getMonthlyPrices } = require('./_lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { reference, months = 6 } = req.query;
    if (!reference) return res.status(400).json({ error: 'reference required' });
    
    const rows = await getMonthlyPrices(reference, parseInt(months));
    res.status(200).json({ rows });
  } catch (err) {
    console.error('Monthly prices error:', err.message);
    res.status(200).json({ rows: [], error: err.message, demo: true });
  }
};
