const { getClient } = require('./_lib/supabase');
const { withRateLimit } = require('./_lib/rate-limiter');

/**
 * /api/update-record.js — v4.3
 * Human review UI backend: accepts field corrections and marks human_edited.
 *
 * POST /api/update-record
 * Body: { id, ...updates }
 *
 * v4.3 audit fixes: rate-limited, CORS restricted, value validation,
 * generic error messages.
 */

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app';

const handler = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id, ...updates } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing ID' });

  // Value validators (M-8)
  if (updates.price_usd !== undefined) {
    if (typeof updates.price_usd !== 'number' || updates.price_usd < 0 || updates.price_usd > 50000000) {
      return res.status(400).json({ error: 'Invalid price_usd — must be 0–50,000,000' });
    }
  }
  if (updates.year !== undefined) {
    if (typeof updates.year !== 'number' || updates.year < 1900 || updates.year > 2100) {
      return res.status(400).json({ error: 'Invalid year — must be 1900–2100' });
    }
  }
  if (updates.confidence !== undefined) {
    if (typeof updates.confidence !== 'number' || updates.confidence < 0 || updates.confidence > 100) {
      return res.status(400).json({ error: 'Invalid confidence — must be 0–100' });
    }
  }

  // Only allow known fields through
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
    const client = getClient();
    const { data, error } = await client
      .from('watch_records')
      .update(cleanUpdates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[update-record] DB error:', error.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[update-record] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = withRateLimit('/api/update-record', handler);
