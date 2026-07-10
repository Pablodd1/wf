/**
 * Health Check API — Parser error count
 * Used by HealthPage.tsx
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
    // Lightweight check for parser errors - just check existence
    const { data, error } = await supabase
      .from('watch_records')
      .select('id')
      .not('parser_error', 'is', null)
      .limit(1);

    if (error) throw error;

    res.status(200).json({
      hasErrors: (data || []).length > 0,
      count: (data || []).length
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
