'use strict';

const { getClient } = require('./_lib/supabase');

const REVIEWED_ID = /^workbook_[a-f0-9]{64}$/;

function approvedPhone(listing) {
  if (listing?.contact_publication_approved !== true) return null;
  if (typeof listing.phone_number !== 'string' || !listing.phone_number.trim()) return null;
  return listing.phone_number;
}

function activityQuery(client, phone, { type, dated, ascending } = {}) {
  let query = client
    .from('reviewed_workbook_inventory')
    .select(dated ? 'posting_date,id' : 'id', dated
      ? undefined
      : { count: 'exact', head: true })
    .eq('contact_publication_approved', true)
    .eq('phone_number', phone);
  if (type) query = query.eq('listing_type', type);
  if (dated) {
    query = query
      .not('posting_date', 'is', null)
      .order('posting_date', { ascending })
      .order('id', { ascending })
      .limit(1)
      .maybeSingle();
  }
  return query;
}

async function loadSellerAnalytics(client, phone) {
  const [total, wts, wtb, first, last] = await Promise.all([
    activityQuery(client, phone),
    activityQuery(client, phone, { type: 'WTS' }),
    activityQuery(client, phone, { type: 'WTB' }),
    activityQuery(client, phone, { dated: true, ascending: true }),
    activityQuery(client, phone, { dated: true, ascending: false }),
  ]);
  const failed = [total, wts, wtb, first, last].find(result => result.error);
  if (failed) throw failed.error;
  const totalPosts = Number(total.count || 0);
  const wtsPosts = Number(wts.count || 0);
  const wtbPosts = Number(wtb.count || 0);
  return {
    total_posts: totalPosts,
    wts_posts: wtsPosts,
    wtb_posts: wtbPosts,
    // The table permits only WTS, WTB, OTHER, or null. The remainder is the
    // exact OTHER/unspecified activity count; no intent is inferred.
    other_posts: Math.max(0, totalPosts - wtsPosts - wtbPosts),
    first_post_at: first.data?.posting_date || null,
    last_post_at: last.data?.posting_date || null,
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
    const { data: listing, error } = await client
      .from('reviewed_workbook_inventory')
      .select('id,posted_by,phone_number,contact_publication_approved')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!listing) {
      return res.status(404).json({ status: 'error', error: 'Reviewed listing not found' });
    }

    const phone = approvedPhone(listing);
    if (!phone) {
      return res.status(200).json({
        status: 'ok',
        contact_available: false,
        seller: null,
        analytics: null,
      });
    }

    const analytics = await loadSellerAnalytics(client, phone);
    return res.status(200).json({
      status: 'ok',
      contact_available: true,
      seller: {
        name: listing.posted_by || null,
        phone,
      },
      analytics,
    });
  } catch (error) {
    console.error('[reviewed-seller-summary] error:', error.message);
    return res.status(503).json({
      status: 'error',
      error: 'Reviewed seller analytics are temporarily unavailable',
    });
  }
};

module.exports.REVIEWED_ID = REVIEWED_ID;
module.exports.approvedPhone = approvedPhone;
module.exports.loadSellerAnalytics = loadSellerAnalytics;
