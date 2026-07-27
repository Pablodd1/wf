'use strict';

const { getClient } = require('./_lib/supabase');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { isCustomerIdentitySafe, sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { isPublicationReferenceAllowed } = require('./_lib/publication-references.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim().slice(0, 250);
  if (!id) return res.status(400).json({ error: 'Listing id required' });

  try {
    const client = getClient();
    const strictVerifiedPublication = process.env.STRICT_VERIFIED_PUBLICATION === 'true';
    const publicTable = strictVerifiedPublication
      ? 'trading_floor_verified_listings'
      : 'trading_floor_listings';
    const { data: publicListing, error: publicError } = await client
      .from(publicTable)
      .select('id,brand,model,reference,dial_color,has_images,thumbnail_url,image_urls')
      .eq('id', id)
      .maybeSingle();
    if (publicError) throw publicError;
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });
    let verifiedListing = strictVerifiedPublication ? publicListing : null;
    if (!verifiedListing) {
      const verifiedResult = await client
        .from('trading_floor_verified_listings')
        .select('id,brand,model,reference,dial_color,has_images,thumbnail_url,image_urls')
        .eq('id', id)
        .maybeSingle();
      if (verifiedResult.error) {
        console.warn('[trading-listing] verified media unavailable; image withheld:', verifiedResult.error.message);
      } else {
        verifiedListing = verifiedResult.data;
      }
    }

    const { data, error } = await client.from('watch_records')
      .select('id,brand,reference,price_usd,price_raw,currency,dial_color,condition,year,listing_type,verdict,source,source_type,listing_date,listing_status,created_at,confidence,has_images,thumbnail_url,image_urls,region,raw_message')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    const resolvedData = verifiedListing
      ? {
          ...data,
          brand: verifiedListing.brand,
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
    if (!isPublicationReferenceAllowed(resolvedData.brand, resolvedData.reference)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    if (!isCustomerIdentitySafe(resolvedData)) return res.status(404).json({ error: 'Listing under identity review' });
    const normalized = normalizeMarketRow(resolvedData, resolvedData.reference);
    const listing = sanitizeTradingRecord(resolvedData, { verifiedImages: Boolean(verifiedListing?.has_images) });
    const priceVerified = normalized.analytics_currency_status === 'VERIFIED'
      && Number.isFinite(Number(normalized.analytics_price_usd))
      && Number(normalized.analytics_price_usd) > 0;
    listing.price_usd = priceVerified ? normalized.analytics_price_usd : null;
    listing.price_raw = null;
    listing.currency = priceVerified ? 'USD' : null;
    const priceIssues = priceVerified
      ? listing.data_quality_issues
      : [...new Set([...(listing.data_quality_issues || []), normalized.analytics_currency_status])];
    return res.status(200).json({
      success: true,
      listing: {
        id: listing.id,
        brand: listing.brand,
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
        price_evidence_status: normalized.analytics_currency_status,
        source_message_available_to_reviewers: Boolean(data.raw_message),
      },
    });
  } catch (error) {
    console.error('[trading-listing]', error.message);
    return res.status(500).json({ error: 'Unable to load source evidence' });
  }
};
