/**
 * GET /api/listings
 * Trading Floor data API — serves all watch categories with proper counts.
 * 
 * Query params:
 *   category  = all | watches | multi | wtb | forsale  (default: all)
 *   brand     = filter by brand
 *   reference = filter by reference  
 *   condition = filter by condition
 *   search    = text search across brand/reference/raw_message
 *   sort      = created_at | price_usd | confidence (default: created_at)
 *   order     = asc | desc (default: desc)
 *   limit     = page size (default: 50, max: 500)
 *   page      = page number (default: 1)
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    brand, reference, condition, search,
    sort = 'created_at', order = 'desc',
    limit = 50, page = 1,
    category = 'all',
  } = req.query;

  try {
    const client = getClient();
    const pageSize = Math.min(parseInt(limit), 500);
    const from = (parseInt(page) - 1) * pageSize;

    // Build query — start with base, add filters
    let query = client.from('watch_records').select('*', { count: 'estimated' });

    // ── Category filters ──
    switch (category) {
      case 'watches':
        // Single watches only — exclude multi-listings, WTB, non-watch
        query = query.not('listing_type', 'in', '(MULTI,NON_WATCH)');
        query = query.not('verdict', 'eq', 'RECYCLE');
        break;
      case 'multi':
        // Multi-watch stock lists
        query = query.eq('listing_type', 'MULTI');
        query = query.not('verdict', 'eq', 'RECYCLE');
        break;
      case 'wtb':
        // Want to buy
        query = query.eq('listing_type', 'WTB');
        break;
      case 'forsale':
        // WTS only (exclude WTB, MULTI, NON_WATCH, RECYCLE)
        query = query.not('listing_type', 'in', '(WTB,MULTI,NON_WATCH)');
        query = query.not('verdict', 'eq', 'RECYCLE');
        break;
      default:
        // 'all' — everything except RECYCLE
        query = query.not('verdict', 'eq', 'RECYCLE');
    }

    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.eq('reference', reference);
    if (condition) query = query.eq('condition', condition);
    if (search) {
      query = query.or(`brand.ilike.%${search}%,reference.ilike.%${search}%,raw_message.ilike.%${search}%`);
    }

    const { data, count, error } = await query
      .order(sort, { ascending: order === 'asc' })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    res.status(200).json({
      rows: data || [],
      total: count || 0,
      page: parseInt(page),
      limit: pageSize,
      category,
    });
  } catch (err) {
    console.error('Listings error:', err);
    res.status(500).json({ error: err.message, demo: true });
  }
};
