'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function rpc(baseUrl, key, name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  const reviewId = Number(req.body?.reviewId);
  const decision = String(req.body?.decision || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: 'reviewId is required' });
  if (!['APPLY', 'REJECT'].includes(decision)) return res.status(400).json({ error: 'Unsupported price review decision' });
  if (!reason) return res.status(400).json({ error: 'A review reason is required' });

  try {
    const operatorId = auth.user.email || auth.user.id;
    const result = await rpc(
      baseUrl,
      key,
      decision === 'APPLY' ? 'apply_price_review_decision' : 'reject_price_review_decision',
      { p_review_id: reviewId, p_operator_id: operatorId, p_reason: reason }
    );
    return res.status(200).json({ status: 'ok', result, watchRecordsMutated: decision === 'APPLY' });
  } catch (error) {
    console.error('[price-remediation-review-decision]', error);
    const message = String(error?.message || 'Price review decision failed');
    if (/pending|required|policy|not found/i.test(message)) return res.status(409).json({ error: message.replace(/^Supabase \d+: /, '') });
    return res.status(500).json({ error: 'Price review decision failed' });
  }
};
