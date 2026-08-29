'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function maskName(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean)
    .map(part => `${part[0]}***`).join(' ') || null;
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : null;
}

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body.slice(0, 250)}`);
  return {
    rows: body ? JSON.parse(body) : [],
    total: Number(response.headers.get('content-range')?.split('/')[1] || 0),
  };
}

async function loadSellerLineage(baseUrl, key, rows) {
  const sourceIds = [...new Set(rows
    .map(row => String(row.field_confidence?.source_record_id || '').trim())
    .filter(value => /^[A-Za-z0-9_-]+$/.test(value)))];
  if (!sourceIds.length) return new Map();
  const params = new URLSearchParams({
    select: 'source_record_id,source_identity,observed_name,source_posted_at,front_image,match_status,match_evidence',
    source_record_id: `in.(${sourceIds.join(',')})`,
    limit: String(sourceIds.length),
  });
  const lineageRows = await rest(baseUrl, key, `seller_listing_lineage_staging?${params.toString()}`);
  return new Map(lineageRows.rows.map(row => [String(row.source_record_id), row]));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const batchId = String(req.query?.batchId || '').trim();
  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  const offset = (page - 1) * limit;
  const requestedBucket = String(req.query?.bucket || 'review-ready').trim().toLowerCase();
  const bucket = requestedBucket === 'human-correction' ? 'human-correction' : 'review-ready';
  const search = String(req.query?.search || '').trim().replace(/[(),]/g, ' ').slice(0, 80);

  try {
    const params = new URLSearchParams({
      select: 'id,batch_id,raw_message,brand,reference,dial_color,condition,year,price_raw,price_usd,currency,source,created_at,listing_type,flags,field_confidence,verdict,confidence,human_edited',
      verdict: 'eq.PENDING',
      order: 'created_at.desc,id.asc',
      offset: String(offset),
      limit: String(limit),
    });
    if (batchId) params.set('batch_id', `eq.${batchId}`);
    params.set('field_confidence->>review_bucket', `eq.${bucket}`);
    if (search) params.set('or', `(brand.ilike.*${search}*,reference.ilike.*${search}*,raw_message.ilike.*${search}*)`);
    const result = await rest(baseUrl, key, `watch_staging?${params.toString()}`);
    const sellerLineage = await loadSellerLineage(baseUrl, key, result.rows);
    const items = result.rows.map(row => {
      const seller = sellerLineage.get(String(row.field_confidence?.source_record_id || ''));
      const flags = Array.isArray(row.flags) ? row.flags : [];
      const isUnbundledChild = flags.includes('UNBUNDLED_CHILD');
      return {
        ...row,
        batchId: row.batch_id,
        reviewBucket: row.field_confidence?.review_bucket || null,
        dealerAttributionMissing: !seller,
        sourceRecordId: row.field_confidence?.source_record_id || null,
        sourceChildId: row.field_confidence?.source_child_id || null,
        catalogConfirmed: row.field_confidence?.catalog_confirmed === true,
        exactRawLineage: row.field_confidence?.exact_raw_lineage === true,
        seller_name: maskName(seller?.observed_name),
        seller_phone: maskPhone(seller?.source_identity),
        seller_contact_available: Boolean(seller?.source_identity),
        original_posted_at: seller?.source_posted_at || null,
        isUnbundledChild,
        // ponytail: multi-listing children must not inherit the parent bundle image
        front_image: null,
        multi_listing: isUnbundledChild,
        // Recycle bin: preserve parent image URL for admin visual review / future crop-and-match
        recycle_image_url: seller?.front_image || null,
        seller_lineage_status: seller?.match_status || null,
      };
    });
    return res.status(200).json({ status: 'ok', batchId: batchId || null, page, limit, total: result.total, bucket, items });
  } catch (error) {
    console.error('[unbundled-review-queue]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Unbundled review queue is unavailable', items: [] });
  }
};

module.exports.maskName = maskName;
module.exports.maskPhone = maskPhone;
