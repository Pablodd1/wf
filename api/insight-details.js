const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand, reference, month } = req.query;
  if (!brand || !reference) {
    return res.status(400).json({ error: 'brand and reference required' });
  }

  try {
    const client = getClient();

    // Base query
    let query = client
      .from('watch_records')
      .select('price_usd, created_at, condition, source, raw_message')
      .eq('brand', brand)
      .eq('reference', reference)
      .eq('verdict', 'APPROVED');

    // Optional month filter using created_at
    if (month) {
      // month format: YYYY-MM
      const [year, mon] = month.split('-');
      if (year && mon) {
        const start = `${year}-${mon}-01T00:00:00Z`;
        const endDate = new Date(parseInt(year), parseInt(mon), 1);
        const end = endDate.toISOString();
        query = query.gte('created_at', start).lt('created_at', end);
      }
    }

    const { data: rows, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        brand,
        reference,
        month: month || 'all',
        count: 0,
        outliers: [],
        duplicates: [],
        stats: null
      });
    }

    const prices = rows.map(r => r.price_usd).filter(p => p != null);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / prices.length);

    // Outlier detection: >2 std dev from mean
    const outliers = rows.filter(r => {
      if (r.price_usd == null) return false;
      return Math.abs(r.price_usd - avg) > 2 * stdDev;
    }).map(r => ({
      id: r.id,
      price_usd: r.price_usd,
      created_at: r.created_at,
      deviation: Math.round(Math.abs(r.price_usd - avg)),
      raw_message: r.raw_message?.substring(0, 200)
    }));

    // Duplicate detection: same price within 1% and same day
    const duplicates = [];
    const seen = new Map();
    rows.forEach(r => {
      if (r.price_usd == null) return;
      const day = r.created_at ? r.created_at.split('T')[0] : 'unknown';
      const key = `${Math.round(r.price_usd / 100)}-${day}`;
      if (seen.has(key)) {
        duplicates.push({
          original: seen.get(key),
          duplicate: { id: r.id, price_usd: r.price_usd, created_at: r.created_at }
        });
      } else {
        seen.set(key, { id: r.id, price_usd: r.price_usd, created_at: r.created_at });
      }
    });

    res.status(200).json({
      brand,
      reference,
      month: month || 'all',
      count: rows.length,
      outliers,
      duplicates: duplicates.slice(0, 20), // limit
      stats: {
        avg: Math.round(avg),
        median: Math.round(prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]),
        min: Math.min(...prices),
        max: Math.max(...prices),
        std_dev: Math.round(stdDev)
      }
    });
  } catch (err) {
    console.error('Insight details error:', err);
    res.status(500).json({ error: 'Failed to fetch insights', detail: err.message });
  }
};
