/**
 * PRICE RESEARCH LISTING DETAIL — /api/price-research-listing?id=...
 * Loads source evidence on demand so raw dealer messages and media metadata do
 * not make the main analytics response unnecessarily large.
 */
const { getClient } = require('./_lib/supabase');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { isCustomerIdentitySafe } = require('./_lib/trading-record-safety.cjs');

async function resolveRawSource(client, listing) {
  const flags = listing.flags && !Array.isArray(listing.flags) ? listing.flags : {};
  const rawMessageId = typeof flags.raw_message_id === 'string' ? flags.raw_message_id : null;
  if (rawMessageId) {
    const { data, error } = await client
      .from('raw_messages')
      .select('id,raw_text')
      .eq('id', rawMessageId)
      .maybeSingle();
    if (!error && data?.raw_text) {
      return { text: String(data.raw_text), scope: 'original_post', lineage_id: data.id };
    }
  }
  return {
    text: String(listing.raw_message || ''),
    scope: listing.raw_message ? 'stored_source_message' : 'unavailable',
    lineage_id: null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String(req.query.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });

  try {
    const client = getClient();
    const strictVerifiedPublication = process.env.STRICT_VERIFIED_PUBLICATION === 'true';
    const sourceTable = strictVerifiedPublication
      ? 'price_research_verified_source'
      : 'watch_records';
    const columns = 'id,brand,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,dial_color,listing_type,listing_status';
    const { data, error } = await client
      .from(sourceTable)
      .select(columns)
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    if (!isCustomerIdentitySafe(data)) return res.status(404).json({ error: 'Listing under identity review' });
    const [rawSource, verifiedMediaResult] = await Promise.all([
      resolveRawSource(client, data),
      client
        .from('trading_floor_verified_listings')
        .select('has_images,image_urls,thumbnail_url')
        .eq('id', id)
        .maybeSingle(),
    ]);
    const normalized = normalizeMarketRow(
      { ...data, raw_message: rawSource.text },
      data.reference,
    );
    const redactedSource = redactPublicSource(rawSource.text).trim();
    const publicSource = redactedSource.slice(0, 12_000);
    const verifiedMedia = verifiedMediaResult.error ? null : verifiedMediaResult.data;
    const verifiedImages = Array.isArray(verifiedMedia?.image_urls)
      ? verifiedMedia.image_urls.map(value => String(value || '').trim()).filter(Boolean).slice(0, 10)
      : [];

    return res.status(200).json({
      success: true,
      listing: {
        id: data.id,
        brand: data.brand,
        reference: data.reference,
        price_usd: normalized.analytics_price_usd,
        raw_message: publicSource || null,
        raw_message_scope: publicSource ? rawSource.scope : 'unavailable',
        raw_message_truncated: redactedSource.length > publicSource.length,
        created_at: data.created_at,
        listing_date: data.listing_date,
        image_urls: verifiedImages,
        has_images: Boolean(verifiedMedia?.has_images && verifiedImages.length),
      },
    });
  } catch (error) {
    console.error('[price-research-listing] error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch listing detail' });
  }
};
