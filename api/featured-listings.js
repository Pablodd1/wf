/** Customer-safe featured inventory with reference-line currency proof. */
const { getClient } = require('./_lib/supabase');
const { lookupCatalog } = require('./_lib/catalog');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { isPublicationBrandAllowed, publicationBrands } = require('./_lib/publication-brands.cjs');
const { isPublicationReferenceAllowed } = require('./_lib/publication-references.cjs');
const { loadVerifiedListingRows } = require('./_lib/verified-listing-media.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const limit = Math.max(1, Math.min(Number(req.query.limit || 18), 36));
  const requestedBrand = String(req.query.brand || '').trim();
  if (requestedBrand && !isPublicationBrandAllowed(requestedBrand)) {
    return res.status(400).json({ error: 'Brand is not included in this release' });
  }
  try {
    const client = getClient();
    const reviewedImages = await client
      .from('listing_image_reviews')
      .select('record_id,reviewed_at')
      .eq('status', 'VISUALLY_VERIFIED')
      .order('reviewed_at', { ascending: false })
      .limit(500);
    if (reviewedImages.error) throw reviewedImages.error;
    const verifiedById = await loadVerifiedListingRows(
      client,
      (reviewedImages.data || []).map(row => row.record_id),
    );
    const allowedBrands = publicationBrands();
    const verifiedMedia = [...verifiedById.values()].filter(row =>
      row.has_images
      && (!requestedBrand || row.brand === requestedBrand)
      && (!allowedBrands.length || isPublicationBrandAllowed(row.brand))
      && isPublicationReferenceAllowed(row.brand, row.reference));
    if (!verifiedMedia.length) {
      return res.status(200).json({ status: 'ok', records: [], source: 'visually_verified_currency_evidence' });
    }

    const ids = verifiedMedia.map(row => row.id);
    const batches = [];
    for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
    const evidenceResults = await Promise.all(batches.map(batch => client
      .from('price_research_verified_source')
      .select('id,brand,reference,dial_color,condition,price_usd,price_raw,currency,raw_message,flags,created_at,listing_date,year,confidence,listing_type,verdict,listing_status')
      .in('id', batch)));
    const evidenceError = evidenceResults.find(result => result.error)?.error;
    if (evidenceError) throw evidenceError;
    const mediaById = new Map(verifiedMedia.map(row => [String(row.id), row]));
    const data = evidenceResults.flatMap(result => result.data || []);

    const candidates = (data || []).map(row => {
      const media = mediaById.get(String(row.id));
      const resolved = {
        ...row,
        brand: media.brand,
        reference: media.reference,
        dial_color: media.dial_color,
        has_images: media.has_images,
        thumbnail_url: media.thumbnail_url,
        image_urls: media.image_urls,
      };
      const normalized = normalizeMarketRow(resolved, resolved.reference);
      return sanitizeTradingRecord({
        ...resolved,
        price_usd: normalized.analytics_price_usd,
        analytics_currency_status: normalized.analytics_currency_status,
      }, { verifiedImages: true });
    }).filter(row => {
      const catalog = lookupCatalog(row.reference, row.brand);
      return !classifyResearchEligibility(row, catalog)
        && isPublicationReferenceAllowed(row.brand, row.reference)
        && Number(row.price_usd) >= 1000
        && Number(row.price_usd) <= 2500000
        && Number(row.confidence) >= 85
        && row.thumbnail_url;
    });
    const { uniqueRows } = deduplicateReposts(candidates);
    const records = uniqueRows.slice(0, limit).map(row => ({
      id: row.id, brand: row.brand, reference: row.reference, dial_color: row.dial_color,
      condition: row.condition, price_usd: row.price_usd, currency: row.currency,
      created_at: row.created_at, listing_date: row.listing_date, year: row.year,
      confidence: row.confidence, thumbnail_url: row.thumbnail_url, image_urls: row.image_urls,
      has_images: row.has_images, listing_type: row.listing_type, verdict: row.verdict,
    }));
    return res.status(200).json({ status: 'ok', records, source: 'visually_verified_currency_evidence' });
  } catch (error) {
    console.error('[featured-listings] error:', error.message);
    return res.status(500).json({ error: 'Featured listings are temporarily unavailable' });
  }
};
