/**
 * PRICE RESEARCH LISTING DETAIL — /api/price-research-listing?id=...
 * Loads source evidence on demand so raw dealer messages and media metadata do
 * not make the main analytics response unnecessarily large.
 */
const { getClient } = require('./_lib/supabase');
const { listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { bundleCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { isCustomerIdentitySafe, sanitizeTradingRecord } = require('./_lib/trading-record-safety.cjs');
const { authClient, resolveSession, userRole } = require('./_lib/dealer-auth.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
  isReviewedZenithReleaseRecord,
} = require('./_lib/publication-references.cjs');
const { loadVerifiedListingRows } = require('./_lib/verified-listing-media.cjs');

function normalizeAccessories(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean).slice(0, 20);
  if (typeof value === 'string') return value.split(/[,;|]/).map(item => item.trim()).filter(Boolean).slice(0, 20);
  return [];
}

function listingCatalog(reference, brand) {
  let catalog = lookupCatalog(reference, brand);
  if ((!catalog?.found || !catalog.model)
    && /^\d{4}\/1A$/i.test(String(reference || ''))
    && String(brand || '').toUpperCase() === 'PATEK PHILIPPE') {
    const canonical = lookupCatalog(`${reference}-001`, brand);
    if (canonical?.found && canonical.model) catalog = canonical;
  }
  return catalog;
}

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
    let canReview = false;
    try {
      const sessionClient = authClient();
      const sessionUser = sessionClient ? await resolveSession(sessionClient, req, res) : null;
      canReview = ['admin', 'reviewer'].includes(userRole(sessionUser));
    } catch {
      // Public evidence remains available when optional reviewer resolution fails.
    }
    const strictResult = await client
      .from('price_research_verified_source')
      .select('id,brand,model,reference,dial_color')
      .eq('id', id)
      .maybeSingle();
    if (strictResult.error) throw strictResult.error;
    const strictGate = strictResult.data;
    if (!strictGate && !canReview) return res.status(404).json({ error: 'Listing not found' });
    const sourceTable = 'watch_records';
    const columns = 'id,brand,model,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,accessories,image_urls,thumbnail_url,has_images,dealer_photos,region,source_type,listing_status,confidence,verdict';
    const { data, error } = await client
      .from(sourceTable)
      .select(columns)
      .eq('id', id)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    let verifiedById = new Map();
    try {
      verifiedById = await loadVerifiedListingRows(client, [id]);
    } catch (verifiedError) {
      console.warn('[price-research-listing] verified media unavailable; image withheld:', verifiedError.message);
    }
    const verified = verifiedById.get(id);
    const canonical = strictGate || verified;
    const resolvedData = canonical
      ? {
          ...data,
          brand: canonical.brand,
          model: canonical.model || data.model,
          reference: canonical.reference,
          dial_color: canonical.dial_color,
          has_images: Boolean(verified?.has_images),
          thumbnail_url: verified?.thumbnail_url || null,
          image_urls: verified?.image_urls || [],
        }
      : data;
    if (!isPublicationBrandAllowed(resolvedData.brand) || !isReleaseListingEligible(resolvedData)) {
      return res.status(404).json({ error: 'Listing not included in this release' });
    }
    const rawSource = await resolveRawSource(client, data);
    const normalized = normalizeMarketRow(
      { ...resolvedData, raw_message: rawSource.text },
      listEquivalentReferences(resolvedData.reference, resolvedData.brand),
    );
    const shadowBundleIds = await loadShadowBundleParentIds(client, [data]);
    const eligibilityRow = {
      ...normalized,
      owner_reviewed_identity: String(resolvedData.source || '') === REVIEWED_ZENITH_SOURCE,
      price_usd: normalized.analytics_price_usd,
      bundle_candidate_count: bundleCandidateCount(data, shadowBundleIds),
    };
    const exclusionReason = classifyResearchEligibility(
      eligibilityRow,
      listingCatalog(resolvedData.reference, resolvedData.brand),
    );
    const suppressedIds = await loadAnalyticsSuppressedIds(client, [id]);
    const controlledZenithListing = isReviewedZenithReleaseRecord(resolvedData);
    const publicEligible = Boolean(strictGate)
      && (!exclusionReason || controlledZenithListing)
      && !suppressedIds.has(id)
      && (controlledZenithListing || isCustomerIdentitySafe(resolvedData));
    if (!publicEligible && !canReview) {
      return res.status(404).json({ error: 'Listing is retained for authorized human review' });
    }
    const customerListing = sanitizeTradingRecord(resolvedData, { verifiedImages: Boolean(verified?.has_images) });
    const priceVerified = normalized.analytics_currency_status === 'VERIFIED'
      && Number.isFinite(Number(normalized.analytics_price_usd))
      && Number(normalized.analytics_price_usd) > 0;
    const priceIssues = priceVerified
      ? customerListing.data_quality_issues
      : [...new Set([...(customerListing.data_quality_issues || []), normalized.analytics_currency_status])];
    const redactedSource = redactPublicSource(rawSource.text).trim();
    const publicSource = redactedSource.slice(0, 12_000);

    return res.status(200).json({
      success: true,
      listing: {
        id: customerListing.id,
        brand: customerListing.brand,
        model: customerListing.model,
        reference: customerListing.reference,
        price_raw: normalized.source_price_amount || null,
        price_usd: priceVerified ? normalized.analytics_price_usd : null,
        price_normalization: normalized.price_normalization,
        price_evidence_status: normalized.analytics_currency_status,
        currency: priceVerified ? 'USD' : normalized.source_currency || null,
        raw_message: publicSource || null,
        raw_message_scope: publicSource ? rawSource.scope : 'unavailable',
        raw_message_truncated: redactedSource.length > publicSource.length,
        source_message_available_to_reviewers: Boolean(rawSource.text),
        created_at: customerListing.created_at,
        listing_date: customerListing.listing_date,
        condition: customerListing.condition,
        source: customerListing.source,
        dial_color: customerListing.dial_color,
        year: customerListing.year,
        listing_type: customerListing.listing_type,
        accessories: normalizeAccessories(customerListing.accessories),
        image_urls: customerListing.image_urls,
        has_images: customerListing.has_images,
        region: customerListing.region,
        source_type: customerListing.source_type,
        listing_status: customerListing.listing_status,
        confidence: customerListing.confidence,
        review_exclusion_reason: canReview
          ? (suppressedIds.has(id) ? 'REVIEWED_DUPLICATE_SUPPRESSED' : exclusionReason)
          : null,
        human_review_available: canReview,
        data_quality_issues: priceIssues,
        data_quality_review_required: priceIssues.length > 0,
      },
    });
  } catch (error) {
    console.error('[price-research-listing] error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch listing detail' });
  }
};
