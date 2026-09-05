'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function rpc(baseUrl, key, body) {
  const response = await fetch(
    `${baseUrl}/rest/v1/rpc/apply_seller_lineage_review_decision`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) {
    return res.status(503).json({ error: 'Supabase server configuration missing' });
  }

  const lineageId = Number(req.body?.lineageId);
  const recordId = String(req.body?.recordId || '').trim();
  const dealerId = String(req.body?.dealerId || '').trim();
  const decision = String(req.body?.decision || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!Number.isSafeInteger(lineageId) || lineageId <= 0) {
    return res.status(400).json({ error: 'lineageId is required' });
  }
  if (!recordId || recordId.length > 250) {
    return res.status(400).json({ error: 'recordId is required' });
  }
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'Unsupported seller lineage decision' });
  }
  if (decision === 'APPROVE' && !uuidPattern.test(dealerId)) {
    return res.status(400).json({ error: 'Approval requires a valid dealerId' });
  }
  if (reason.length < 12) {
    return res.status(400).json({ error: 'Review reason must contain at least 12 characters' });
  }

  try {
    const result = await rpc(baseUrl, key, {
      p_lineage_id: lineageId,
      p_record_id: recordId,
      p_dealer_id: decision === 'APPROVE' ? dealerId : null,
      p_decision: decision,
      p_operator_id: auth.user.email || auth.user.id,
      p_reason: reason,
    });
    return res.status(200).json({
      status: 'ok',
      result,
      rawEvidencePreserved: true,
      dealerAttached: result?.status === 'APPLIED',
      contactPublished: false,
      contactAccessRequiresListingContactGate: true,
    });
  } catch (error) {
    console.error('[seller-lineage-review-decision]', error);
    const message = String(error?.message || '');
    if (/not found|required|MATCH_READY|exact|evidence|invalid|ambiguous|VERIFIED|conflict|different dealer|at least 12/i.test(message)) {
      return res.status(409).json({ error: message.replace(/^Supabase \d+: /, '') });
    }
    return res.status(500).json({ error: 'Seller lineage review decision failed' });
  }
};

module.exports.sameOrigin = sameOrigin;
