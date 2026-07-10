/**
 * /api/watch-detail-report.js
 * Proxy endpoint for watch detail report generation
 * Fixes security issue #5: direct Supabase calls from frontend
 * 
 * GET: Generate detailed report for a specific watch record
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
    const { recordId } = req.query;
    
    if (!recordId) {
      return res.status(400).json({ error: 'recordId required' });
    }
    
    // Fetch the specific record
    const { data: record, error: recordError } = await supabase
      .from('watch_records')
      .select('*')
      .eq('id', recordId)
      .single();
    
    if (recordError) throw recordError;
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    // Fetch similar records (same brand + reference) for comparison
    const { data: similarRecords, error: similarError } = await supabase
      .from('watch_records')
      .select('id, reference, brand, price_usd, created_at, condition, year')
      .eq('brand', record.brand)
      .ilike('reference', record.reference)
      .eq('verdict', 'APPROVED')
      .neq('id', recordId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (similarError) throw similarError;
    
    // Calculate market comparison stats
    const prices = similarRecords
      .map(r => r.price_usd)
      .filter(p => p !== null)
      .sort((a, b) => a - b);
    
    const marketStats = prices.length > 0 ? {
      count: prices.length,
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      min: prices[0],
      max: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)]
    } : null;
    
    return res.status(200).json({
      record,
      similarRecords,
      marketStats
    });
    
  } catch (error) {
    console.error('Watch detail report error:', error);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
};

module.exports = handler;
