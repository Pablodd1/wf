/**
 * Export API — Batch export watch records with filters
 * Used by ExportPage.tsx
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

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      columns = 'id,brand,reference,dial_color,condition,price_usd,currency,year,raw_message,verdict,confidence,created_at',
      limit = '1000',
      offset = '0',
      brand,
      reference,
      verdict,
      minConfidence
    } = req.query;

    const selectedColumns = Array.isArray(columns) ? columns.join(',') : columns;
    const limitNum = parseInt(Array.isArray(limit) ? limit[0] : limit);
    const offsetNum = parseInt(Array.isArray(offset) ? offset[0] : offset);

    let query = supabase
      .from('watch_records')
      .select(selectedColumns)
      .range(offsetNum, offsetNum + limitNum - 1)
      .order('created_at', { ascending: false });

    // Apply filters
    if (brand) query = query.eq('brand', brand);
    if (reference) query = query.ilike('reference', `%${reference}%`);
    if (verdict) query = query.eq('verdict', verdict);
    if (minConfidence) query = query.gte('confidence', parseInt(String(minConfidence)));

    const { data, error } = await query;

    if (error) throw error;

    res.status(200).json(data || []);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = handler;
