/**
 * Reports API — CRUD operations for unified reports
 * Used by UnifiedReports.tsx
 */

const { createClient } = require('@supabase/supabase-js');
const { setCorsHeaders } = require('./_lib/cors');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function handler(req, res) {
  if (!setCorsHeaders(req, res)) {
    return;
  }

  const { method } = req;

  try {
    // GET: List records with filters
    if (method === 'GET') {
      const { 
        brand, 
        reference, 
        verdict, 
        limit = '100',
        offset = '0'
      } = req.query;

      const limitNum = parseInt(Array.isArray(limit) ? limit[0] : limit);
      const offsetNum = parseInt(Array.isArray(offset) ? offset[0] : offset);

      let query = supabase
        .from('watch_records')
        .select('id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message,human_edited')
        .range(offsetNum, offsetNum + limitNum - 1)
        .order('created_at', { ascending: false });

      if (brand) query = query.eq('brand', brand);
      if (reference) query = query.ilike('reference', `%${reference}%`);
      if (verdict) query = query.eq('verdict', verdict);

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json(data || []);
    }

    // PATCH: Update single record
    if (method === 'PATCH') {
      const { id, updates } = req.body;

      if (!id || !updates) {
        return res.status(400).json({ error: 'ID and updates required' });
      }

      const { data, error } = await supabase
        .from('watch_records')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json(data);
    }

    // POST: Batch update multiple records
    if (method === 'POST') {
      const { ids, updates } = req.body;

      if (!ids || !Array.isArray(ids) || !updates) {
        return res.status(400).json({ error: 'IDs array and updates required' });
      }

      const { data, error } = await supabase
        .from('watch_records')
        .update(updates)
        .in('id', ids)
        .select();

      if (error) throw error;

      return res.status(200).json(data || []);
    }

    // DELETE: Delete single record
    if (method === 'DELETE') {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'ID required' });
      }

      const { error } = await supabase
        .from('watch_records')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Reports error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = handler;
