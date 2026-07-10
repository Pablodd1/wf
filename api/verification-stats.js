/**
 * /api/verification-stats.js
 * Proxy endpoint for verification dashboard stats
 * Fixes security issue #5: direct Supabase calls from frontend
 * 
 * Returns: materialized view stats and verdict distribution
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
    
    // Fetch materialized view stats
    const { data: mvStats, error: statsError } = await supabase
      .from('mv_stats_summary')
      .select('*')
      .single();
    
    if (statsError) throw statsError;
    
    // Fetch verdict distribution
    const { data: verdictDist, error: verdictError } = await supabase
      .from('mv_verdict_distribution')
      .select('*');
    
    if (verdictError) throw verdictError;
    
    return res.status(200).json({
      stats: mvStats,
      verdictDistribution: verdictDist
    });
    
  } catch (error) {
    console.error('Verification stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch verification stats' });
  }
};

module.exports = handler;
