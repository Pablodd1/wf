const { getClient } = require('./_lib/supabase');

/**
 * /api/update-record.js — v4.3
 * Human review UI backend: accepts field corrections and marks human_edited.
 * Used by DataBrowser / VerificationPage to save reviewer changes.
 *
 * Valid update fields: brand, reference, dial_color, condition, year,
 *   price_usd, currency, verdict, review_reason, listing_type
 * Automatically sets: human_edited=true, processed_at=now()
 *
 * POST /api/update-record
 * Body: { id, ...updates }
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id, ...updates } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing ID' });

  // Only allow known fields through (protect against injection)
  const allowed = [
    'brand', 'reference', 'dial_color', 'condition', 'year',
    'price_usd', 'currency', 'verdict', 'review_reason', 'listing_type',
    'reviewer_notes',
  ];
  const cleanUpdates = {};
  for (const key of allowed) {
    if (key in updates) cleanUpdates[key] = updates[key];
  }
  cleanUpdates.human_edited = true;
  cleanUpdates.processed_at = new Date().toISOString();

  try {
    const { data, error } = await getClient()
      .from('watch_records')
      .update(cleanUpdates)
      .eq('id', id)
      .select();

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
