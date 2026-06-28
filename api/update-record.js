const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, ...updates } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // Filter out null/undefined updates
    const payload = {};
    const allowedFields = [
      'verdict', 'brand', 'reference', 'dial_color', 'price_raw', 
      'price_usd', 'currency', 'condition', 'year', 'box', 'papers', 'confidence'
    ];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        payload[key] = updates[key];
      }
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase error: ${errText}`);
    }

    const updatedRows = await response.json();
    return res.status(200).json({ success: true, data: updatedRows });

  } catch (err) {
    console.error('[api/update-record] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
