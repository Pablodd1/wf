'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function rest(baseUrl, key, path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  const body = req.body || {};
  const stagingId = String(body.stagingId || '').trim();
  const action = String(body.action || '').trim().toUpperCase();
  if (!stagingId) return res.status(400).json({ error: 'stagingId is required' });
  if (!['SAVE', 'DEFER', 'RECYCLE'].includes(action)) return res.status(400).json({ error: 'Unsupported review action' });
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    if (action === 'SAVE') return res.status(400).json({ error: 'fields are required for SAVE' });
  }

  const allowed = ['brand', 'reference', 'dial_color', 'condition', 'year', 'price_raw', 'price_usd', 'currency', 'listing_type'];
  const fields = Object.fromEntries(Object.entries(body.fields || {}).filter(([key]) => allowed.includes(key)));
  try {
    const result = await rest(baseUrl, key, 'rpc/apply_unbundled_human_review_action', {
      method: 'POST',
      body: JSON.stringify({
        p_staging_id: stagingId,
        p_action: action,
        p_operator_id: auth.user.email || auth.user.id,
        p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
        p_fields: fields,
      }),
    });
    return res.status(200).json({ status: 'ok', result });
  } catch (error) {
    console.error('[unbundled-review-action]', error);
    const message = String(error?.message || '');
    if (/requires|Unsupported|Pending|reason/i.test(message)) return res.status(409).json({ error: message.replace(/^Supabase \d+: /, '') });
    return res.status(500).json({ error: 'Human review action failed' });
  }
};
