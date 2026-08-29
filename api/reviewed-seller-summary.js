'use strict';

const { getClient } = require('./_lib/supabase');

const REVIEWED_ID = /^(?:cn_[a-z0-9_-]+|workbook_[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;
const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';
const CANONICAL_MARKET_SOURCE_VIEW = 'trading_floor_ready_view';

function approvedPhone(listing) {
  if (listing?.contact_publication_approved !== true) return null;
  if (typeof listing?.phone_number !== 'string' || !listing.phone_number.trim()) return null;
  return listing.phone_number;
}

async function loadVerifiedReputation(client, listing) {
  const sourceRecordIds = [listing.id, listing.source_record_id].filter(Boolean);
  if (!sourceRecordIds.length) return null;
  const { data: lineage, error: lineageError } = await client
    .from('seller_listing_lineage_staging')
    .select('matched_dealer_id')
    .in('source_record_id', sourceRecordIds)
    .eq('match_status', 'APPLIED')
    .not('matched_dealer_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (lineageError || !lineage?.matched_dealer_id) return null;

  const { data: dealer, error: dealerError } = await client
    .from('dealers')
    .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,status')
    .eq('id', lineage.matched_dealer_id)
    .eq('status', 'VERIFIED')
    .maybeSingle();
  if (dealerError || !dealer) return null;
  return {
    dealer_id: dealer.id,
    display_name: dealer.display_name || null,
    company_name: dealer.company_name || null,
    country: dealer.country_code || null,
    city: dealer.city || null,
    rating: dealer.rating == null ? null : Number(dealer.rating),
    review_count: Number(dealer.review_count || 0),
    group_count: Number(dealer.whatsapp_group_count || 0),
    profile_url: `/reference-check/${dealer.slug || dealer.id}`,
  };
}

async function loadSellerAnalytics(client, phone) {
  try {
    const { data, error } = await client.rpc('reviewed_workbook_seller_activity', {
      p_phone: phone,
    });
    if (!error) {
      const activity = Array.isArray(data) ? data[0] : data;
      const totalPosts = Number(activity?.total_posts || 0);
      if (totalPosts > 0) {
        const wtsPosts = Number(activity?.wts_posts || 0);
        const wtbPosts = Number(activity?.wtb_posts || 0);
        return {
          total_posts: totalPosts,
          wts_posts: wtsPosts,
          wtb_posts: wtbPosts,
          other_posts: Number(activity?.other_posts || Math.max(0, totalPosts - wtsPosts - wtbPosts)),
          first_post_at: activity?.first_post_at || null,
          last_post_at: activity?.last_post_at || null,
          analytics_scope: 'exact_reviewed_seller_activity',
          sample_capped: false,
        };
      }
    }
  } catch {
    // Continue to a bounded public-view fallback.
  }
  if (typeof client.from === 'function') {
    for (const view of [MARKET_SOURCE_VIEW, CANONICAL_MARKET_SOURCE_VIEW]) {
      const publicRows = await client
        .from(view)
        .select('listing_type,posting_date')
        .eq('phone_number', phone)
        .limit(10001);
      if (!publicRows.error && Array.isArray(publicRows.data) && publicRows.data.length) {
        const sampleCapped = publicRows.data.length > 10000;
        const activity = publicRows.data.slice(0, 10000);
      const dates = activity.map(row => row.posting_date).filter(Boolean).sort();
      const wtsPosts = activity.filter(row => String(row.listing_type || '').toUpperCase() === 'WTS').length;
      const wtbPosts = activity.filter(row => ['WTB', 'NTQ'].includes(String(row.listing_type || '').toUpperCase())).length;
      return {
        total_posts: activity.length,
        wts_posts: wtsPosts,
        wtb_posts: wtbPosts,
        other_posts: activity.length - wtsPosts - wtbPosts,
        first_post_at: dates[0] || null,
        last_post_at: dates.at(-1) || null,
          analytics_scope: view,
          sample_capped: sampleCapped,
      };
      }
    }
  }
  return {
    total_posts: 0,
    wts_posts: 0,
    wtb_posts: 0,
    other_posts: 0,
    first_post_at: null,
    last_post_at: null,
    analytics_scope: 'unavailable',
    sample_capped: false,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String(req.query?.id || '').trim();
  if (!REVIEWED_ID.test(id)) {
    return res.status(400).json({ status: 'error', error: 'Valid reviewed listing id required' });
  }

  try {
    const client = getClient();
    const marketResult = await client
      .from(MARKET_SOURCE_VIEW)
      .select('id,source_record_id,posted_by,phone_number,contact_publication_approved')
      .eq('id', id)
      .maybeSingle();
    let listing = marketResult.error ? null : marketResult.data;
    if (!listing && id.toLowerCase().startsWith('cn_')) {
      const canonicalResult = await client
        .from(CANONICAL_MARKET_SOURCE_VIEW)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!canonicalResult.error && canonicalResult.data) {
        const row = canonicalResult.data;
        listing = {
          ...row,
          posted_by: row.posted_by || row.seller_name || row.source_identity_name || null,
          phone_number: row.phone_number || row.seller_phone || row.from_number || null,
        };
      }
    }
    if (!listing) {
      const legacyResult = await client
        .from('reviewed_workbook_inventory')
        .select('id,source_record_id,posted_by,phone_number,contact_publication_approved')
        .eq('id', id)
        .maybeSingle();
      if (legacyResult.error) throw legacyResult.error;
      listing = legacyResult.data;
    }
    if (!listing) {
      return res.status(404).json({ status: 'error', error: 'Reviewed listing not found' });
    }

    const phone = approvedPhone(listing);
    const publicName = listing.posted_by || null;
    const [analytics, reputation] = await Promise.all([
      phone ? loadSellerAnalytics(client, phone).catch(() => null) : null,
      loadVerifiedReputation(client, listing).catch(() => null),
    ]);
    return res.status(200).json({
      status: 'ok',
      contact_available: Boolean(phone || publicName),
      seller: {
        name: publicName,
        phone,
      },
      analytics,
      reputation,
    });
  } catch (error) {
    console.error('[reviewed-seller-summary] error:', JSON.stringify({
      code: String(error?.code || ''),
      message: String(error?.message || error || ''),
      details: String(error?.details || ''),
      hint: String(error?.hint || ''),
    }));
    return res.status(503).json({
      status: 'error',
      error: 'Seller activity is temporarily unavailable',
    });
  }
};

module.exports.REVIEWED_ID = REVIEWED_ID;
module.exports.approvedPhone = approvedPhone;
module.exports.loadSellerAnalytics = loadSellerAnalytics;
module.exports.loadVerifiedReputation = loadVerifiedReputation;
