/**
 * Search API Proxy
 * Provides secure search functionality for watch records
 * Eliminates direct Supabase REST calls from frontend
 */

const { getClient } = require('./_lib/supabase');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      query = '', 
      brand = '', 
      condition = '', 
      confMin = '0',
      page = '0',
      limit = '50'
    } = req.query;

    const supabase = getClient();
    const offset = parseInt(page) * parseInt(limit);
    const minConf = parseInt(confMin);

    // Build query
    let dbQuery = supabase
      .from('watch_records')
      .select('*')
      .range(offset, offset + parseInt(limit) - 1)
      .order('created_at', { ascending: false });

    // Apply filters
    if (query) {
      dbQuery = dbQuery.or(`reference.ilike.%${query}%,brand.ilike.%${query}%`);
    }
    if (brand && brand !== 'All') {
      dbQuery = dbQuery.eq('brand', brand);
    }
    if (condition && condition !== 'All') {
      dbQuery = dbQuery.eq('condition', condition);
    }
    if (minConf > 0) {
      dbQuery = dbQuery.gte('confidence', minConf);
    }

    const { data, error } = await dbQuery;

    if (error) {
      console.error('Search error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data || []);

  } catch (err) {
    console.error('Search API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
