'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function queueItem(row) {
  const sourceIdentityMasked = maskPhone(row.source_identity);
  return {
    lineage_id: row.lineage_id,
    source_record_id: row.source_record_id,
    record_id: row.record_id,
    raw_message: row.raw_message || null,
    observed_name: row.observed_name || null,
    source_identity: sourceIdentityMasked,
    source_identity_masked: sourceIdentityMasked,
    source_system: row.source_system,
    source_listing_type: row.source_listing_type || null,
    source_posted_at: row.source_posted_at || null,
    front_image: row.front_image || null,
    match_status: row.match_status,
    match_evidence: row.match_evidence || {},
    proposed_dealer: {
      id: row.proposed_dealer_id,
      display_name: row.proposed_dealer_display_name || null,
      company_name: row.proposed_dealer_company_name || null,
      status: row.proposed_dealer_status,
    },
  };
}

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=planned',
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 250)}`);
  const totalText = response.headers.get('content-range')?.split('/')[1];
  return {
    rows: body ? JSON.parse(body) : [],
    total: totalText && totalText !== '*' ? Number(totalText) : null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) {
    return res.status(503).json({ status: 'not_configured', items: [], total: null });
  }

  const limit = Math.min(positiveInteger(req.query?.limit, 50), 100);
  const cursor = positiveInteger(req.query?.cursor, null);
  const params = new URLSearchParams({
    select: [
      'lineage_id',
      'source_record_id',
      'record_id',
      'raw_message',
      'observed_name',
      'source_identity',
      'source_system',
      'source_listing_type',
      'source_posted_at',
      'front_image',
      'match_status',
      'match_evidence',
      'proposed_dealer_id',
      'proposed_dealer_display_name',
      'proposed_dealer_company_name',
      'proposed_dealer_status',
    ].join(','),
    order: 'lineage_id.asc',
    limit: String(limit),
  });
  if (cursor !== null) params.set('lineage_id', `gt.${cursor}`);

  try {
    const result = await rest(baseUrl, key, `seller_lineage_review_queue?${params.toString()}`);
    const items = result.rows.map(queueItem);
    return res.status(200).json({
      status: 'ok',
      limit,
      cursor,
      nextCursor: items.length === limit ? items.at(-1)?.lineage_id || null : null,
      total: result.total,
      totalCountMode: 'planned',
      items,
    });
  } catch (error) {
    console.error('[seller-lineage-review-queue]', error);
    return res.status(500).json({
      status: 'unavailable',
      error: 'Seller lineage review queue is unavailable',
      items: [],
      total: null,
    });
  }
};

module.exports.maskPhone = maskPhone;
module.exports.positiveInteger = positiveInteger;
module.exports.queueItem = queueItem;
