/**
 * Admin API — Dashboard stats and activity logs
 * Used by AdminPage.tsx
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

  const { method } = req;
  const { type } = req.query;

  try {
    // GET /api/admin?type=verdict-count&verdict=APPROVED
    if (method === 'GET' && type === 'verdict-count') {
      const { verdict } = req.query;
      
      if (!verdict) {
        return res.status(400).json({ error: 'verdict parameter required' });
      }

      // Calculate 1 year ago
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const { count, error } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .eq('verdict', verdict)
        .gte('created_at', oneYearAgo.toISOString());

      if (error) throw error;

      return res.status(200).json({ count: count || 0 });
    }

    // GET /api/admin?type=total-count
    if (method === 'GET' && type === 'total-count') {
      // Calculate 1 year ago
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const { count, error } = await supabase
        .from('watch_records')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneYearAgo.toISOString());

      if (error) throw error;

      return res.status(200).json({ count: count || 0 });
    }

    // GET /api/admin?type=activity-log
    if (method === 'GET' && type === 'activity-log') {
      const { data, error } = await supabase
        .from('watch_records')
        .select('id,brand,reference,verdict,human_edited,created_at,price_usd')
        .eq('human_edited', true)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const activity = (data || []).map((r, i) => ({
        id: r.id || String(i),
        action: r.verdict === 'APPROVED' ? 'Approved' : r.verdict === 'RECYCLE' ? 'Recycled' : 'Reviewed',
        target: `${r.brand || 'Unknown'} ${r.reference || ''}`.trim(),
        status: 'success',
        timestamp: r.created_at || new Date().toISOString(),
        details: r.price_usd ? `$${r.price_usd.toLocaleString()}` : undefined,
      }));

      return res.status(200).json(activity);
    }

    return res.status(400).json({ error: 'Invalid type parameter' });

  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
