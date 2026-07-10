/**
 * /api/bulk-import.js
 * Proxy endpoint for bulk import operations
 * Fixes security issue #5: direct Supabase calls from frontend
 * 
 * POST: Insert multiple watch records
 * GET: Fetch recent bulk import records
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

const handler = async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  
  const supabase = getClient();
  
  // GET: Fetch recent bulk import records
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('watch_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      
      return res.status(200).json({ records: data });
    } catch (error) {
      console.error('Bulk import GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch records' });
    }
  }
  
  // POST: Insert multiple records
  if (req.method === 'POST') {
    try {
      const { records } = req.body;
      
      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Invalid records array' });
      }
      
      // Validate each record has required fields
      for (const record of records) {
        if (!record.raw_message) {
          return res.status(400).json({ error: 'Each record must have raw_message' });
        }
      }
      
      const { data, error } = await supabase
        .from('watch_records')
        .insert(records)
        .select();
      
      if (error) throw error;
      
      return res.status(201).json({ 
        success: true, 
        inserted: data.length,
        records: data 
      });
    } catch (error) {
      console.error('Bulk import POST error:', error);
      return res.status(500).json({ error: 'Failed to insert records' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};

module.exports = handler;
