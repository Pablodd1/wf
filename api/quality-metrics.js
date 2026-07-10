/**
 * Quality Metrics API — Outliers & field presence
 * Used by QualityPage.tsx
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
    // Fetch outliers (extreme prices & invalid years)
    const { data: outliers, error: outliersError } = await supabase
      .from('watch_records')
      .select('id,brand,reference,price_usd,year,raw_message,verdict')
      .or('price_usd.gt.5000000,price_usd.lt.100,and(year.lt.1900,year.not.is.null),and(year.gt.2030,year.not.is.null)')
      .order('id', { ascending: false })
      .limit(50);

    if (outliersError) throw outliersError;

    // Fetch field presence counts
    const { data: presence, error: presenceError } = await supabase
      .rpc('get_field_presence');

    let presenceData = {};
    if (!presenceError && presence) {
      presenceData = presence;
    }

    res.status(200).json({
      outliers: outliers || [],
      fieldPresence: presenceData
    });

  } catch (error) {
    console.error('Quality metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = handler;
