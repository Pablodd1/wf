'use strict';

const { buildPromotionDecision } = require('../tools/shadow-reprocess/promotion-policy.cjs');
const { confirmCatalogCandidate } = require('../tools/shadow-reprocess/catalog-confirmation.cjs');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const REVIEW_FLAGS = new Set([
  'BUNDLE_SPLIT_REQUIRED',
  'NO_CANDIDATE',
  'REFERENCE_CHANGED',
  'INTENT_CHANGED',
  'PRICE_CHANGED',
  'BRAND_CHANGED',
  'CURRENCY_CHANGED',
  'CURRENCY_AMBIGUOUS',
  'PRICE_PARSE_FAILED',
  'EMOJI_PRICE_AMBIGUOUS',
  'DIAL_CHANGED',
  'DIAL_AMBIGUOUS',
]);

const PRIORITY_BY_FLAG = {
  CURRENCY_AMBIGUOUS: 100,
  PRICE_PARSE_FAILED: 95,
  EMOJI_PRICE_AMBIGUOUS: 96,
  DIAL_AMBIGUOUS: 92,
  BUNDLE_SPLIT_REQUIRED: 90,
  NO_CANDIDATE: 85,
  REFERENCE_CHANGED: 65,
  CURRENCY_CHANGED: 60,
  PRICE_CHANGED: 55,
  DIAL_CHANGED: 50,
  BRAND_CHANGED: 45,
  INTENT_CHANGED: 35,
};

function reviewPriority(flags, disposition) {
  const flagScore = (flags || []).reduce((highest, flag) => Math.max(highest, PRIORITY_BY_FLAG[flag] || 0), 0);
  // A catalog-confirmed proposal is visible, but should not jump ahead of
  // records that can distort market prices or split into several listings.
  return disposition === 'READY_FOR_HUMAN_APPROVAL' ? Math.min(flagScore, 30) : flagScore;
}

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

async function loadSourceEvidence(baseUrl, key, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const params = new URLSearchParams({
    select: 'id,raw_message,seller_name,seller_phone,listing_date,created_at,source,source_type,reference,brand,dial_color,condition,price_raw,price_usd,currency,listing_type,image_urls,thumbnail_url,has_images,flags',
    id: `in.(${uniqueIds.join(',')})`,
    limit: String(uniqueIds.length),
  });
  const rows = await rest(baseUrl, key, `watch_records?${params.toString()}`);
  return new Map(rows.map(row => [row.id, row]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ status: 'not_configured', items: [] });

  const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 100));
  const requestedReason = String(req.query?.reason || '').trim().toUpperCase();
  const reason = REVIEW_FLAGS.has(requestedReason) ? requestedReason : null;
  const sort = req.query?.sort === 'recent' ? 'recent' : 'priority';
  try {
    const params = new URLSearchParams({
      select: 'source_record_id,source_brand,source_reference,source_price_raw,source_currency,source_listing_type,candidate_count,proposed_candidates,change_flags,analyzed_at',
      review_status: 'eq.PENDING',
      order: 'analyzed_at.desc',
      limit: String(limit),
    });
    if (reason) params.set('change_flags', `cs.{${reason}}`);
    const rows = await rest(baseUrl, key, `normalization_shadow_v4?${params.toString()}`);
    const sourceEvidence = await loadSourceEvidence(baseUrl, key, rows.map(row => row.source_record_id));
    const items = rows.map(row => {
      const candidate = row.candidate_count === 1 ? row.proposed_candidates?.[0] : null;
      const catalogConfirmation = candidate ? confirmCatalogCandidate(candidate) : null;
      const decision = buildPromotionDecision(row, catalogConfirmation);
      const source = sourceEvidence.get(row.source_record_id) || {};
      return {
        id: row.source_record_id,
        source: {
          brand: source.brand || row.source_brand,
          reference: source.reference || row.source_reference,
          priceRaw: source.price_raw ?? row.source_price_raw,
          priceUsd: source.price_usd ?? null,
          currency: source.currency || row.source_currency,
          listingType: source.listing_type || row.source_listing_type,
        },
        sourceEvidence: {
          rawMessage: source.raw_message || null,
          sellerName: source.seller_name || null,
          sellerPhone: source.seller_phone || null,
          originalPostingDate: source.listing_date || source.created_at || null,
          createdAt: source.created_at || null,
          source: source.source || null,
          sourceType: source.source_type || null,
          dialColor: source.dial_color || null,
          condition: source.condition || null,
          imageUrls: source.image_urls || [],
          thumbnailUrl: source.thumbnail_url || null,
          hasImages: Boolean(source.has_images),
          flags: source.flags || [],
        },
        candidate,
        changeFlags: row.change_flags,
        analyzedAt: row.analyzed_at,
        decision,
        priority: reviewPriority(row.change_flags, decision.disposition),
      };
    });
    if (sort === 'priority') {
      items.sort((left, right) => right.priority - left.priority || String(right.analyzedAt).localeCompare(String(left.analyzedAt)));
    }
    return res.status(200).json({ status: 'ok', count: items.length, reason, sort, items });
  } catch (error) {
    console.error('[shadow-review-queue]', error);
    return res.status(500).json({ status: 'unavailable', items: [] });
  }
};
