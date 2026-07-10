/**
 * Insight API — Reference analysis and statistics
 * Used by InsightDetails.tsx
 */

import { createClient } from '@supabase/supabase-js';
import { setCorsHeaders } from './_lib/cors';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

export default async function handler(req, res) {
  if (!setCorsHeaders(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { reference, brand } = req.query;

    if (!reference) {
      return res.status(400).json({ error: 'Reference parameter required' });
    }

    const ref = Array.isArray(reference) ? reference[0] : reference;
    const br = brand ? (Array.isArray(brand) ? brand[0] : brand) : null;

    let query = supabase
      .from('watch_records')
      .select('*')
      .eq('reference', ref)
      .limit(1000)
      .order('created_at', { ascending: false });

    if (br) {
      query = query.eq('brand', br);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.status(200).json(data || []);

  } catch (error) {
    console.error('Insight error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
