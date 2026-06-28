/**
 * POST /api/update-record
 * Body: { id: 'uuid', brand: 'Rolex', reference: '126610', ... }
 * Single record CRUD update — SUPABASE
 */
const { updateListing } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const record = await updateListing(id, updates);

    res.status(200).json({ success: true, record });
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
