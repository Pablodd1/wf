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
  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  const { stagingId, decision, reason = null, duplicateReviewed = false } = req.body || {};
  if (!stagingId) return res.status(400).json({ error: 'stagingId is required' });
  if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
  if (decision === 'REJECTED' && !String(reason || '').trim()) return res.status(400).json({ error: 'A rejection reason is required' });

  try {
    const result = await rest(baseUrl, key, 'rpc/apply_unbundled_staging_review_decision', {
      method: 'POST',
      body: JSON.stringify({
        p_staging_id: stagingId,
        p_decision: decision,
        p_operator_id: dealerAuth.user.email || dealerAuth.user.id,
        p_reason: reason,
        p_duplicate_reviewed: duplicateReviewed === true,
      }),
    });
    return res.status(200).json({ status: 'ok', result });
  } catch (error) {
    console.error('[unbundled-review-decision]', error);
    const message = String(error?.message || '');
    if (message.includes('approval policy')) return res.status(409).json({ error: 'This row does not meet the approval policy' });
    return res.status(500).json({ error: 'Unbundled review decision failed' });
  }
};
