/**
 * Materialized Views API Proxy
 * Serves pre-computed analytics data from PostgreSQL materialized views
 * Used by: AnalyticsPage, AdminReportsPage, HealthPage, QualityPage
 */
const { setCorsHeaders } = require('./_lib/cors');
const { getClient } = require('./_lib/supabase');

const VALID_VIEWS = [
  'mv_stats_summary',
  'mv_brand_distribution',
  'mv_verdict_distribution',
  'mv_price_distribution',
  'mv_top_references',
  'mv_monthly_trends',
  'mv_quality_metrics'
];

module.exports = async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const view = req.query.view;
    
    if (!view || !VALID_VIEWS.includes(view)) {
      return res.status(400).json({ 
        error: 'Invalid view',
        validViews: VALID_VIEWS
      });
    }

    const supabase = getClient();
    const limit = parseInt(req.query.limit || '100');
    
    const { data, error } = await supabase
      .from(view)
      .select('*')
      .limit(limit);
    
    if (error) throw error;
    
    res.json(data || []);
    
  } catch (error) {
    console.error('Materialized views error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
