'use strict';

const { getClient } = require('./_lib/supabase');
const { listEquivalentReferences } = require('./_lib/catalog');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { isCustomerIdentitySafe, sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_ZENITH_RECORD_PREFIX,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
  isReviewedPaneraiReleaseRecord,
  isReviewedZenithIdentityCorrectionRecord,
  isReviewedZenithReleaseRecord,
} = require('./_lib/publication-references.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim().slice(0, 250);
  if (!id) return res.status(400).json({ error: 'Listing id required' });

  try {
    const client = getClient();
    // Direct customer access always requires reviewed canonical identity,
    // regardless of deployment configuration.
    const publicTable = 'trading_floor_verified_listings';
    const { data: strictTradingListing, error: publicError } = await client
      .from(publicTable)
      .select('id,brand,model,reference,dial_color,has_images,thumbnail_url,image_urls')
      .eq('id', id)
      .maybeSingle();
    if (publicError) throw publicError;
    let publicListing = strictTradingListing;
    if (!publicListing && id.startsWith(REVIEWED_ZENITH_RECORD_PREFIX)) {
      const fallback = await client
        .from('watch_records')
        .select('id,brand,model,reference,dial_color,source,verdict,confidence,listing_status')
        .eq('id', id)
        .eq('source', REVIEWED_ZENITH_SOURCE)
        .eq('verdict', 'APPROVED')
        .gte('confidence', MIN_RELEASE_CONFIDENCE)
        .eq('listing_status', 'ACTIVE')
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (fallback.data) {
        const verifiedThumbnail = await client.rpc('verified_listing_thumbnail', {
          p_record_id: id,
        });
        if (verifiedThumbnail.error) {
          console.warn('[trading-listing] verified Zenith image unavailable; image withheld:', verifiedThumbnail.error.message);
        }
        const thumbnailUrl = verifiedThumbnail.error ? null : verifiedThumbnail.data;
        publicListing = {
          ...fallback.data,
          has_images: Boolean(thumbnailUrl),
          thumbnail_url: thumbnailUrl || null,
          image_urls: thumbnailUrl ? [thumbnailUrl] : [],
        };
      }
    }
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });
    const verifiedListing = publicListing;

    const { data, error } = await client.from('watch_records')
      .select('id,brand,model,reference,price_usd,price_raw,currency,dial_color,condition,year,listing_type,verdict,source,source_type,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,image_urls,region,raw_message')
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    const resolvedData = verifiedListing
      ? {
          ...data,
          brand: verifiedListing.brand,
          model: verifiedListing.model || data.model,
          reference: verifiedListing.reference,
          dial_color: verifiedListing.dial_color,
          has_images: verifiedListing.has_images,
          thumbnail_url: verifiedListing.thumbnail_url,
          image_urls: verifiedListing.image_urls,
        }
      : data;
    if (!isPublicationBrandAllowed(resolvedData.brand)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    if (!isReleaseListingEligible(resolvedData)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    const controlledWorkbookListing = isReviewedPaneraiReleaseRecord(resolvedData)
      || isReviewedZenithReleaseRecord(resolvedData)
      || isReviewedZenithIdentityCorrectionRecord(resolvedData);
    if (!controlledWorkbookListing && !isCustomerIdentitySafe(resolvedData)) {
      return res.status(404).json({ error: 'Listing under identity review' });
    }
    const normalized = normalizeMarketRow(
      resolvedData,
      listEquivalentReferences(resolvedData.reference, resolvedData.brand),
    );
    const listing = sanitizeTradingRecord(resolvedData, { verifiedImages: Boolean(verifiedListing?.has_images) });
    const reviewedWorkbookPrice = (
      isReviewedPaneraiReleaseRecord(resolvedData)
      || isReviewedZenithReleaseRecord(resolvedData)
    )
      && Number.isFinite(Number(resolvedData.price_usd))
      && Number(resolvedData.price_usd) > 0;
    const priceVerified = reviewedWorkbookPrice || (
      normalized.analytics_currency_status === 'VERIFIED'
      && Number.isFinite(Number(normalized.analytics_price_usd))
      && Number(normalized.analytics_price_usd) > 0
    );
    listing.price_usd = priceVerified
      ? (reviewedWorkbookPrice ? Number(resolvedData.price_usd) : normalized.analytics_price_usd)
      : null;
    listing.price_raw = reviewedWorkbookPrice
      ? resolvedData.price_raw
      : normalized.source_price_amount || null;
    listing.currency = reviewedWorkbookPrice
      ? resolvedData.currency
      : priceVerified ? 'USD' : normalized.source_currency || null;
    const priceIssues = priceVerified
      ? listing.data_quality_issues
      : [...new Set([...(listing.data_quality_issues || []), normalized.analytics_currency_status])];
    return res.status(200).json({
      success: true,
      listing: {
        id: listing.id,
        brand: listing.brand,
        model: listing.model,
        reference: listing.reference,
        price_usd: listing.price_usd,
        price_raw: listing.price_raw,
        currency: listing.currency,
        dial_color: listing.dial_color,
        condition: listing.condition,
        year: listing.year,
        listing_type: listing.listing_type,
        verdict: listing.verdict,
        source: listing.source,
        source_type: listing.source_type,
        raw_message: null,
        listing_date: listing.listing_date,
        listing_status: listing.listing_status,
        created_at: listing.created_at,
        confidence: listing.confidence,
        has_images: listing.has_images,
        thumbnail_url: listing.thumbnail_url,
        image_urls: listing.image_urls,
        region: listing.region,
        data_quality_issues: priceIssues,
        data_quality_review_required: priceIssues.length > 0,
        price_evidence_status: reviewedWorkbookPrice
          ? 'HUMAN_APPROVED_WORKBOOK'
          : normalized.analytics_currency_status,
        source_message_available_to_reviewers: Boolean(data.raw_message),
      },
    });
  } catch (error) {
    console.error('[trading-listing]', error.message);
    return res.status(500).json({ error: 'Unable to load source evidence' });
  }
};
