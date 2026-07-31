'use strict';

const { getClient } = require('./_lib/supabase');

const REVIEWED_ID = /^workbook_[a-f0-9]{64}$/;

function approvedPhone(listing) {
  if (listing?.contact_publication_approved !== true) return null;
  if (typeof listing.phone_number !== 'string' || !listing.phone_number.trim()) return null;
  return listing.phone_number;
}

async function loadSellerAnalytics(client, phone) {
  const { data, error } = await client.rpc('reviewed_workbook_seller_activity', {
    p_phone: phone,
  });
  if (error) throw error;
  const activity = Array.isArray(data) ? data[0] : data;
  const totalPosts = Number(activity?.total_posts || 0);
  const wtsPosts = Number(activity?.wts_posts || 0);
  const wtbPosts = Number(activity?.wtb_posts || 0);
  return {
    total_posts: totalPosts,
    wts_posts: wtsPosts,
    wtb_posts: wtbPosts,
    other_posts: Number(activity?.other_posts || 0),
    first_post_at: activity?.first_post_at || null,
    last_post_at: activity?.last_post_at || null,
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
