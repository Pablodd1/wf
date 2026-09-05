'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

async function rest(baseUrl, key, path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  return {
    rows: body ? JSON.parse(body) : [],
    total: Number(response.headers.get('content-range')?.split('/')[1] || 0),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  const page = Math.max(1, Number(req.query?.page || 1));
  const offset = (page - 1) * limit;
  try {
    const params = new URLSearchParams({
      select: 'id,source_record_id,normalization_version,stored_price_usd,proposed_price_usd,normalization_reason,evidence_line,audit_flags,review_status,created_at',
      review_status: 'eq.PENDING',
      order: 'created_at.asc,id.asc',
      offset: String(offset),
      limit: String(limit),
    });
    const review = await rest(baseUrl, key, `price_remediation_review?${params.toString()}`);
    const sourceIds = review.rows.map(row => row.source_record_id).filter(Boolean);
    let sourceById = new Map();
    if (sourceIds.length) {
      const sourceParams = new URLSearchParams({
        select: 'id,brand,reference,model,dial_color,condition,price_raw,price_usd,currency,raw_message,seller_name,seller_phone,listing_date,created_at,source,source_type,image_urls,thumbnail_url,has_images,listing_type,verdict,listing_status',
        id: `in.(${[...new Set(sourceIds)].join(',')})`,
        limit: String([...new Set(sourceIds)].length),
      });
      const source = await rest(baseUrl, key, `watch_records?${sourceParams.toString()}`);
      sourceById = new Map(source.rows.map(row => [row.id, row]));
    }
    return res.status(200).json({
      status: 'ok',
      page,
      limit,
      total: review.total,
      items: review.rows.map(row => ({ ...row, source: sourceById.get(row.source_record_id) || null })),
    });
  } catch (error) {
    console.error('[price-remediation-review]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Price remediation review queue is unavailable', items: [] });
  }
};
