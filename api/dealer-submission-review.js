'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const REVIEW_ROLES = new Set(['reviewer', 'admin']);
const DECISIONS = new Set(['APPROVE', 'REJECT']);

function clean(value, max = 1000) {
  const result = String(value || '').trim();
  return result ? result.slice(0, max) : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

function normalizedFields(body = {}) {
  const fields = body.normalized_fields || {};
  const result = {
    title: clean(fields.title, 240),
    brand: clean(fields.brand, 100),
    model: clean(fields.model, 120),
    reference: clean(fields.reference, 100),
    dial_color: clean(fields.dial_color, 80),
    condition: clean(fields.condition, 80),
    currency: clean(fields.currency, 12)?.toUpperCase() || null,
    price_amount: fields.price_amount == null || fields.price_amount === '' ? null : Number(fields.price_amount),
    catalog_confirmed: fields.catalog_confirmed === true,
  };
  if (result.price_amount != null && (!Number.isFinite(result.price_amount) || result.price_amount <= 0 || result.price_amount > 1_000_000_000)) {
    return { error: 'Normalized price must be a valid positive amount.' };
  }
  return { fields: Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null)) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const authorization = await authorizeDealer(req, res, REVIEW_ROLES);
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  if (req.method === 'GET') {
    const requestedLimit = Number.parseInt(String(req.query?.limit || '50'), 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const { data, error, count } = await authorization.client.from('dealer_listing_submissions')
      .select('id,dealer_id,auth_user_id,intent,category,raw_message,claimed_fields,image_urls,poster_image_url,review_status,publication_status,bulk_submission_id,raw_payload_id,processing_job_id,queued_at,created_at', { count: 'exact' })
      .in('review_status', ['PENDING_REVIEW', 'IN_REVIEW'])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return res.status(500).json({ error: 'Unable to load dealer submissions for review.' });
    return res.status(200).json({ success: true, total: count || 0, items: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin.' });
  const submissionId = clean(req.body?.submission_id, 80);
  const decision = clean(req.body?.decision, 20)?.toUpperCase();
  if (!submissionId || !/^[0-9a-f-]{36}$/i.test(submissionId)) return res.status(400).json({ error: 'A valid submission ID is required.' });
  if (!DECISIONS.has(decision)) return res.status(400).json({ error: 'Choose APPROVE or REJECT.' });
  if (decision === 'APPROVE') {
    return res.status(409).json({
      error: 'Approval is paused until immutable normalization, identity, currency, duplicate, and media gates are verified.',
      code: 'DEALER_SUBMISSION_PUBLICATION_HELD',
    });
  }
  const normalized = normalizedFields(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const { data, error } = await authorization.client.rpc('review_dealer_submission', {
    p_submission_id: submissionId,
    p_decision: decision,
    p_reviewer_id: authorization.user.id,
    p_review_notes: clean(req.body?.review_notes, 2000),
    p_normalized_fields: normalized.fields || {},
  });
  if (error) {
    const conflict = /terminal decision|bundle workflow|requires brand/i.test(error.message);
    return res.status(conflict ? 409 : 500).json({ error: conflict ? error.message : 'Unable to apply the dealer submission decision.' });
  }
  return res.status(200).json({ success: true, result: data?.[0] || null });
};

module.exports.normalizedFields = normalizedFields;
