'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function rest(baseUrl, key, path, countMode = null) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (countMode) headers.Prefer = `count=${countMode}`;
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  return {
    rows: body ? JSON.parse(body) : [],
    total: response.headers.get('content-range')?.split('/')[1] === '*'
      ? null
      : Number(response.headers.get('content-range')?.split('/')[1] || 0),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  const offset = (page - 1) * limit;
  const requestedStatus = String(req.query?.status || 'PENDING').toUpperCase();
  const status = ['PENDING', 'SUPPRESSED', 'KEEP_BOTH', 'DEFERRED'].includes(requestedStatus) ? requestedStatus : 'PENDING';
  const params = new URLSearchParams({
    select: 'id,canonical_id,duplicate_id,match_type,confidence,suppress_from_analytics,bundle_risk,evidence,status,created_at,reviewer_id,review_reason,reviewed_at',
    status: `eq.${status}`,
    order: 'confidence.desc,created_at.desc',
    offset: String(offset),
    limit: String(limit),
  });

  try {
    const result = await rest(baseUrl, key, `duplicate_review_candidates?${params.toString()}`, 'planned');
    const ids = result.rows.flatMap(row => [row.canonical_id, row.duplicate_id]);
    const sourceParams = new URLSearchParams({
      select: 'id,brand,reference,dial_color,condition,price_usd,currency,raw_message,seller_name,seller_phone,listing_date,created_at,source,source_type,image_urls,thumbnail_url,has_images,listing_type,verdict,listing_status',
      id: `in.(${[...new Set(ids)].join(',')})`,
      limit: String([...new Set(ids)].length),
    });
    const source = await rest(baseUrl, key, `watch_records?${sourceParams.toString()}`);
    const sourceById = new Map(source.rows.map(row => [row.id, row]));
    const items = result.rows.map(row => ({
      ...row,
      canonical: sourceById.get(row.canonical_id) || null,
      duplicate: sourceById.get(row.duplicate_id) || null,
    }));
    return res.status(200).json({
      status: 'ok',
      page,
      limit,
      total: result.total,
      totalCountMode: 'planned',
      queueStatus: status,
      items,
    });
  } catch (error) {
    console.error('[duplicate-review-queue]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Duplicate review queue is unavailable', items: [] });
  }
};
