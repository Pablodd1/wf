/**
 * /api/update-record.js
 * ======================
 * Serverless endpoint for human editors to update a watch_records row.
 * Auth: admin_key required (header x-admin-key or body.admin_key)
 * Method: PATCH
 *
 * This is the WRITE endpoint that ALL admin UI pages call.
 * It records human_edited=true + edit_timestamp every time.
 */
const { getClient } = require('./_lib/supabase');

const ADMIN_KEY = process.env.ADMIN_KEY || 'wf-admin-2026';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://watchfacts-poc.vercel.app';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });

  // Auth check
  const key = req.headers['x-admin-key'] || req.body?.admin_key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid admin key' });
  }

  const { id, ...fields } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Whitelist of editable fields — nothing outside this list touches the DB
  const ALLOWED_FIELDS = [
    'brand', 'reference', 'dial_color', 'condition', 'year',
    'price_usd', 'currency', 'confidence', 'verdict', 'listing_type',
    'set_status', 'case_metal', 'model',
  ];

  const updateData = {};
  for (const key of Object.keys(fields)) {
    if (ALLOWED_FIELDS.includes(key)) {
      updateData[key] = fields[key];
    }
  }

  // Always mark human-edited
  updateData.human_edited = true;
  updateData.edit_source = 'admin_ui';
  updateData.processed_at = new Date().toISOString();

  // If changing verdict to APPROVED without a confidence, set 100
  if (updateData.verdict === 'APPROVED' && !updateData.confidence && fields.confidence === undefined) {
    updateData.confidence = 100;
  }

  try {
    const client = getClient();
    const { data, error } = await client
      .from('watch_records')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
      console.error('[update-record] DB error:', error.message);
      return res.status(500).json({ error: 'Database update failed', detail: error.message });
    }

    return res.status(200).json({
      success: true,
      updated: data?.[0] || null,
      fields_changed: Object.keys(updateData),
    });
  } catch (err) {
    console.error('[update-record] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
