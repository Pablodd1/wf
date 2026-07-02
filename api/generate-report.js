const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { brand, reference } = req.body;

  try {
    const client = getClient();
    let query = client
      .from('watch_records')
      .select('*')
      .eq('verdict', 'APPROVED');

    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.eq('reference', reference);

    const { data, error } = await query;
    if (error) throw error;

    const prices = data.map(r => r.price_usd).filter(p => p != null);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Brand breakdown
    const brandCounts = {};
    data.forEach(r => {
      brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1;
    });

    res.status(200).json({
      generated_at: new Date().toISOString(),
      filters: { brand, reference },
      summary: {
        total_records: data.length,
        avg_price: Math.round(avg),
        median_price: median,
        min_price: min,
        max_price: max
      },
      brand_breakdown: brandCounts,
      sample_records: data.slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
