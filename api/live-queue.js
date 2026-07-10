/**
 * Live Queue API — Recent watch records with high confidence
 * Used by LiveQueue.tsx for real-time dashboard
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('watch_records')
      .select('id, brand, reference, price_usd, confidence, verdict, raw_message, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) throw error;
    
    res.status(200).json(data || []);
  } catch (error) {
    console.error('Live queue error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
