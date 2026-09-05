'use strict';

const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');
const { confirmCatalogCandidate } = require('../tools/shadow-reprocess/catalog-confirmation.cjs');
const { validateReviewerDecision } = require('../tools/shadow-reprocess/review-decision-policy.cjs');
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
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const reviewToken = process.env.REVIEW_OPERATOR_TOKEN;
  const adminKey = process.env.ADMIN_KEY;
  const reviewAuthorized = Boolean(reviewToken) && req.headers['x-review-operator-token'] === reviewToken;
  const adminAuthorized = Boolean(adminKey) && req.headers['x-admin-key'] === adminKey;
  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  const sessionAuthorized = !dealerAuth.error;
  if (!reviewAuthorized && !adminAuthorized && !sessionAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  const { sourceRecordId, decision, operatorId: requestedOperatorId, reason = null } = req.body || {};
  const operatorId = sessionAuthorized ? (dealerAuth.user.email || dealerAuth.user.id) : requestedOperatorId;
  if (!sourceRecordId) return res.status(400).json({ error: 'sourceRecordId is required' });

  try {
    const rows = await rest(baseUrl, key, `normalization_shadow_v4?source_record_id=eq.${encodeURIComponent(sourceRecordId)}&select=*&limit=1`);
    const shadow = rows?.[0];
    if (!shadow) return res.status(404).json({ error: 'Shadow proposal not found' });
    const candidate = shadow.candidate_count === 1 ? shadow.proposed_candidates?.[0] : null;
    const catalogConfirmation = candidate ? confirmCatalogCandidate(candidate) : null;
    const queueItem = { decision: buildPromotionDecision(shadow, catalogConfirmation) };
    const validation = validateReviewerDecision({ decision, operatorId, queueItem });
    if (!validation.valid) return res.status(409).json({ error: validation.error });

    const result = await rest(baseUrl, key, 'rpc/apply_shadow_review_decision', {
      method: 'POST',
      body: JSON.stringify({
        p_source_record_id: sourceRecordId,
        p_decision: decision,
        p_operator_id: operatorId,
        p_reason: reason,
        p_catalog_confirmation: catalogConfirmation || {},
      }),
    });
    return res.status(200).json({ status: 'ok', result });
  } catch (error) {
    console.error('[shadow-review-decision]', error);
    return res.status(500).json({ error: 'Review decision failed' });
  }
};
