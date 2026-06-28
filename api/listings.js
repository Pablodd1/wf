/**
 * GET /api/listings?page=1&limit=50&brand=Rolex&reference=1266&verdict=HUMAN&search=...
 * Returns paginated watch listings from MySQL
 */
const { getListings } = require('./_lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
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
    res.status(500).json({ error: err.message, demo: true, rows: [], total: 0 });
  }
};
