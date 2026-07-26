const { getClient } = require('./_lib/supabase');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
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
    const { data: publicListing, error: publicError } = await client
      .from(publicTable).select('id').eq('id', id).maybeSingle();
    if (publicError) throw publicError;
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });

    const { data: listing, error: listingError } = await client
      .from('watch_records').select('id,brand,reference,listing_type,dealer_id').eq('id', id).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
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

    const { data: profileStats } = await client.from('verified_dealer_profile_stats').select('total_posts,active_listings,wts_posts,wtb_posts,first_post_at,last_post_at,posting_years').eq('dealer_id', dealer.id).maybeSingle();
    const profile = {
      dealer_id: dealer.id,
      dealer_name: dealer.display_name || 'Verified dealer',
      dealer_company: dealer.company_name || null,
      dealer_country: dealer.country_code || null,
      dealer_city: dealer.city || null,
      dealer_avatar_url: dealer.avatar_url || null,
      dealer_profile_summary: dealer.profile_summary || null,
      dealer_profile_url: `/dealers/${dealer.slug || dealer.id}`,
      dealer_rating: dealer.rating,
      dealer_review_count: dealer.review_count,
      dealer_group_count: dealer.whatsapp_group_count,
      dealer_stats: profileStats || null,
    };
    if (!dealer.contact_consent) {
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_CONSENT_REQUIRED', ...profile });
    }

    const { data: identities, error: identityError } = await client
      .from('dealer_source_identities')
      .select('source_identity,identity_type,verification_status')
      .eq('dealer_id', dealer.id).eq('verification_status', 'VERIFIED')
      .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']).limit(10);
    if (identityError) throw identityError;
    const phone = (identities || []).map(item => normalizePhone(item.source_identity)).find(Boolean);
    if (!phone) return res.status(200).json({ success: true, contact_available: false, reason: 'VERIFIED_PHONE_UNAVAILABLE', ...profile });

    const item = [listing.brand, listing.reference].filter(Boolean).join(' ');
    const isBuyerRequest = ['WTB', 'NTQ'].includes(String(listing.listing_type || '').toUpperCase());
    const message = encodeURIComponent(isBuyerRequest
      ? `Hello, I may be able to help with your request for ${item || 'this luxury item'} shown on Curated Luxury. Are you still looking?`
      : `Hello, I am interested in the ${item || 'luxury listing'} shown on Curated Luxury. Is it still available?`);
    return res.status(200).json({
      success: true,
      contact_available: true,
      ...profile,
      whatsapp_url: `https://wa.me/${phone}?text=${message}`,
    });
  } catch (error) {
    console.error('[listing-contact]', error.message);
    return res.status(500).json({ error: 'Unable to verify dealer contact' });
  }
};
