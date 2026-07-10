/**
 * /api/data-browser.js
 * Proxy endpoint for data browser operations
 * Fixes security issue #5: direct Supabase calls from frontend
 * 
 * GET: Fetch watch records with pagination and filtering
 * PUT: Update a single record
 * DELETE: Delete a single record
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');

const handler = async (req, res) => {
  if (setCorsHeaders(req, res)) return;
  
  const supabase = getClient();
  
  // GET: Fetch records with pagination
  if (req.method === 'GET') {
    try {
      const { page = 1, limit = 50, brand, reference, verdict } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      let query = supabase
        .from('watch_records')
        .select('*', { count: 'exact' });
      
      // Apply filters
      if (brand) query = query.eq('brand', brand);
      if (reference) query = query.ilike('reference', `%${reference}%`);
      if (verdict) query = query.eq('verdict', verdict);
      
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);
      
      if (error) throw error;
      
      return res.status(200).json({ 
        records: data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Data browser GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch records' });
    }
  }
  
  // PUT: Update a record
  if (req.method === 'PUT') {
    try {
      const { id, updates } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'Record ID required' });
      }
      
      const { data, error } = await supabase
        .from('watch_records')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      return res.status(200).json({ success: true, record: data });
    } catch (error) {
      console.error('Data browser PUT error:', error);
      return res.status(500).json({ error: 'Failed to update record' });
    }
  }
  
  // DELETE: Delete a record
  if (req.method === 'DELETE') {
    try {
      const { id } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'Record ID required' });
      }
      
      const { error } = await supabase
        .from('watch_records')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Data browser DELETE error:', error);
      return res.status(500).json({ error: 'Failed to delete record' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};

module.exports = handler;
