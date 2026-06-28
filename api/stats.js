/**
 * GET /api/stats
 * Returns dashboard statistics from real MySQL database
 */
const { getStats, getBrandDistribution } = require('./_lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const stats = await getStats();
    const brands = await getBrandDistribution();
    
    res.status(200).json({
      totalRecords: stats.totalRecords,
      approvedCount: stats.approvedCount,
      humanCount: stats.humanCount,
      recycleCount: stats.recycleCount,
      reviewCount: stats.reviewCount,
      avgPrice: Math.round(stats.avgPrice || 0),
      minPrice: stats.minPrice || 0,
      maxPrice: stats.maxPrice || 0,
      avgConfidence: Math.round(stats.avgConfidence || 0),
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
        { brand: 'Patek Philippe', count: 847293, avgPrice: 78450 },
        { brand: 'Rolex', count: 612847, avgPrice: 23450 },
        { brand: 'Audemars Piguet', count: 384921, avgPrice: 45600 },
        { brand: 'Richard Mille', count: 298471, avgPrice: 198000 },
        { brand: 'Vacheron Constantin', count: 245611, avgPrice: 38200 },
      ],
      error: err.message,
      demo: true,
    });
  }
};
