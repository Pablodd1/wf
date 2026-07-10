/**
 * /api/demand-signals.js
 * Proxy endpoint for demand signals analytics
 * Fixes security issue #5: direct Supabase calls from frontend
 * 
 * GET: Fetch demand signals data (brand/reference counts, price trends)
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

const handler = async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getClient();
    const { brand, reference, days = 30 } = req.query;
    
    // Calculate date range
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - parseInt(days));
    const dateFromISO = dateFrom.toISOString();
    
    let query = supabase
      .from('watch_records')
      .select('brand, reference, price_usd, created_at, verdict')
      .gte('created_at', dateFromISO)
      .eq('verdict', 'APPROVED')
      .order('created_at', { ascending: false });
    
    // Apply filters
    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.ilike('reference', `%${reference}%`);
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    // Aggregate by brand+reference
    const signals = {};
    data.forEach(record => {
      const key = `${record.brand}|${record.reference}`;
      if (!signals[key]) {
        signals[key] = {
          brand: record.brand,
          reference: record.reference,
          count: 0,
          prices: [],
          latestDate: record.created_at
        };
      }
      signals[key].count++;
      if (record.price_usd) {
        signals[key].prices.push(record.price_usd);
      }
    });
    
    // Calculate stats for each signal
    const result = Object.values(signals).map(signal => {
      const prices = signal.prices.sort((a, b) => a - b);
      return {
        brand: signal.brand,
        reference: signal.reference,
        count: signal.count,
        avgPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
        minPrice: prices[0] || null,
        maxPrice: prices[prices.length - 1] || null,
        medianPrice: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null,
        latestDate: signal.latestDate
      };
    }).sort((a, b) => b.count - a.count);
    
    return res.status(200).json({ 
      signals: result,
      totalRecords: count,
      dateRange: { from: dateFromISO, to: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Demand signals error:', error);
    return res.status(500).json({ error: 'Failed to fetch demand signals' });
  }
};

module.exports = handler;
