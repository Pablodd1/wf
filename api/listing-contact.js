const { getClient } = require('./_lib/supabase');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_ZENITH_RECORD_PREFIX,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function hasOwnerApprovedPublicContact(flags) {
  return Array.isArray(flags) && flags.includes('OWNER_APPROVED_CONTACT_PUBLIC');
}

function hasApprovedPublicContact(listing) {
  return listing?.contact_publication_approved === true
    || hasOwnerApprovedPublicContact(listing?.flags);
}

function whatsappUrl(phone, listing) {
  const item = [listing.brand, listing.reference].filter(Boolean).join(' ');
  const isBuyerRequest = ['WTB', 'NTQ'].includes(String(listing.listing_type || '').toUpperCase());
  const message = encodeURIComponent(isBuyerRequest
    ? `Hello, I may be able to help with your request for ${item || 'this luxury item'} shown on Curated Luxury. Are you still looking?`
    : `Hello, I am interested in the ${item || 'luxury listing'} shown on Curated Luxury. Is it still available?`);
  return `https://wa.me/${phone}?text=${message}`;
}

async function ownerApprovedContactStats(client, sellerPhone) {
  if (!sellerPhone) return null;
  try {
    const { data: rpcData } = await client.rpc('reviewed_workbook_seller_activity', { p_phone: sellerPhone });
    const activity = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (activity && Number(activity.total_posts || 0) > 0) {
      return {
        total_posts: Number(activity.total_posts || 0),
        active_listings: Number(activity.total_posts || 0),
        wts_posts: Number(activity.wts_posts || 0),
        wtb_posts: Number(activity.wtb_posts || 0),
        first_post_at: activity.first_post_at || null,
        last_post_at: activity.last_post_at || null,
        posting_years: 0,
      };
    }
  } catch (e) {
    // proceed to watch_records
  }

  const base = () => client
    .from('watch_records')
    .select('id', { count: 'exact', head: true })
    .eq('seller_phone', sellerPhone)
    .eq('verdict', 'APPROVED')
    .gte('confidence', MIN_RELEASE_CONFIDENCE);
  const [total, wts, wtb, active] = await Promise.all([
    base(),
    base().eq('listing_type', 'WTS'),
    base().in('listing_type', ['WTB', 'NTQ']),
    base()
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(SOLD,WITHDRAWN,EXPIRED)'),
  ]);
  const error = [total, wts, wtb, active].find(result => result.error)?.error;
  if (error) {
    console.warn('[listing-contact] approved workbook activity unavailable:', error.message);
    return null;
  }
  return {
    total_posts: Number(total.count || 0),
    active_listings: Number(active.count || 0),
    wts_posts: Number(wts.count || 0),
    wtb_posts: Number(wtb.count || 0),
    first_post_at: null,
    last_post_at: null,
    posting_years: 0,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });
  const surface = String(req.query?.surface || 'trading-floor').trim().toLowerCase();
  if (!['trading-floor', 'price-research'].includes(surface)) {
    return res.status(400).json({ error: 'Valid listing surface required' });
  }

  try {
    const client = getClient();
    const publicTable = surface === 'price-research'
      ? 'price_research_verified_source'
      : 'trading_floor_verified_listings';
    const { data: strictPublicListing, error: publicError } = await client
      .from(publicTable).select('id,brand,reference').eq('id', id).maybeSingle();
    if (publicError) throw publicError;
    let publicListing = strictPublicListing;
    if (!publicListing
      && surface === 'trading-floor'
      && id.startsWith(REVIEWED_ZENITH_RECORD_PREFIX)) {
      const fallback = await client
        .from('watch_records')
        .select('id,brand,reference')
        .eq('id', id)
        .eq('source', REVIEWED_ZENITH_SOURCE)
        .eq('verdict', 'APPROVED')
        .gte('confidence', MIN_RELEASE_CONFIDENCE)
        .eq('listing_status', 'ACTIVE')
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      publicListing = fallback.data;
    }
    if (!publicListing) {
      const { data: wbListing } = await client
        .from('reviewed_workbook_inventory')
        .select('id,brand,reference,posted_by,phone_number,contact_publication_approved,listing_type')
        .eq('id', id)
        .maybeSingle();
      if (wbListing) publicListing = wbListing;
    }
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });

    let { data: listing, error: listingError } = await client
      .from('watch_records')
      .select('id,brand,reference,listing_type,dealer_id,verdict,confidence,source,seller_name,seller_phone,flags')
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .maybeSingle();
    if (!listing) {
      const { data: wbListing } = await client
        .from('reviewed_workbook_inventory')
        .select('id,brand,reference,posted_by,phone_number,contact_publication_approved,listing_type')
        .eq('id', id)
        .maybeSingle();
      if (wbListing) {
        listing = {
          id: wbListing.id,
          brand: wbListing.brand,
          reference: wbListing.reference,
          listing_type: wbListing.listing_type || 'WTS',
          seller_name: wbListing.posted_by || null,
          seller_phone: wbListing.phone_number || null,
          contact_publication_approved: wbListing.contact_publication_approved === true,
        };
      }
    }
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    const resolvedListing = {
      ...listing,
      brand: publicListing.brand || listing.brand,
      reference: publicListing.reference || listing.reference,
    };
    if (!isPublicationBrandAllowed(resolvedListing.brand)
      || !isReleaseListingEligible(resolvedListing)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    if (listing.seller_phone || listing.seller_name) {
      const contactApproved = hasApprovedPublicContact(listing);
      const approvedPhone = contactApproved ? listing.seller_phone : null;
      const phone = normalizePhone(approvedPhone);
      const dealerStats = approvedPhone ? await ownerApprovedContactStats(client, approvedPhone) : null;
      const profile = {
        dealer_name: listing.seller_name || 'Curated Luxury member',
        dealer_company: null,
        dealer_country: null,
        dealer_city: null,
        dealer_rating: null,
        dealer_review_count: 0,
        dealer_group_count: 0,
        dealer_stats: dealerStats,
        phone_display: approvedPhone || null,
        contact_source: 'WORKBOOK_SELLER_CONTACT',
      };
      return res.status(200).json({
        success: true,
        contact_available: Boolean(phone || listing.seller_name),
        ...profile,
        whatsapp_url: phone ? whatsappUrl(phone, resolvedListing) : undefined,
      });
    }
    if (!listing.dealer_id) return res.status(200).json({ success: true, contact_available: false, reason: 'DEALER_UNRESOLVED' });
    const { data: lineage, error: lineageError } = await client
      .from('seller_listing_lineage_staging')
      .select('id')
      .eq('source_record_id', listing.id)
      .eq('matched_dealer_id', listing.dealer_id)
      .eq('match_status', 'APPLIED')
      .limit(1)
      .maybeSingle();
    if (lineageError) throw lineageError;
    if (!lineage) {
      return res.status(200).json({ success: true, contact_available: false, reason: 'SELLER_LINEAGE_UNVERIFIED' });
    }

    const { data: dealer, error: dealerError } = await client
      .from('dealers').select('id,slug,display_name,company_name,country_code,city,status,contact_consent,rating,review_count,whatsapp_group_count,avatar_url,profile_summary').eq('id', listing.dealer_id).maybeSingle();
    if (dealerError) throw dealerError;
    if (!dealer || dealer.status !== 'VERIFIED') {
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_NOT_VERIFIED' });
    }

    const profile = {
      dealer_id: dealer.id,
      dealer_name: dealer.display_name || 'Verified dealer',
      dealer_company: dealer.company_name || null,
      dealer_country: dealer.country_code || null,
      dealer_city: dealer.city || null,
      dealer_avatar_url: dealer.avatar_url || null,
      dealer_profile_summary: dealer.profile_summary || null,
      dealer_profile_url: `/reference-check/${dealer.slug || dealer.id}`,
      dealer_rating: dealer.rating,
      dealer_review_count: dealer.review_count,
      dealer_group_count: dealer.whatsapp_group_count,
      // Legacy dealer_id activity is not a sufficient seller-lineage proof.
      // A future aggregate must count only APPLIED listing lineage.
      dealer_stats: null,
    };
    if (dealer.contact_consent !== true) {
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_CONSENT_NOT_GRANTED', ...profile });
    }

    const { data: identities, error: identityError } = await client
      .from('dealer_source_identities')
      .select('source_identity,identity_type,verification_status')
      .eq('dealer_id', dealer.id).eq('verification_status', 'VERIFIED')
      .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']).limit(10);
    if (identityError) throw identityError;
    const phone = (identities || []).map(item => normalizePhone(item.source_identity)).find(Boolean);
    if (!phone) return res.status(200).json({ success: true, contact_available: false, reason: 'VERIFIED_PHONE_UNAVAILABLE', ...profile });

    return res.status(200).json({
      success: true,
      contact_available: true,
      ...profile,
      phone_display: identities.find(item => normalizePhone(item.source_identity) === phone)?.source_identity || `+${phone}`,
      whatsapp_url: whatsappUrl(phone, resolvedListing),
    });
  } catch (error) {
    console.error('[listing-contact]', error.message);
    return res.status(500).json({ error: 'Unable to verify dealer contact' });
  }
};

module.exports.hasApprovedPublicContact = hasApprovedPublicContact;
