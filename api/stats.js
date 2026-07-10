/**
 * GET /api/stats
 * Returns dashboard statistics from SUPABASE
 */
const { getStats, getBrandDistribution } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  
  try {
    const stats = await getStats();
    const brands = await getBrandDistribution();
    
    res.status(200).json({
      ...stats,
      brandDistribution: brands,
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    // Return demo data so UI doesn't break
    res.status(200).json({
      totalRecords: 2390143,
      approvedCount: 805872,
      humanCount: 929647,
      recycleCount: 654624,
      reviewCount: 0,
      avgPrice: 45230,
      minPrice: 1200,
      maxPrice: 3150000,
      avgConfidence: 72,
      brandDistribution: [
        { brand: 'Rolex', count: 847293, avgPrice: 23450 },
        { brand: 'Patek Philippe', count: 612847, avgPrice: 78450 },
        { brand: 'Audemars Piguet', count: 384921, avgPrice: 45600 },
        { brand: 'Richard Mille', count: 298471, avgPrice: 198000 },
        { brand: 'Omega', count: 245611, avgPrice: 8200 },
      ],
      error: err.message,
      demo: true,
    });
  }
};
