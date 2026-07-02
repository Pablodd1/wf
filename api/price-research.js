const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand, reference } = req.query;
  if (!brand || !reference) {
    return res.status(400).json({ error: 'brand and reference required' });
  }

  try {
    const client = getClient();

    // 1. Pull all APPROVED records for this brand+reference
    const { data: rows, error } = await client
      .from('watch_records')
      .select('price_usd, created_at, condition, source')
      .eq('brand', brand)
      .eq('reference', reference)
      .eq('verdict', 'APPROVED')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        brand,
        reference,
        count: 0,
        prices: [],
        monthly: [],
        stats: null,
        message: 'No APPROVED records found'
      });
    }

    // 2. Compute basic stats
    const prices = rows.map(r => r.price_usd).filter(p => p != null);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // 3. Monthly aggregation using created_at
    const monthlyMap = {};
    rows.forEach(r => {
      if (!r.created_at || !r.price_usd) return;
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, sum: 0, prices: [] };
      monthlyMap[key].count++;
      monthlyMap[key].sum += r.price_usd;
      monthlyMap[key].prices.push(r.price_usd);
    });

    const monthly = Object.values(monthlyMap)
      .map(m => ({
        month: m.month,
        count: m.count,
        avg_price: Math.round(m.sum / m.count),
        min_price: Math.min(...m.prices),
        max_price: Math.max(...m.prices)
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    res.status(200).json({
      brand,
      reference,
      count: rows.length,
      prices,
      monthly,
      stats: {
        avg: Math.round(avg),
        median,
        min,
        max,
        range: max - min
      }
    });
  } catch (err) {
    console.error('Price research error:', err);
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};
