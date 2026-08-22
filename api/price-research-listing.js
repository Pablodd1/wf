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
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_SOURCE,
  isReleaseListingEligible,
  isReviewedPaneraiReleaseRecord,
  isReviewedZenithIdentityCorrectionRecord,
  isReviewedZenithReleaseRecord,
} = require('./_lib/publication-references.cjs');
const { loadVerifiedListingRows } = require('./_lib/verified-listing-media.cjs');
const { publicImageProvenance } = require('./_lib/public-image-provenance.cjs');
const { loadReviewedWorkbookListing } = require('./_lib/reviewed-workbook-analytics.cjs');
const { ROLEX_PATEK_MULTI_PARENT_ID } = require('./_lib/rolex-patek-reviewed-overlay.cjs');
const { loadEffectiveDetail } = require('./_lib/four-brand-field-enrichment.cjs');
const {
  applyConfirmedFiveWatchPublication,
  frozenFiveDefinition,
} = require('./_lib/five-watch-publication.cjs');

const QNSA_PRICE_RESEARCH_SOURCE = 'qnsa_rolex_patek_price_research_source';

function isMissingQnsaDetailSource(error) {
  return /42P01|PGRST205|relation .* does not exist|could not find the table/i
    .test(`${error?.code || ''} ${error?.message || error || ''}`);
}

function isTradingFloorOnlyReviewedListingId(id) {
  return String(id || '') === ROLEX_PATEK_MULTI_PARENT_ID;
}

async function loadQnsaReleaseListing(client, id) {
  const { data, error } = await client
    .from(QNSA_PRICE_RESEARCH_SOURCE)
    // The reviewed source is a versioned public contract. Selecting the row
    // avoids coupling this endpoint to optional projection columns added by
    // individual release migrations while the response mapper remains
    // deliberately allow-listed below.
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error && isMissingQnsaDetailSource(error)) return null;
  if (error) throw error;
  return data || null;
}

function qnsaListingResponse(listing) {
  const imageUrls = Array.isArray(listing.image_urls)
    ? listing.image_urls.filter(Boolean)
    : [listing.thumbnail_url].filter(Boolean);
  const rawMessage = String(listing.raw_message || '').trim();
  return {
    success: true,
    listing: {
      id: String(listing.id),
      brand: listing.brand,
      model: listing.model || null,
      reference: listing.reference,
      dial_color: listing.dial_color || null,
      condition: listing.condition || null,
      price_raw: listing.price_raw == null ? null : Number(listing.price_raw),
      price_usd: listing.price_usd == null ? null : Number(listing.price_usd),
      price_evidence_status: listing.price_evidence_status
        || (Number(listing.price_usd) > 0 ? 'VERIFIED' : 'PRICE_NOT_VERIFIED'),
      currency: listing.currency || null,
      source_price_amount: listing.source_price_amount ?? listing.price_raw ?? null,
      source_currency: listing.source_currency ?? listing.currency ?? null,
      source_price_text: listing.source_price_text || null,
      original_price_amount: listing.original_price_amount ?? listing.source_price_amount ?? listing.price_raw ?? null,
      original_currency: listing.original_currency ?? listing.source_currency ?? listing.currency ?? null,
      price_confirmation_note: listing.price_confirmation_note || null,
      confirmed_data_publication: listing.confirmed_data_publication || null,
      raw_message: rawMessage || null,
      raw_message_scope: rawMessage ? 'original_post' : 'unavailable',
      raw_message_truncated: false,
      source_message_available_to_reviewers: Boolean(rawMessage),
      created_at: listing.created_at,
      listing_date: listing.listing_date || listing.created_at,
      source: listing.source || 'MARIADB_IMMUTABLE_RAW',
      source_type: 'qnsa_reviewed_release',
      listing_type: listing.listing_type || 'WTS',
      listing_status: listing.listing_status || null,
      confidence: listing.confidence == null ? null : Number(listing.confidence),
      accessories: [],
      image_urls: imageUrls,
      thumbnail_url: imageUrls[0] || null,
      has_images: listing.has_images === true && imageUrls.length > 0,
      image_evidence_type: listing.has_images === true && imageUrls.length > 0 ? 'SOURCE_LISTING_IMAGE' : 'NO_IMAGE',
      image_evidence_label: listing.has_images === true && imageUrls.length > 0 ? 'Source-supplied listing image' : null,
      image_evidence_notice: listing.has_images === true && imageUrls.length > 0
        ? 'Exact image retained with this immutable source listing.'
        : null,
      image_provenance: listing.has_images === true && imageUrls.length > 0 ? 'source_supplied' : 'none',
      region: listing.location || null,
      data_quality_issues: [],
      data_quality_review_required: false,
    },
  };
}

function effectiveDetailListing(row) {
  const imageUrl = row.has_exact_source_image === true ? row.user_image_url : null;
  const publicRawMessage = redactPublicSource(row.raw_message).trim();
  return {
    id: row.id,
    brand: row.canonical_brand,
    model: row.model,
    reference: row.normalized_reference,
    dial_color: row.dial_color,
    condition: row.condition,
    price_raw: row.source_price_amount,
    price_usd: row.price_usd,
    price_evidence_status: row.price_evidence_status,
    currency: row.source_currency,
    raw_message: publicRawMessage || null,
    created_at: row.posting_date,
    listing_date: row.posting_date,
    source: row.source_file || 'MARIADB_IMMUTABLE_RAW',
    source_type: 'qnsa_four_brand_effective_release',
    listing_type: row.listing_type,
    listing_status: row.trading_floor_status,
    confidence: row.confidence,
    thumbnail_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    has_images: Boolean(imageUrl),
    location: row.location,
  };
}

async function loadFrozenVacheronDetail(client, id) {
  const definition = frozenFiveDefinition(id);
  if (!definition || definition.brand !== 'Vacheron Constantin') return null;
  const { data, error } = await client.rpc('qnsa_vacheron_overseas_reference_rows', {
    p_reference: definition.reference,
    p_limit: 101,
    p_offset: 0,
    p_listing_type: null,
  });
  if (error) throw error;
  const row = (data || []).map(value => value?.row_data || value)
    .find(value => String(value?.id) === String(id));
  return row ? effectiveDetailListing(row) : null;
}

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
  if (isTradingFloorOnlyReviewedListingId(id)) {
    return res.status(404).json({ error: 'Listing is Trading Floor only' });
  }

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
    let effectiveDetail = null;
    try {
      effectiveDetail = await loadEffectiveDetail(client, id);
    } catch (effectiveDetailError) {
      console.warn('[price-research-listing] four-brand exact detail unavailable; preserving legacy detail path:', effectiveDetailError.message);
    }
    if (effectiveDetail?.fourBrandScope) {
      if (!effectiveDetail.row) return res.status(404).json({ error: 'Listing not found' });
      return res.status(200).json(qnsaListingResponse(
        applyConfirmedFiveWatchPublication(effectiveDetailListing(effectiveDetail.row)),
      ));
    }
    const frozenVacheronDetail = await loadFrozenVacheronDetail(client, id);
    if (frozenVacheronDetail) {
      return res.status(200).json(qnsaListingResponse(
        applyConfirmedFiveWatchPublication(frozenVacheronDetail),
      ));
    }
    let qnsaListing = null;
    try {
      qnsaListing = await loadQnsaReleaseListing(client, id);
    } catch (qnsaDetailError) {
      console.warn('[price-research-listing] QNSA detail source unavailable; checking legacy release sources:', qnsaDetailError.message);
    }
    if (qnsaListing) return res.status(200).json(qnsaListingResponse(qnsaListing));

    const strictResult = await client
      .from('price_research_verified_source')
      .select('id,brand,model,reference,dial_color')
      .eq('id', id)
      .maybeSingle();
    if (strictResult.error) throw strictResult.error;
    const strictGate = strictResult.data;
    if (!strictGate) {
      const workbookListing = await loadReviewedWorkbookListing(client, id);
      if (workbookListing) {
        const publicSource = redactPublicSource(workbookListing.raw_message).trim();
        const workbookImageProvenance = publicImageProvenance(workbookListing);
        const workbookHasPublicSourceImage = [
          'SELLER_LISTING_IMAGE',
          'SOURCE_LISTING_IMAGE',
          'SOURCE_LINKED_IMAGE',
        ].includes(String(workbookImageProvenance.image_evidence_type || '').toUpperCase());
        const workbookImageUrls = workbookHasPublicSourceImage
          ? [...new Set([
              workbookListing.thumbnail_url,
              ...(workbookListing.image_urls || []),
            ].filter(Boolean))]
          : [];
        const workbookThumbnailUrl = workbookImageUrls[0] || null;
        let dialColor = workbookListing.dial_color;
        if ((!dialColor || dialColor === 'UNKNOWN') && workbookHasPublicSourceImage && workbookThumbnailUrl) {
          const imageUrl = workbookThumbnailUrl;
          try {
            const { resolveDialWithVisionFallback } = require('./_lib/dial-normalization.cjs');
            const visionResolved = await resolveDialWithVisionFallback({
              sourceDial: dialColor,
              rawText: publicSource,
              imageUrl,
              textReference: workbookListing.reference,
              textBrand: workbookListing.brand,
            });
            if (visionResolved?.value) dialColor = visionResolved.value;
          } catch (e) {
            console.warn('[price-research-listing] vision fallback error:', e.message);
          }
        }
        return res.status(200).json({
          success: true,
          listing: {
            id: workbookListing.id,
            brand: workbookListing.brand,
            model: workbookListing.model,
            reference: workbookListing.reference,
            dial_color: dialColor,
            condition: workbookListing.condition,
            price_raw: workbookListing.source_price_amount,
            price_usd: workbookListing.price_usd,
            price_evidence_status: workbookListing.price_evidence_status || 'PRICE_NOT_SUPPLIED',
            currency: workbookListing.source_currency || null,
            raw_message: publicSource || null,
            raw_message_scope: publicSource ? 'reviewed_workbook_source' : 'unavailable',
            raw_message_truncated: false,
            source_message_available_to_reviewers: Boolean(workbookListing.raw_message),
            created_at: workbookListing.created_at,
            listing_date: workbookListing.listing_date,
            source: workbookListing.source,
            source_type: workbookListing.source_type,
            listing_type: workbookListing.listing_type,
            seller_name: workbookListing.seller_name || null,
            listing_status: workbookListing.listing_status,
            confidence: workbookListing.confidence,
            image_urls: workbookImageUrls,
            thumbnail_url: workbookThumbnailUrl,
            has_images: workbookImageUrls.length > 0,
            ...workbookImageProvenance,
            image_provenance: workbookHasPublicSourceImage ? 'source_supplied' : 'none',
            data_quality_issues: [],
            data_quality_review_required: false,
            human_review_available: canReview,
          },
        });
      }
      if (!canReview) return res.status(404).json({ error: 'Listing not found' });
    }
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
    let verified = verifiedById.get(id);
    if (!verified?.has_images && isReviewedZenithReleaseRecord(data)) {
      const verifiedThumbnail = await client.rpc('verified_listing_thumbnail', {
        p_record_id: id,
      });
      if (verifiedThumbnail.error) {
        console.warn('[price-research-listing] reviewed Zenith image unavailable; image withheld:', verifiedThumbnail.error.message);
      } else if (verifiedThumbnail.data) {
        verified = {
          id,
          brand: strictGate?.brand || data.brand,
          model: strictGate?.model || data.model,
          reference: strictGate?.reference || data.reference,
          dial_color: strictGate?.dial_color || data.dial_color,
          has_images: true,
          thumbnail_url: verifiedThumbnail.data,
          image_urls: [verifiedThumbnail.data],
        };
      }
    }
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
      owner_reviewed_identity: [REVIEWED_PANERAI_SOURCE, REVIEWED_ZENITH_SOURCE]
        .includes(String(resolvedData.source || '')),
      price_usd: normalized.analytics_price_usd,
      bundle_candidate_count: bundleCandidateCount(data, shadowBundleIds),
    };
    const exclusionReason = classifyResearchEligibility(
      eligibilityRow,
      listingCatalog(resolvedData.reference, resolvedData.brand),
    );
    const suppressedIds = await loadAnalyticsSuppressedIds(client, [id]);
    const controlledWorkbookListing = isReviewedPaneraiReleaseRecord(resolvedData)
      || isReviewedZenithReleaseRecord(resolvedData)
      || isReviewedZenithIdentityCorrectionRecord(resolvedData);
    const publicEligible = Boolean(strictGate)
      && (!exclusionReason || controlledWorkbookListing)
      && !suppressedIds.has(id)
      && (controlledWorkbookListing || isCustomerIdentitySafe(resolvedData));
    if (!publicEligible && !canReview) {
      return res.status(404).json({ error: 'Listing is retained for authorized human review' });
    }
    const customerListing = sanitizeTradingRecord(resolvedData, { verifiedImages: Boolean(verified?.has_images) });
    const priceVerified = normalized.analytics_currency_status === 'VERIFIED'
      && Number.isFinite(Number(normalized.analytics_price_usd))
      && Number(normalized.analytics_price_usd) > 0;
    const priceIssues = priceVerified
      ? (customerListing.data_quality_issues || [])
      : [...new Set([...(customerListing.data_quality_issues || []), normalized.analytics_currency_status])];
    const redactedSource = redactPublicSource(rawSource.text).trim();
    const publicSource = redactedSource;
    let dialColor = customerListing.dial_color;
    if ((!dialColor || dialColor === 'UNKNOWN') && (customerListing.has_images || customerListing.image_urls?.length)) {
      const imageUrl = customerListing.thumbnail_url || customerListing.image_urls?.[0];
      try {
        const { resolveDialWithVisionFallback } = require('./_lib/dial-normalization.cjs');
        const visionResolved = await resolveDialWithVisionFallback({
          sourceDial: dialColor,
          rawText: publicSource,
          imageUrl,
          textReference: customerListing.reference,
          textBrand: customerListing.brand,
        });
        if (visionResolved?.value) dialColor = visionResolved.value;
      } catch (e) {
        console.warn('[price-research-listing] vision fallback error:', e.message);
      }
    }

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
        raw_message_truncated: false,
        source_message_available_to_reviewers: Boolean(rawSource.text),
        created_at: customerListing.created_at,
        listing_date: customerListing.listing_date,
        condition: customerListing.condition,
        source: customerListing.source,
        dial_color: dialColor,
        year: customerListing.year,
        listing_type: customerListing.listing_type,
        accessories: normalizeAccessories(customerListing.accessories),
        image_urls: customerListing.image_urls,
        has_images: customerListing.has_images,
        ...publicImageProvenance(customerListing),
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

module.exports.isTradingFloorOnlyReviewedListingId = isTradingFloorOnlyReviewedListingId;
module.exports.effectiveDetailListing = effectiveDetailListing;
module.exports.loadFrozenVacheronDetail = loadFrozenVacheronDetail;
