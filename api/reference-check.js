/**
 * Reference Check API — Search and validate references
 * Used by ReferenceCheck.tsx
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
    const { reference, limit = '500' } = req.query;

    if (!reference) {
      return res.status(400).json({ error: 'Reference parameter required' });
    }

    const ref = Array.isArray(reference) ? reference[0] : reference;
    const limitNum = parseInt(Array.isArray(limit) ? limit[0] : limit);

    const { data, error } = await supabase
      .from('watch_records')
      .select('*')
      .ilike('reference', `%${ref}%`)
      .limit(limitNum)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json(data || []);

  } catch (error) {
    console.error('Reference check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
