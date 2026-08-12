'use strict';

const { getClient } = require('./_lib/supabase');
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { MIN_RELEASE_CONFIDENCE, isReleaseListingEligible } = require('./_lib/publication-references.cjs');
const { legacyProfilePayload, sourceProfilePayload } = require('./_lib/dealer-directory-source.cjs');

function buildDealerStats(listings, dealer, verifiedPhone, aggregate = null) {
  const dates = listings
    .map(listing => listing.listing_date || listing.created_at)
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((left, right) => left - right);
  const countIntent = intent => listings.filter(listing =>
    String(listing.listing_type || '').trim().toUpperCase() === intent).length;
  return {
    wts_count: Number(aggregate?.wts_posts ?? countIntent('WTS')),
    wtb_count: Number(aggregate?.wtb_posts ?? countIntent('WTB')),
    group_count: Number(dealer.whatsapp_group_count || 0),
    first_post: aggregate?.first_post_at || dates[0]?.toISOString() || null,
    latest_post: aggregate?.last_post_at || dates.at(-1)?.toISOString() || null,
    verified_contact_info: dealer.contact_consent && verifiedPhone
      ? { phone: verifiedPhone, verification_status: 'VERIFIED' }
      : null,
  };
}

function mapLegacyLiveListing(row) {
  return {
    id: row.id,
    brand: row.canonical_brand || row.supplied_brand || null,
    model: row.catalog_model || row.model || null,
    reference: row.normalized_reference || row.raw_reference || null,
    dial_color: row.dial_color || null,
    condition: row.condition || null,
    price_usd: Number(row.verified_price_usd) > 0 ? Number(row.verified_price_usd) : null,
    price_raw: Number(row.source_price_amount) > 0 ? Number(row.source_price_amount) : null,
    display_price: row.source_price_text || null,
    currency: row.source_currency || null,
    listing_type: row.listing_type || null,
    listing_date: row.posting_date || null,
    created_at: row.posting_date || null,
    raw_message: row.raw_message || null,
    image_url: row.user_image_url || null,
    seller_name: row.seller_name || row.posted_by || null,
    seller_phone: row.seller_phone || null,
    location: row.location || null,
    evidence_only: false,
  };
}

async function loadLegacyDynamicProfile(client, payload) {
  const legacyId = payload?.dealer?.legacy_profile_id;
  if (!legacyId) return payload;
  const { data, error } = await client.rpc('qnsa_legacy_dealer_activity', {
    p_legacy_profile_id: Number(legacyId), p_limit: 50,
  });
  if (error) throw error;
  const liveListings = (data?.listings || []).map(row => ({ ...row, evidence_only: false }));
  const liveCount = Number(data?.wts_count || 0) + Number(data?.wtb_count || 0);
  if (liveCount === 0 && liveListings.length === 0) {
    return {
      ...payload,
      dynamic_activity_status: 'UNLINKED_IDENTITY_NAMESPACE',
      stats: {
        ...payload.stats,
        current_counts_are_dynamic: false,
        current_counts_scope: 'LEGACY_SNAPSHOT_PENDING_EXACT_LINEAGE_LINK',
      },
    };
  }
  return {
    ...payload,
    stats: {
      ...payload.stats,
      wts_count: Number(data?.wts_count || 0),
      wtb_count: Number(data?.wtb_count || 0),
      first_post: data?.first_post || null,
      latest_post: data?.latest_post || null,
      current_counts_are_dynamic: true,
      current_counts_scope: 'QNSA_RELEASED_ROLEX_PATEK',
    },
    listings: liveListings,
    historical_posts: payload.listings,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const identity = String(req.query?.id || '').trim().slice(0, 160);
  if (!identity) return res.status(400).json({ error: 'Dealer id or slug required' });

  const sourceProfile = sourceProfilePayload(identity);
  if (sourceProfile) return res.status(200).json(sourceProfile);
  const legacyProfile = legacyProfilePayload(identity);
  if (legacyProfile) {
    try {
      const dynamic = await loadLegacyDynamicProfile(getClient(), legacyProfile);
      return res.status(200).json(dynamic);
    } catch (error) {
      console.error('[dealer-profile:legacy-dynamic]', error.message);
      return res.status(200).json({
        ...legacyProfile,
        dynamic_activity_status: 'TEMPORARILY_UNAVAILABLE',
      });
    }
  }

  try {
    const client = getClient();
    let query = client
      .from('dealers')
      .select('id,slug,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,avatar_url,profile_summary,verified_at,status,contact_consent');
    query = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(identity) ? query.eq('id', identity) : query.eq('slug', identity);
    const { data: dealer, error } = await query.maybeSingle();
    if (error) throw error;
    if (!dealer || dealer.status !== 'VERIFIED') return res.status(404).json({ error: 'Verified dealer profile not found' });

    const [listingsResult, phoneResult, statsResult] = await Promise.all([
      client.from('watch_records')
      .select('id,brand,reference,dial_color,condition,price_usd,currency,raw_message,dealer_id,listing_type,listing_date,created_at,listing_status,verdict,confidence')
      .eq('dealer_id', dealer.id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .not('listing_type', 'eq', 'MULTI')
      .not('flags', 'cs', '["BUNDLE_SPLIT_REQUIRED"]')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('listing_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(50),
      client.from('dealer_source_identities')
        .select('source_identity,identity_type,verification_status')
        .eq('dealer_id', dealer.id)
        .eq('verification_status', 'VERIFIED')
        .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp'])
        .limit(1),
      client.from('verified_dealer_profile_stats')
        .select('wts_posts,wtb_posts,first_post_at,last_post_at')
        .eq('dealer_id', dealer.id)
        .maybeSingle(),
    ]);
    if (listingsResult.error) throw listingsResult.error;
    if (phoneResult.error) throw phoneResult.error;
    if (statsResult.error) throw statsResult.error;
    const listingRows = listingsResult.data || [];
    const listingIds = listingRows.map(listing => listing.id);
    const suppressedIds = await loadAnalyticsSuppressedIds(client, listingIds);
    const { data: bundleParents, error: bundleError } = listingIds.length
      ? await client.from('normalization_shadow_v4').select('source_record_id').in('source_record_id', listingIds).gt('candidate_count', 1)
      : { data: [], error: null };
    if (bundleError) throw bundleError;
    const { data: verifiedIdentities, error: identityError } = listingIds.length
      ? await client.from('listing_identity_reviews')
        .select('record_id,canonical_brand,canonical_reference,canonical_dial_color')
        .in('record_id', listingIds)
        .in('status', ['CATALOG_CONFIRMED', 'HUMAN_APPROVED'])
      : { data: [], error: null };
    if (identityError) throw identityError;
    const { data: appliedLineage, error: lineageError } = listingIds.length
      ? await client.from('seller_listing_lineage_staging')
        .select('source_record_id')
        .in('source_record_id', listingIds)
        .eq('matched_dealer_id', dealer.id)
        .eq('match_status', 'APPLIED')
      : { data: [], error: null };
    if (lineageError) throw lineageError;
    const excludedIds = new Set((bundleParents || []).map(row => row.source_record_id));
    const identityById = new Map((verifiedIdentities || []).map(row => [row.record_id, row]));
    const lineageIds = new Set((appliedLineage || []).map(row => row.source_record_id));
    const safeCandidates = listingRows.flatMap(listing => {
      const verified = identityById.get(listing.id);
      if (!verified || !lineageIds.has(listing.id) || excludedIds.has(listing.id) || suppressedIds.has(String(listing.id))) return [];
      const resolved = {
        ...listing,
        brand: verified.canonical_brand || listing.brand,
        reference: verified.canonical_reference || listing.reference,
        dial_color: verified.canonical_dial_color || listing.dial_color,
      };
      if (!isReleaseListingEligible(resolved)) return [];
      return [resolved];
    });
    const { uniqueRows } = deduplicateReposts(safeCandidates);
    const safeListings = uniqueRows.map(listing => {
      const { dealer_id: _dealerId, ...publicListing } = listing;
      return publicListing;
    });
    const verifiedPhone = phoneResult.data?.[0]?.source_identity || null;
    const stats = buildDealerStats(safeListings, dealer, verifiedPhone, statsResult.data);
    return res.status(200).json({
      success: true,
      dealer,
      stats,
      listings: safeListings,
      raw_message_access: true,
    });
  } catch (error) {
    console.error('[dealer-profile]', error.message);
    const missingSchema = /relation .* does not exist|column .* does not exist|schema cache/i.test(error.message);
    return res.status(missingSchema ? 503 : 500).json({
      error: missingSchema ? 'Dealer profiles are awaiting the production migration.' : 'Unable to load dealer profile.',
    });
  }
};

module.exports.buildDealerStats = buildDealerStats;
module.exports.mapLegacyLiveListing = mapLegacyLiveListing;
