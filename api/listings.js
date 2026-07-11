/**
 * GET /api/listings
 * Trading Floor data API with pagination, search, and category filters.
 * 
 * Query params:
 *   category = all | forsale | multi | wtb
 *   search   = text search (searches brand + reference only, not raw_message)
 *   condition = condition filter
 *   sort     = created_at | price_usd (default: created_at)
 *   order    = asc | desc (default: desc)
 *   limit    = 12 | 20 | 50 | 100 (default: 20)
 *   page     = page number (default: 1)
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    search, condition,
    sort = 'created_at', order = 'desc',
    limit = 20, page = 1,
    category = 'all',
  } = req.query;

  try {
    const client = getClient();
    const pageSize = Math.min(parseInt(limit), 100);
    const from = (parseInt(page) - 1) * pageSize;

    let query = client.from('watch_records').select('*', { count: 'estimated' });

    // Category
    if (category === 'forsale') {
      query = query.not('listing_type', 'eq', 'WTB');
      query = query.not('verdict', 'eq', 'RECYCLE');
    } else if (category === 'wtb') {
      query = query.eq('listing_type', 'WTB');
    } else if (category === 'multi') {
      query = query.eq('verdict', 'HUMAN');
    } else {
      // all — exclude RECYCLE
      query = query.not('verdict', 'eq', 'RECYCLE');
    }

    if (condition && condition !== 'All') {
      query = query.eq('condition', condition);
    }

    // Search: brand + reference only (indexed, fast). No raw_message ilike.
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`brand.ilike.${term},reference.ilike.${term}`);
    }

    const { data, count, error } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const totalPages = count ? Math.ceil(count / pageSize) : 0;

    res.status(200).json({
      rows: data || [],
      total: count || 0,
      page: parseInt(page),
      pageSize,
      totalPages,
      category,
      hasMore: count ? (parseInt(page) * pageSize) < count : false,
    });
  } catch (err) {
    console.error('Listings error:', err);
    res.status(500).json({ 
      error: err.message, 
      rows: [],
      total: 0,
      page: parseInt(page),
    });
  }
};
