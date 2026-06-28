/**
 * GET /api/listings?page=1&limit=50&brand=Rolex&reference=1266&verdict=HUMAN&search=...
 * Returns paginated watch listings from SUPABASE
 */
const { getListings } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { page, limit, brand, reference, verdict, search } = req.query;
    const result = await getListings({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      brand,
      reference,
      verdict,
      search,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('Listings error:', err.message);
    res.status(200).json({ rows: [], total: 0, error: err.message, demo: true });
  }
};
