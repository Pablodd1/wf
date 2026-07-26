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

  const candidateId = String(req.body?.candidateId || '').trim();
  const decision = String(req.body?.decision || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!candidateId) return res.status(400).json({ error: 'candidateId is required' });
  if (!['SUPPRESS', 'KEEP_BOTH', 'DEFER', 'RESTORE_KEEP_BOTH'].includes(decision)) {
    return res.status(400).json({ error: 'Unsupported duplicate decision' });
  }
  if (decision === 'RESTORE_KEEP_BOTH' && auth.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required to restore suppression' });
  }
  if (!reason) return res.status(400).json({ error: 'A duplicate review reason is required' });

  try {
    const restore = decision === 'RESTORE_KEEP_BOTH';
    const result = await rest(baseUrl, key, restore
      ? 'rpc/restore_duplicate_review_suppression'
      : 'rpc/apply_duplicate_review_decision', {
      method: 'POST',
      body: JSON.stringify(restore
        ? {
            p_candidate_id: candidateId,
            p_operator_id: auth.user.email || auth.user.id,
            p_reason: reason,
          }
        : {
            p_candidate_id: candidateId,
            p_decision: decision,
            p_operator_id: auth.user.email || auth.user.id,
            p_reason: reason,
          }),
    });
    return res.status(200).json({ status: 'ok', result, rawEvidencePreserved: true, watchRecordsDeleted: false });
  } catch (error) {
    console.error('[duplicate-review-decision]', error);
    const message = String(error?.message || '');
    if (/not pending|not suppressed|reason|required|Unsupported/i.test(message)) {
      return res.status(409).json({ error: message.replace(/^Supabase \d+: /, '') });
    }
    return res.status(500).json({ error: 'Duplicate review decision failed' });
  }
};
