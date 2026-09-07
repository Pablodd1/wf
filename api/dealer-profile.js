'use strict';

const { getClient } = require('./_lib/supabase');
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { MIN_RELEASE_CONFIDENCE, isReleaseListingEligible } = require('./_lib/publication-references.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { loadCompletedDealerIds, profileWithLinkageState } = require('./_lib/dealer-linkage-state.cjs');

const PATEK_RAW_EVIDENCE = /\b(?:patek(?:\s+philippe)?|nautilus|aquanaut|calatrava)\b/i;
const ROLEX_ONLY_REFERENCE_FAMILY = /^69\d{3}$/;

function hasAmbiguousShorthandPrice(listing) {
  const rawMessage = String(listing?.raw_message || '');
  const match = rawMessage.match(/(?:^|[^\d])(?:USD(?:T)?\s*|\$\s*)(\d{1,3})\s*([,.])\s*(\d{1,2})(?!\d)/i);
  if (!match) return false;
  const compactMisparse = Number(`${match[1]}${match[3]}`);
  const storedPrice = Number(listing?.price_usd);
  return storedPrice > 0 && storedPrice === compactMisparse;
}

function hasCrossBrandReferenceContradiction(listing) {
  const brand = String(listing?.brand || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const reference = String(listing?.reference || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const rawMessage = String(listing?.raw_message || '');
  return brand === 'PATEKPHILIPPE'
    && ROLEX_ONLY_REFERENCE_FAMILY.test(reference)
    && !PATEK_RAW_EVIDENCE.test(rawMessage);
}

function redactPublicContactEvidence(value) {
  return redactPublicSource(value).replace(/\[(?:email|contact link|contact|handle|phone) redacted\]/g, '[contact withheld]');
}

function sanitizeDealerListing(listing) {
  const identityReviewRequired = hasCrossBrandReferenceContradiction(listing);
  const priceReviewRequired = identityReviewRequired || hasAmbiguousShorthandPrice(listing);
  return {
    ...listing,
    ...(listing?.raw_message ? { raw_message: redactPublicContactEvidence(listing.raw_message) } : {}),
    ...(identityReviewRequired ? {
      brand: null,
      model: null,
      reference: null,
      dial_color: null,
      identity_review_required: true,
      identity_review_reason: 'CROSS_BRAND_REFERENCE_CONTRADICTION',
    } : {}),
    ...(priceReviewRequired ? {
      price_usd: null,
      price_raw: null,
      display_price: null,
      price_review_required: true,
      price_review_reason: identityReviewRequired
        ? 'IDENTITY_PENDING_REVIEW'
        : 'AMBIGUOUS_SHORTHAND_PRICE',
    } : {}),
  };
}

function sanitizeDealerProfile(profile) {
  const groups = Array.isArray(profile?.groups) ? profile.groups : [];
  const groupCount = Number(profile?.stats?.group_count ?? profile?.dealer?.whatsapp_group_count ?? 0);
  return {
    ...profile,
    listings: Array.isArray(profile?.listings)
      ? profile.listings.map(sanitizeDealerListing)
      : [],
    groups,
    group_details_status: groups.length > 0
      ? 'PUBLISHED_DETAILS'
      : groupCount > 0
        ? 'COUNT_ONLY'
        : 'NO_PUBLISHED_DETAILS',
  };
}

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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const identity = String(req.query?.id || '').trim().slice(0, 160);
  if (!identity) return res.status(400).json({ error: 'Dealer id or slug required' });

  try {
    const client = getClient();
    if (process.env.VITE_USE_CANARY_V2 === 'true') {
      const limit = req.query?.pageSize === undefined ? 50 : Number(req.query.pageSize);
      let cursor = null;
      try {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error();
        if (req.query?.cursor !== undefined) {
          if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 1000) throw new Error();
          cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8'));
          if (cursor.identity !== identity || !Number.isSafeInteger(cursor.revision) || cursor.revision < 0
            || typeof cursor.after !== 'string' || !cursor.after || cursor.after.length > 250) throw new Error();
        }
      } catch { return res.status(400).json({ error: 'Invalid dealer activity page' }); }
      const { data: profile, error: profileError } = await client.rpc('get_approved_dealer_profile_v2', {
        p_identity: identity,p_limit:limit,p_after_id:cursor?.after || null,p_publication_revision:cursor?.revision ?? null,
      });
      if (profileError?.code === '22023') return res.status(409).json({ error: 'Dealer activity changed. Reload the profile.' });
      if (profileError) throw profileError;
      if (!profile?.dealer) return res.status(404).json({ error: 'Verified dealer profile not found' });
      // Reuse the directory's public field allowlist; never publish internal payloads.
      const { publicDealer } = require('./dealers');
      const safe = sanitizeDealerProfile({ ...profile, dealer: publicDealer(profile.dealer) });
      const hasMore = safe.listings.length > limit;
      safe.listings = safe.listings.slice(0, limit);
      for (const listing of safe.listings) {
        if (typeof listing.seller_name === 'string') listing.seller_name = redactPublicContactEvidence(listing.seller_name);
        listing.display_price = Number(listing.price_raw) > 0 && listing.currency
          ? `${listing.currency} ${Number(listing.price_raw).toLocaleString('en-US')}` : null;
      }
      safe.next_cursor = hasMore ? Buffer.from(JSON.stringify({identity,revision:profile.publication_revision,after:safe.listings.at(-1).id})).toString('base64url') : null;
      for (const review of safe.reviews || []) {
        if (typeof review.reviewer === 'string') review.reviewer = redactPublicContactEvidence(review.reviewer);
        if (typeof review.sentiment === 'string') review.sentiment = redactPublicContactEvidence(review.sentiment);
      }
      for (const group of safe.groups || []) {
        if (typeof group.name === 'string') group.name = redactPublicContactEvidence(group.name);
      }
      return res.status(200).json({ success: true, ...safe, raw_message_access: true,
        source_provenance: { source_system: 'WATCHFACTS_VERIFIED_DEALERS', current_counts_are_dynamic: true } });
    }
    const { data: canonicalProfile, error: canonicalError } = await client.rpc('qnsa_dealer_profile', {
      p_identity: identity,
      p_limit: 50,
      p_offset: 0,
    });
    if (!canonicalError && canonicalProfile?.dealer) {
      const completedDealerIds = await loadCompletedDealerIds(client, [canonicalProfile.dealer.id]);
      const hasCompleteLinkage = completedDealerIds.has(canonicalProfile.dealer.id);
      return res.status(200).json({
        success: true,
        ...profileWithLinkageState(sanitizeDealerProfile(canonicalProfile), hasCompleteLinkage),
        raw_message_access: true,
        source_provenance: {
          source_system: 'QNSA_CANONICAL_DEALER_DIRECTORY',
          current_counts_are_dynamic: true,
        },
      });
    }
    if (!canonicalError && !canonicalProfile?.dealer) {
      return res.status(404).json({ error: 'Verified dealer profile not found' });
    }
    if (canonicalError && !/function .*qnsa_dealer_profile.*does not exist|schema cache/i.test(canonicalError.message)) {
      throw canonicalError;
    }
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
      ...sanitizeDealerProfile({ listings: safeListings, stats, dealer }),
      raw_message_access: true,
    });
  } catch (error) {
    return res.status(503).json({ error: 'Dealer profile temporarily unavailable' });
  }
};

module.exports.buildDealerStats = buildDealerStats;
module.exports.mapLegacyLiveListing = mapLegacyLiveListing;
module.exports.hasAmbiguousShorthandPrice = hasAmbiguousShorthandPrice;
module.exports.hasCrossBrandReferenceContradiction = hasCrossBrandReferenceContradiction;
module.exports.sanitizeDealerListing = sanitizeDealerListing;
module.exports.sanitizeDealerProfile = sanitizeDealerProfile;
module.exports.redactPublicContactEvidence = redactPublicContactEvidence;
