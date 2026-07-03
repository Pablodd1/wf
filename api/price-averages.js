/**
 * GET /api/price-averages
 * 
 * Returns average market price per reference for all APPROVED records
 * with 5+ samples. Used by Trading Floor cards to compute deal ratings.
 * 
 * Response: { averages: { "Rolex|126710BLRO": { avg: 18500, count: 42 }, ... } }
 * 
 * Lightweight: one-shot query, grouped aggregation, no cursor needed.
 */
const { getClient } = require('./_lib/supabase');

let cache = null;
let cacheAt = 0;
const CACHE_MS = 300_000; // 5 min

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (cache && Date.now() - cacheAt < CACHE_MS) {
    return res.status(200).json(cache);
  }

  try {
    const client = getClient();

    // Fetch brand, reference, and price for all APPROVED records.
    // Supabase JS client doesn't support raw GROUP BY, so we aggregate client-side.
    // Paginate with cursor to avoid timeout on 1.6M APPROVED rows.
    const batchSize = 5000;
    let lastId = null;
    const refPrices = {}; // "brand|ref" -> number[]
    let total = 0;

    while (true) {
      let query = client
        .from('watch_records')
        .select('id,brand,reference,price_usd')
        .eq('verdict', 'APPROVED')
        .order('id', { ascending: true })
        .limit(batchSize);

      if (lastId) query = query.gt('id', lastId);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || !data.length) break;

      for (const r of data) {
        if (!r.brand || !r.reference || r.price_usd == null) continue;
        const key = `${r.brand}|${r.reference}`;
        if (!refPrices[key]) refPrices[key] = [];
        refPrices[key].push(r.price_usd);
      }

      total += data.length;
      lastId = data[data.length - 1].id;

      // Safety: break early after 1M records (covers vast majority, stays under Vercel 60s)
      if (total > 1_000_000) break;
    }

    // Compute averages — only for refs with 5+ samples
    const averages = {};
    for (const [key, prices] of Object.entries(refPrices)) {
      if (prices.length < 5) continue;
      const sorted = [...prices].sort((a, b) => a - b);
      const sum = prices.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / prices.length);
      // Use IQR-median for robustness — strip bottom/top 10%
      const trimStart = Math.floor(prices.length * 0.1);
      const trimEnd = Math.ceil(prices.length * 0.9);
      const trimmed = sorted.slice(trimStart, trimEnd);
      const trimAvg = trimmed.length > 0
        ? Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length)
        : avg;
      averages[key] = {
        avg: trimAvg,
        rawAvg: avg,
        count: prices.length,
        min: sorted[trimStart] || sorted[0],
        max: sorted[trimEnd - 1] || sorted[sorted.length - 1],
      };
    }

    const payload = {
      live: true,
      updatedAt: new Date().toISOString(),
      scanned: total,
      references: Object.keys(averages).length,
      averages,
    };

    cache = payload;
    cacheAt = Date.now();
    return res.status(200).json(payload);
  } catch (err) {
    console.error('Price averages error:', err);
    // Stale cache better than nothing
    if (cache) return res.status(200).json({ ...cache, live: false, stale: true });
    return res.status(500).json({ error: 'Failed to compute averages' });
  }
};
