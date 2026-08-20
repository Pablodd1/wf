/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved)
 */
const { getClient } = require('./_lib/supabase');
const { normRef, inferBrand: sharedInferBrand } = require('./_lib/resolve');
const { listEquivalentReferences, lookupCatalog, listCatalogReferences } = require('./_lib/catalog');
const {
  buildComparableCohorts,
  buildDialGroups,
  classifyPrice,
  marketPlausibilityFloor,
  summarizePrices,
} = require('./_lib/market-stats.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { normalizeDialValue } = require('./_lib/dial-normalization.cjs');
const { normalizeWatchConditionFields } = require('./_lib/watch-condition-normalization.cjs');
const {
  HUMAN_REVIEW_VERDICTS,
  classifyDemandItemEligibility,
  classifyDemandEligibility,
  classifyResearchEligibility,
  classifySaleEvidenceEligibility,
  isHumanReviewAnalyticsCandidate,
} = require('./_lib/price-research-eligibility.cjs');
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { partitionExcludedEvidence } = require('./_lib/exclusion-summary.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { bundleCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');
const { buildIndicativeForecast, buildMarketForecast } = require('./_lib/market-forecast.cjs');
const { selectDialGroup } = require('./_lib/dial-cohort-selection.cjs');
const { buildWtsReconciliation } = require('./_lib/price-research-reconciliation.cjs');
const {
  loadReviewedWorkbookEvidenceRows,
  loadRolexPatekOverlayEvidenceRows,
} = require('./_lib/reviewed-workbook-analytics.cjs');
const { mergeByExactLineage } = require('./_lib/rolex-patek-reviewed-overlay.cjs');
const { loadVerifiedDemandIdentityRows } = require('./_lib/verified-demand-identity.cjs');
const { applyEffectivePrice } = require('./_lib/corrected-price-source.cjs');
const { recoverRecordPrices } = require('./_lib/runtime-price-recovery.cjs');
const { enrichRowsWithExactDealerEvidence } = require('./_lib/listing-dealer-evidence.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
// ponytail: authorizeDealer no longer gates this public endpoint (see handler
// below). Import removed — dealer-auth.cjs is still used by other endpoints.
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_REFERENCES,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
  isReviewedPaneraiReleaseRecord,
  isReviewedReleaseReference,
  isReviewedZenithIdentityCorrectionRecord,
} = require('./_lib/publication-references.cjs');

const DEMAND_SAMPLE_LIMIT = 2500;
const QNSA_PRICE_RESEARCH_SOURCE = 'qnsa_rolex_patek_price_research_source';
const QNSA_WTB_DEMAND_SOURCE = 'qnsa_rolex_patek_wtb_demand_source';
const QNSA_TRADING_SOURCE = 'qnsa_rolex_patek_trading_floor_source';
function isMissingRpcError(error) {
  return /PGRST202|42883|could not find the function|does not exist/i
    .test(`${error?.code || ''} ${error?.message || error || ''}`);
}

async function loadQnsaPriceRpcRows(client, args) {
  const brand = String(args?.p_brand || '').trim().toLowerCase();
  if (brand === 'vacheron constantin') {
    const references = [...new Set(args?.p_references || [])].filter(Boolean).slice(0, 8);
    const pages = await Promise.all(references.map(reference => client.rpc(
      'qnsa_vacheron_overseas_reference_rows', {
        p_reference: reference,
        p_limit: Math.min(101, Math.max(1, Number(args?.p_limit) || 101)),
        p_offset: 0,
        p_listing_type: args?.p_listing_type || null,
      },
    )));
    const failed = pages.find(page => page.error);
    if (failed) return failed;
    const data = pages.flatMap(page => page.data || []).map(qnsaReferenceRowToMarketRow);
    return { data: [...new Map(data.map(row => [String(row.id), row])).values()], error: null };
  }
  const usesBoundedReviewedSource = ['richard mille', 'cartier', 'zenith'].includes(brand);
  // The correction sidecar is intentionally three-brand scoped. Later brands
  // use the reviewed bounded source; an empty sidecar result is not evidence
  // that their cohort is empty.
  let result = usesBoundedReviewedSource
    ? await client.rpc('qnsa_bounded_price_research_rows', args)
    : await client.rpc('qnsa_three_brand_fx_price_research_rows', args);
  if (result.error && isMissingRpcError(result.error)) {
    result = await client.rpc('qnsa_bounded_price_research_rows', args);
  }
  return result;
}

function configuredReviewedPriceSource(brand) {
  const requested = String(process.env.PRICE_RESEARCH_SOURCE_VIEW || '').trim();
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  return requested === QNSA_PRICE_RESEARCH_SOURCE
    && ['rolex', 'patek philippe', 'audemars piguet', 'richard mille', 'cartier', 'zenith', 'vacheron constantin'].includes(normalizedBrand)
    ? QNSA_PRICE_RESEARCH_SOURCE
    : null;
}

function qnsaReferenceRowToMarketRow(row) {
  const source = row?.row_data || row || {};
  const contactApproved = source.contact_publication_approved === true;
  const correctedWatchFields = normalizeWatchConditionFields({
    dial_color: source.dial_color || source.catalog_dial,
    condition: source.condition,
    raw_message: source.raw_message,
  });
  return {
    id: source.id,
    brand: source.canonical_brand || source.brand_scope,
    model: source.catalog_model || source.model,
    reference: source.normalized_reference || source.catalog_reference,
    dial_color: correctedWatchFields.dial_color,
    condition: correctedWatchFields.condition,
    listing_type: source.listing_type,
    verdict: source.verdict || source.verification_status,
    confidence: source.confidence,
    raw_message: source.raw_message,
    dealer_id: source.dealer_id,
    source: source.source_file || 'MARIADB_IMMUTABLE_RAW',
    seller_name: source.seller_name,
    seller_phone: contactApproved ? (source.seller_phone || null) : null,
    price_raw: source.source_price_amount,
    price_usd: source.has_verified_usd_price === true
      ? (source.verified_price_usd || source.workbook_price_usd)
      : null,
    currency: source.source_currency,
    source_price_amount: source.source_price_amount,
    source_currency: source.source_currency,
    created_at: source.posting_date || source.imported_at,
    listing_date: source.posting_date || source.imported_at,
    listing_status: source.trading_floor_status,
    thumbnail_url: source.user_image_url,
    image_urls: source.user_image_url ? [source.user_image_url] : [],
    has_images: source.has_exact_source_image === true,
    owner_reviewed_identity: true,
    contact_publication_approved: contactApproved,
  };
}

function consentApprovedPhone(row) {
  if (row?.contact_publication_approved !== true) return null;
  return row.seller_phone || row.phone_number || null;
}

function isPendingQnsaBrandRelease(brand) {
  const requested = String(process.env.PRICE_RESEARCH_SOURCE_VIEW || '').trim();
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  return requested === QNSA_PRICE_RESEARCH_SOURCE
    && ['panerai', 'omega'].includes(normalizedBrand);
}

function unwrapQnsaJsonEnvelope(data, functionName) {
  if (Array.isArray(data) && data.length === 1 && data[0]?.[functionName]) {
    return data[0][functionName];
  }
  return data;
}

async function loadZenithReviewedTradingRows(client, { referenceVariants, limit }) {
  const referenceKeys = new Set((referenceVariants || []).map(normRef).filter(Boolean));
  if (!referenceKeys.size) return [];

  const recovered = [];
  let offset = 0;
  const maximumPages = 10; // Zenith's released customer lane is currently under 500 rows.
  for (let page = 0; page < maximumPages && recovered.length < limit; page += 1) {
    const { data, error } = await client.rpc('qnsa_later_brand_candidate_stride_page', {
      p_brand: 'Zenith',
      p_offset: offset,
      p_limit: 50,
      p_listing_type: 'WTS',
    });
    if (error) {
      console.warn('[price-research] Zenith bounded release scan unavailable:', error.message || error);
      return [];
    }
    const envelope = unwrapQnsaJsonEnvelope(data, 'qnsa_later_brand_candidate_stride_page') || {};
    const pageRows = Array.isArray(envelope.rows) ? envelope.rows : [];
    for (const rawRow of pageRows) {
      const row = qnsaReferenceRowToMarketRow(rawRow);
      if (String(row.listing_type || '').toUpperCase() !== 'WTS') continue;
      if (!referenceKeys.has(normRef(row.reference))) continue;
      recovered.push(row);
      if (recovered.length >= limit) break;
    }
    const nextOffset = Number(envelope.next_offset);
    if (envelope.has_more !== true || !Number.isFinite(nextOffset) || nextOffset <= offset) break;
    offset = nextOffset;
  }
  return [...new Map(recovered.map(row => [String(row.id), row])).values()];
}

const exactReleasedEvidenceCache = new Map();
const EXACT_EVIDENCE_CACHE_TTL_MS = 30_000;
const EXACT_REFERENCE_RPC_PAGE_SIZE = 101;

async function loadQnsaExactReleasedEvidence(client, { brand, referenceVariants, limit = 1000 }) {
  const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 1000));
  const references = [...new Set(referenceVariants || [])].filter(Boolean).slice(0, 8);
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const cacheKey = `${normalizedBrand}|${references.slice().sort().join('|')}|${boundedLimit}`;
  const now = Date.now();
  const cached = exactReleasedEvidenceCache.get(cacheKey);
  if (cached && now - cached.createdAt < EXACT_EVIDENCE_CACHE_TTL_MS) return cached.value;

  const promise = (async () => {
    const recovered = new Map();
    let capped = false;
    for (const reference of references) {
      let offset = 0;
      const maximumPages = Math.ceil(boundedLimit / EXACT_REFERENCE_RPC_PAGE_SIZE) + 1;
      for (let page = 0; page < maximumPages; page += 1) {
        const zenith = normalizedBrand === 'zenith';
        const vacheron = normalizedBrand === 'vacheron constantin';
        const { data, error } = await client.rpc(
          vacheron ? 'qnsa_vacheron_overseas_reference_rows'
            : (zenith ? 'qnsa_zenith_reference_rows' : 'qnsa_trading_floor_reference_rows'),
          vacheron ? {
            p_reference: reference,
            p_limit: EXACT_REFERENCE_RPC_PAGE_SIZE,
            p_offset: offset,
            p_listing_type: null,
          } :
          zenith ? {
            p_reference: reference,
            p_limit: EXACT_REFERENCE_RPC_PAGE_SIZE,
            p_offset: offset,
            p_listing_type: null,
          } : {
            p_brand: brand,
            p_reference: reference,
            p_family: false,
            p_limit: EXACT_REFERENCE_RPC_PAGE_SIZE,
            p_offset: offset,
          },
        );
        if (error) throw error;
        const pageRows = (data || []).map(qnsaReferenceRowToMarketRow).filter(row => row.id);
        for (const row of pageRows) {
          recovered.set(String(row.id), row);
          if (recovered.size >= boundedLimit) {
            capped = true;
            break;
          }
        }
        if (capped || pageRows.length < EXACT_REFERENCE_RPC_PAGE_SIZE) break;
        offset += pageRows.length;
      }
      if (capped) break;
    }
    return { rows: [...recovered.values()], capped };
  })();
  exactReleasedEvidenceCache.set(cacheKey, { createdAt: now, value: promise });
  if (exactReleasedEvidenceCache.size > 50) {
    const oldestKey = exactReleasedEvidenceCache.keys().next().value;
    exactReleasedEvidenceCache.delete(oldestKey);
  }
  try {
    return await promise;
  } catch (error) {
    exactReleasedEvidenceCache.delete(cacheKey);
    throw error;
  }
}

function directSubmissionToMarketRow(row) {
  const claimed = row?.claimed_fields || {};
  const intent = String(row?.intent || '').trim().toUpperCase();
  const category = String(row?.category || '').trim().toUpperCase();
  const currency = String(claimed.currency || '').trim().toUpperCase() || null;
  const amount = Number(claimed.price_usd ?? claimed.price_amount);
  const verifiedUsd = Number.isFinite(amount) && amount > 0 && ['USD', 'USDT'].includes(currency);
  const imageUrls = Array.isArray(row?.image_urls) ? row.image_urls.filter(Boolean) : [];
  const isBundle = claimed.is_bundle === true;
  const contactApproved = claimed.contact_publication_approved === true;
  const correctedWatchFields = normalizeWatchConditionFields({
    dial_color: claimed.dial_color,
    condition: claimed.condition,
    raw_message: row.raw_message,
  });
  if (category !== 'WATCH'
    || !['WTS', 'WTB'].includes(intent)
    || row?.review_status !== 'APPROVED'
    || row?.publication_status !== 'PUBLISHED'
    || claimed.catalog_confirmed !== true
    || !claimed.brand
    || !claimed.reference) return null;
  return {
    id: `direct:${row.id}`,
    source_submission_id: row.id,
    brand: claimed.brand,
    model: claimed.model || null,
    reference: claimed.reference,
    dial_color: correctedWatchFields.dial_color,
    condition: correctedWatchFields.condition,
    listing_type: intent,
    verdict: 'APPROVED',
    confidence: 100,
    raw_message: row.raw_message,
    dealer_id: row.dealer_id,
    source: 'AUTHENTICATED_DIRECT_SUBMISSION',
    seller_name: claimed.poster_name || null,
    seller_phone: contactApproved ? (claimed.poster_phone || null) : null,
    price_raw: claimed.price_amount ?? null,
    price_usd: intent === 'WTS' && verifiedUsd ? amount : null,
    currency,
    source_price_amount: claimed.price_amount ?? null,
    source_currency: currency,
    created_at: row.created_at,
    listing_date: row.created_at,
    listing_status: 'published',
    thumbnail_url: !isBundle ? imageUrls[0] || null : null,
    image_urls: !isBundle ? imageUrls : [],
    has_images: !isBundle && imageUrls.length > 0,
    owner_reviewed_identity: true,
    contact_publication_approved: contactApproved,
    flags: isBundle ? ['BUNDLE_SPLIT_REQUIRED'] : [],
    bundle_candidate_count: isBundle ? 2 : 1,
    analytics_currency_status: verifiedUsd ? 'VERIFIED' : 'UNVERIFIED',
  };
}

async function loadApprovedDirectSubmissionRows(client, { brand, referenceVariants, intent, limit = 1000 }) {
  try {
    const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const { data, error } = await client.from('dealer_listing_submissions')
      .select('id,dealer_id,intent,category,raw_message,claimed_fields,image_urls,review_status,publication_status,created_at')
      .eq('review_status', 'APPROVED')
      .eq('publication_status', 'PUBLISHED')
      .eq('category', 'WATCH')
      .eq('intent', intent)
      .order('created_at', { ascending: false })
      .limit(boundedLimit);
    if (error) throw error;
    const brandKey = String(brand || '').trim().toLowerCase();
    const referenceKeys = new Set((referenceVariants || []).map(normRef));
    const rows = (data || [])
      .map(directSubmissionToMarketRow)
      .filter(Boolean)
      .filter(row => String(row.brand || '').trim().toLowerCase() === brandKey
        && referenceKeys.has(normRef(row.reference)));
    rows.sampleCapped = (data || []).length >= boundedLimit;
    return rows;
  } catch (error) {
    console.warn('[price-research] approved direct submissions unavailable:', error?.message || error);
    return [];
  }
}

async function loadRuntimePriceRecoveryRows(client, { brand, referenceVariants }) {
  if (!['richard mille', 'cartier'].includes(String(brand || '').trim().toLowerCase())) return [];
  let exactEvidence;
  try {
    exactEvidence = await loadQnsaExactReleasedEvidence(client, {
      brand, referenceVariants, limit: 1000,
    });
  } catch (error) {
    console.warn('[price-research] runtime source-price recovery unavailable:', error.message || error);
    return [];
  }
  const candidates = exactEvidence.rows
    .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS');
  return (await recoverRecordPrices(candidates))
    .filter(row => row.runtime_price_recovery_applied === true && Number(row.price_usd) > 0);
}

function sourceAlreadySuppressesDuplicates(sourceTable) {
  return sourceTable === 'price_research_verified_source'
    || sourceTable === QNSA_PRICE_RESEARCH_SOURCE;
}

function reviewedFamilyPrefix(brand, reference) {
  const normalizedBrand = String(brand || '').trim().toLowerCase();
  const normalizedReference = normRef(reference);
  if (normalizedBrand === 'rolex' && normalizedReference === '116500') return '116500';
  if (normalizedBrand === 'patek philippe' && normalizedReference === '5712') return '5712';
  return null;
}

async function loadQnsaVerifiedTradingPrices(client, {
  brand,
  referenceVariants,
  familyPrefix,
  limit,
}) {
  let rpcMarketRows = [];
  let exactReleasedRows = [];
  if (!familyPrefix) {
    const { data: rpcRows, error: rpcError } = await loadQnsaPriceRpcRows(client, {
      p_brand: brand,
      p_references: referenceVariants,
      p_listing_type: 'WTS',
      p_limit: limit,
    });
    if (!rpcError && (rpcRows || []).length) rpcMarketRows = (rpcRows || []).map(row => {
      const effective = applyEffectivePrice(row);
      return effective.price_correction_applied
        ? { ...effective, price_usd: effective.verified_price_usd }
        : row;
    });
    // Reconcile Price Research to the same released exact-reference cohort shown
    // on the Trading Floor. The priced RPC is intentionally narrower; retained
    // no-price or incomplete evidence remains visible but is rejected by the
    // downstream analytics eligibility gate.
    try {
      const exactEvidence = await loadQnsaExactReleasedEvidence(client, { brand, referenceVariants, limit });
      exactReleasedRows = exactEvidence.rows
        .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS')
        .map(row => ({ ...row, exact_evidence_recovery_capped: exactEvidence.capped }));
    } catch (error) {
      console.warn('[price-research] exact Trading evidence recovery unavailable:', error.message || error);
    }
    if (!rpcError && exactReleasedRows.length === 0 && String(brand || '').trim().toLowerCase() === 'zenith') {
      const scannedRows = await loadZenithReviewedTradingRows(client, { referenceVariants, limit });
      if (scannedRows.length) exactReleasedRows = scannedRows;
    }
    if (rpcError) {
      console.warn('[price-research] bounded QNSA WTS RPC unavailable; using release fallback:', rpcError.message || rpcError);
    }
  }
  if (String(brand || '').trim().toLowerCase() === 'vacheron constantin') {
    const merged = new Map(exactReleasedRows.map(row => [String(row.id), row]));
    for (const row of rpcMarketRows) merged.set(String(row.id), row);
    return [...merged.values()].map(row => ({
      ...row,
      canonical_qnsa_price_evidence_checked: true,
    }));
  }
  // The dedicated research view is the primary source. This bounded fallback
  // uses the same reconciled release base when PostgREST has not refreshed that
  // view yet. Only rows already marked as verified USD evidence are admitted;
  // no-price, ambiguous-currency, WTB, bundle, and suppressed rows remain out.
  const baseColumns = [
    'id,canonical_brand,catalog_model,normalized_reference,source_price_amount',
    'verified_price_usd,source_currency,raw_message,posting_date,condition',
    'dial_color,listing_type,dealer_id,seller_name,seller_phone,confidence',
    'verdict,trading_floor_status,user_image_url,has_exact_source_image,has_verified_usd_price',
  ].join(',');
  const columns = [
    baseColumns,
    'corrected_price_usd,corrected_source_amount,corrected_source_currency,corrected_fx_rate',
    'corrected_fx_source,corrected_fx_date,price_correction_status,price_correction_id,price_correction_key',
  ].join(',');
  const execute = selectedColumns => {
    let query = client
      .from(QNSA_TRADING_SOURCE)
      .select(selectedColumns)
      .eq('brand_scope', brand)
      .eq('listing_type', 'WTS')
      // The effective view promotes only qualified sidecar corrections into
      // Load the complete released exact-reference cohort. Price eligibility is
      // decided downstream so genuine no-price and incomplete rows remain
      // visible as excluded evidence without entering averages.
      ;
    query = familyPrefix
      ? query.like('normalized_reference', `${familyPrefix}%`)
      : query.in('normalized_reference', referenceVariants);
    return query.limit(limit);
  };
  let { data, error } = await execute(columns);
  if (error && /42703|does not exist/i.test(`${error.code || ''} ${error.message || error}`)) {
    ({ data, error } = await execute(baseColumns));
  }
  if (error) {
    if (rpcMarketRows.length) return rpcMarketRows.map(row => ({
      ...row,
      canonical_qnsa_price_evidence_checked: true,
    }));
    throw error;
  }
  const releasedRows = (data || [])
    .map(applyEffectivePrice)
    .map(row => ({
    id: row.id,
    brand: row.canonical_brand,
    model: row.catalog_model,
    reference: row.normalized_reference,
    price_raw: row.effective_source_amount,
    price_usd: row.has_verified_usd_price === true && Number(row.verified_price_usd) > 0
      ? row.verified_price_usd
      : null,
    currency: row.effective_source_currency,
    source_price_amount: row.effective_source_amount,
    source_currency: row.effective_source_currency,
    raw_message: row.raw_message,
    flags: [],
    created_at: row.posting_date,
    listing_date: row.posting_date,
    condition: row.condition,
    source: 'MARIADB_IMMUTABLE_RAW',
    effective_price_source: row.effective_price_source,
    price_correction_applied: row.price_correction_applied === true,
    price_correction_id: row.price_correction_id,
    price_correction_key: row.price_correction_key,
    analytics_fx_rate: row.effective_fx_rate,
    analytics_fx_source: row.effective_fx_source,
    analytics_fx_date: row.effective_fx_date,
    dial_color: row.dial_color,
    year: null,
    listing_type: row.listing_type,
    dealer_id: row.dealer_id,
    seller_name: row.seller_name,
    seller_phone: consentApprovedPhone(row),
    contact_publication_approved: row.contact_publication_approved === true,
    confidence: row.confidence,
    verdict: row.verdict,
    listing_status: row.trading_floor_status,
    thumbnail_url: row.user_image_url,
    image_urls: row.user_image_url ? [row.user_image_url] : [],
    has_images: row.has_exact_source_image === true,
  }));
  const mergedRows = new Map(releasedRows.map(row => [String(row.id), row]));
  for (const row of exactReleasedRows) mergedRows.set(String(row.id), row);
  for (const row of rpcMarketRows) mergedRows.set(String(row.id), row);
  // This loader is the canonical bounded QNSA price boundary. A positive
  // price has already passed its verified-USD/correction contract; a null
  // price intentionally failed that contract. Preserve that decision so the
  // downstream presentation endpoint cannot reinterpret a bare "$" in a Hong
  // Kong message as USD and silently turn HKD 42,000 into USD 42,000.
  return [...mergedRows.values()].map(row => ({
    ...row,
    canonical_qnsa_price_evidence_checked: true,
  }));
}

async function loadQnsaTradingDemand(client, {
  brand,
  referenceVariants,
  familyPrefix,
  limit,
}) {
  let rpcDemandRows = [];
  if (!familyPrefix) {
    const { data: rpcRows, error: rpcError } = await loadQnsaPriceRpcRows(client, {
      p_brand: brand,
      p_references: referenceVariants,
      p_listing_type: 'WTB',
      p_limit: limit,
    });
    if (!rpcError) rpcDemandRows = rpcRows || [];
    else console.warn('[price-research] bounded QNSA WTB RPC unavailable; using release fallback:', rpcError.message || rpcError);
    let recovered = [];
    try {
      const exactEvidence = await loadQnsaExactReleasedEvidence(client, { brand, referenceVariants, limit });
      recovered = exactEvidence.rows
        .filter(row => String(row.listing_type || '').toUpperCase() === 'WTB')
        .map(row => ({ ...row, exact_evidence_recovery_capped: exactEvidence.capped }));
    } catch (error) {
      console.warn('[price-research] exact Trading demand recovery unavailable:', error.message || error);
    }
    if (recovered.length || rpcDemandRows.length) {
      const merged = new Map(recovered.map(row => [String(row.id), row]));
      for (const row of rpcDemandRows) merged.set(String(row.id), row);
      return [...merged.values()];
    }
  }
  const columns = [
    'id,canonical_brand,catalog_model,normalized_reference,source_price_amount',
    'workbook_price_usd,source_currency,raw_message,posting_date,condition',
    'dial_color,listing_type,dealer_id,seller_name,seller_phone,confidence',
    'verdict,trading_floor_status,user_image_url,has_exact_source_image',
  ].join(',');
  let query = client
    .from(QNSA_TRADING_SOURCE)
    .select(columns)
    .eq('brand_scope', brand)
    .eq('listing_type', 'WTB');
  query = familyPrefix
    ? query.like('normalized_reference', `${familyPrefix}%`)
    : query.in('normalized_reference', referenceVariants);
  // The view already has a selective exact-reference boundary. Sorting the
  // layered projection in Postgres forced a large temporary sort and crossed
  // the production statement timeout for 5164A. Dates remain on every row and
  // repost selection is deterministic downstream.
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    brand: row.canonical_brand,
    model: row.catalog_model,
    reference: row.normalized_reference,
    dial_color: row.dial_color,
    condition: row.condition,
    listing_type: row.listing_type,
    verdict: row.verdict,
    confidence: row.confidence,
    raw_message: row.raw_message,
    dealer_id: row.dealer_id,
    source: 'MARIADB_IMMUTABLE_RAW',
    seller_name: row.seller_name,
    seller_phone: consentApprovedPhone(row),
    contact_publication_approved: row.contact_publication_approved === true,
    thumbnail_url: row.user_image_url,
    image_urls: row.user_image_url ? [row.user_image_url] : [],
    has_images: row.has_exact_source_image === true,
    price_raw: row.source_price_amount,
    price_usd: row.workbook_price_usd,
    currency: row.source_currency,
    created_at: row.posting_date,
    listing_date: row.posting_date,
    listing_status: row.trading_floor_status,
    owner_reviewed_identity: true,
  }));
}

// Look up a human model name for a reference from the PROVEN file catalog
// (catalog.json + enriched_refs.json via _lib/catalog.js) — same path used live
// by /api/catalog-lookup. The Supabase cached_price_guide_watches table is empty
// for most brands, so we do NOT use it. Decoration only — never affects existence.
function lookupModel(reference, brand) {
  try {
    const hit = lookupCatalog(reference, brand || null);
    return hit && hit.found ? (hit.model || null) : null;
  } catch { return null; }
}

// Pull real liquidity indicators for a reference. Wrapped in try/catch because
// market_reference_indicators_current has never been queried by live code — if
// column names differ, we fall back to a live-derived count. REAL DATA ONLY:
// no invented seller/buyer numbers.
function matchesSelection(row, selection) {
  const dial = String(row.dial_color || '').trim().toLowerCase();
  return Boolean(dial) && (!selection.dial || dial === String(selection.dial).toLowerCase());
}

async function lookupLiquidity(client, reference, listingCount, demand, selection) {
  // Reference-level indicators are not valid evidence for a dial
  // selection. Use scoped live counts instead of displaying stale aggregates.
  if (selection?.dial) {
    return { source: 'live_fallback', listing_count: listingCount, ...demand };
  }
  try {
    const { data, error } = await client
      .from('market_reference_indicators_current')
      .select('liquidity_score, sale_count, search_count, demand_score, supply_score, wtb_fs_ratio')
      .eq('normalized_reference', normRef(reference))
      .eq('region', 'global')
      .limit(1);
    if (!error && data && data.length) {
      const d = data[0];
      return {
        source: 'indicators',
        liquidity_score: d.liquidity_score,
        sale_count: d.sale_count,
        search_count: d.search_count,
        demand_score: d.demand_score,
        supply_score: d.supply_score,
        wtb_fs_ratio: d.wtb_fs_ratio,
        listing_count: listingCount,
        ...demand,
      };
    }
  } catch { /* fall through to live count */ }
  return { source: 'live_fallback', listing_count: listingCount, ...demand };
}

function isOwnerReviewedWorkbookRow(row) {
  return row?.owner_reviewed_identity === true
    || isReviewedPaneraiReleaseRecord(row) || (
    String(row?.brand || '').trim().toLowerCase() === 'zenith'
      && String(row?.source || '') === REVIEWED_ZENITH_SOURCE
  ) || isReviewedZenithIdentityCorrectionRecord(row);
}

function isPriceResearchAdmissionCandidate(row) {
  return isReleaseListingEligible(row) || isHumanReviewAnalyticsCandidate(row);
}

function paginateEvidenceRows(rows, page, pageSize) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safePage = Math.max(1, Number.parseInt(String(page || '1'), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || '1'), 10) || 1));
  const offset = (safePage - 1) * safePageSize;
  return {
    rows: safeRows.slice(offset, offset + safePageSize),
    page: safePage,
    page_size: safePageSize,
    pages: Math.max(1, Math.ceil(safeRows.length / safePageSize)),
    total: safeRows.length,
  };
}

function isCustomerPricedSaleEvidence(row) {
  return classifySaleEvidenceEligibility(row) === null;
}

function serializePriceProvenance(row) {
  return {
    source_price_amount: row.source_price_amount ?? row.price_raw ?? null,
    source_currency: row.source_currency || row.currency || null,
    price_evidence_status: row.price_evidence_status || row.analytics_currency_status || null,
    effective_price_source: row.effective_price_source || null,
    fx_rate: row.analytics_fx_rate || null,
    fx_source: row.analytics_fx_source || null,
    fx_date: row.analytics_fx_date || null,
  };
}

async function lookupDemand(client, sourceTable, brand, referenceVariants, catalog, selection, preloadedRows = null, familyPrefix = null, pagination = {}, overlayRows = []) {
  // ponytail: admit all demand-side records. classifyDemandEligibility
  // handles per-row quality downstream.
  let data;
  let demandSampleCapped = false;
  if (Array.isArray(preloadedRows)) {
    data = preloadedRows.filter(row => ['WTB', 'NTQ'].includes(String(row.listing_type || '').toUpperCase()));
    demandSampleCapped = preloadedRows.sampleCapped === true;
  } else if (sourceTable === QNSA_PRICE_RESEARCH_SOURCE) {
    try {
      data = await loadQnsaTradingDemand(client, {
        brand,
        referenceVariants,
        familyPrefix,
        limit: DEMAND_SAMPLE_LIMIT,
      });
    } catch (qnsaDemandError) {
      console.warn('[price-research] QNSA WTB demand unavailable:', qnsaDemandError.message || qnsaDemandError);
      return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
    }
    demandSampleCapped = data.length >= DEMAND_SAMPLE_LIMIT;
  } else {
    // Select only physical watch_records columns. phone_number, posted_by,
    // image_url, and display_image_url are view aliases and make PostgREST
    // reject the entire base-table request when selected here.
    const columns = 'id,brand,model,reference,dial_color,condition,listing_type,verdict,confidence,raw_message,flags,dealer_id,source,seller_name,seller_phone,thumbnail_url,image_urls,has_images,price_raw,price_usd,currency,created_at,listing_date,listing_status';
    try {
      const verifiedDemand = await loadVerifiedDemandIdentityRows(client, {
        brand,
        referenceVariants,
        limit: DEMAND_SAMPLE_LIMIT,
        watchColumns: columns,
      });
      data = verifiedDemand.rows;
      demandSampleCapped = verifiedDemand.sampleCapped;
    } catch (error) {
      console.warn('[price-research] verified WTB demand unavailable:', error?.message || error);
      return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
    }
  }

  const qnsaReviewedSource = sourceTable === QNSA_PRICE_RESEARCH_SOURCE;
  const directDemandRows = await loadApprovedDirectSubmissionRows(client, {
    brand, referenceVariants, intent: 'WTB', limit: DEMAND_SAMPLE_LIMIT,
  });
  if (directDemandRows.length) {
    const merged = new Map((data || []).map(row => [String(row.id), row]));
    for (const row of directDemandRows) merged.set(String(row.id), row);
    data = [...merged.values()];
  }
  if (overlayRows.length) {
    data = mergeByExactLineage(data || [], overlayRows).rows;
  }
  let demandRows = (data || [])
    .map(row => ({ ...row, ...normalizeWatchConditionFields(row) }))
    .filter(row => qnsaReviewedSource || isOwnerReviewedWorkbookRow(row));
  const equivalentKeys = new Set(referenceVariants.map(normRef));
  demandRows = demandRows.filter(row =>
    (qnsaReviewedSource || isOwnerReviewedWorkbookRow(row) || isReleaseListingEligible(row))
    &&
    String(row.brand || '').toLowerCase() === String(brand || '').toLowerCase()
    && (familyPrefix
      ? normRef(row.reference).startsWith(normRef(familyPrefix))
      : equivalentKeys.has(normRef(row.reference))));
  let suppressedIds;
  try {
    suppressedIds = sourceAlreadySuppressesDuplicates(sourceTable)
      ? new Set()
      : await loadAnalyticsSuppressedIds(client, demandRows.map(row => row.id));
  } catch {
    return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
  }
  demandRows = demandRows.filter(row => !suppressedIds.has(String(row.id)));
  const shadowBundleIds = sourceAlreadySuppressesDuplicates(sourceTable)
    ? new Set()
    : await loadShadowBundleParentIds(client, demandRows);
  const demandItemExclusions = demandRows
    .map(row => ({ row, reason: classifyDemandItemEligibility(row) }))
    .filter(item => item.reason);
  const eligibleBeforeReposts = demandRows
    .map(row => ({ ...row, bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds) }))
    .map(row => ({ ...row, owner_reviewed_identity: qnsaReviewedSource || isOwnerReviewedWorkbookRow(row) }))
    .filter(row => !classifyDemandEligibility(row, catalog));
  const { uniqueRows: eligible, repostRows } = deduplicateReposts(eligibleBeforeReposts);
  const grouped = new Map();
  for (const row of eligible.filter(row => matchesSelection({
    ...row,
    dial_color: normalizeDialValue(row.dial_color).known ? normalizeDialValue(row.dial_color).value : '',
  }, selection))) {
    const normalizedDial = normalizeDialValue(row.dial_color);
    const dial = normalizedDial.known ? normalizedDial.value : '';
    const key = dial.toLowerCase();
    if (!key) continue;
    const current = grouped.get(key) || { dial_color: dial, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  // Retain all WTB cohorts regardless of observation count (1+ or 2+ observations)
  const demandCohorts = [...grouped.values()]
    .filter(cohort => cohort.count >= 1)
    .sort((a, b) => b.count - a.count);

  const demandPage = Math.max(1, Number.parseInt(String(pagination.page || '1'), 10) || 1);
  const demandPageSize = Math.min(100, Math.max(12, Number.parseInt(String(pagination.pageSize || '24'), 10) || 24));
  const demandEvidencePage = paginateEvidenceRows(eligible, demandPage, demandPageSize);
  const demandRowsWithDealerEvidence = await enrichRowsWithExactDealerEvidence(client, demandEvidencePage.rows);
  const demandRowsSerialized = demandRowsWithDealerEvidence
    .map(row => {
    const contactApproved = row.contact_publication_approved === true;
    const phone = consentApprovedPhone(row);
    const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, '') : '';
    const whatsappUrl = phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
    const imgCandidate = row.thumbnail_url || row.image_url || row.display_image_url || (Array.isArray(row.image_urls) ? row.image_urls[0] : null) || null;
    return {
      id: String(row.id),
      brand: row.brand,
      model: row.model || null,
      reference: row.reference,
      dial_color: row.dial_color || null,
      condition: row.condition || null,
      listing_type: row.listing_type || 'WTB',
      raw_message: row.raw_message ? redactPublicSource(row.raw_message) : null,
      seller_name: row.seller_name || row.posted_by || null,
      seller_phone: phone,
      whatsapp_url: whatsappUrl,
      contact_publication_approved: contactApproved,
      image_url: imgCandidate,
      image_urls: Array.isArray(row.image_urls) ? row.image_urls : (imgCandidate ? [imgCandidate] : []),
      has_images: Boolean(row.has_images || imgCandidate),
      created_at: row.created_at || row.listing_date || null,
      listing_date: row.listing_date || row.created_at || null,
      price_usd: row.price_usd || null,
      price_raw: row.price_raw || row.source_price_amount || null,
      currency: row.currency || row.source_currency || null,
      dealer_id: row.dealer_id || null,
      dealer_profile_path: row.dealer_profile_path || null,
      seller_rating: row.seller_rating ?? null,
      seller_review_count: row.seller_review_count ?? null,
      seller_rating_evidence_status: row.seller_rating_evidence_status || null,
      seller_group_count: row.seller_group_count ?? null,
    };
    });

  return {
    demand_count: eligible.length,
    demand_cohorts: demandCohorts,
    demand_rows: demandRowsSerialized,
    demand_page: demandEvidencePage.page,
    demand_page_size: demandEvidencePage.page_size,
    demand_pages: demandEvidencePage.pages,
    demand_returned: demandRowsSerialized.length,
    demand_sample_capped: demandSampleCapped,
    demand_repost_count: repostRows.length,
    demand_suppressed_duplicate_count: suppressedIds.size,
    demand_non_watch_excluded_count: demandItemExclusions.length,
    demand_non_watch_excluded_breakdown: demandItemExclusions.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {}),
  };
}

function inferBrand(ref) {
  return sharedInferBrand(ref);
}

async function inferReleasedWorkbookBrand(reference) {
  const client = getClient();
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,reference,source,verdict,confidence,listing_status')
    .in('brand', ['Panerai', 'Zenith'])
    .ilike('reference', reference)
    .limit(20);
  if (error) throw error;
  const brands = [...new Set((data || [])
    .filter(isReleaseListingEligible)
    .map(row => String(row.brand || '').trim())
    .filter(Boolean))];
  return brands.length === 1 ? brands[0] : '';
}

function summarizeComparableRows(rows) {
  const validPrices = rows
    .map(row => Number(row.price_usd))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const marketPriceFloorUsd = marketPlausibilityFloor(validPrices);
  const summary = summarizePrices(validPrices.filter(value => value >= marketPriceFloorUsd));
  return { marketPriceFloorUsd, summary };
}

function normalizeAnalyticsPriceRow(row, {
  usingReviewedWorkbook = false,
  usingQnsaReviewedSource = false,
  referenceVariants = [],
} = {}) {
  const conditionCorrectedRow = { ...row, ...normalizeWatchConditionFields(row) };
  const canonicalQnsaEvidence = usingQnsaReviewedSource
    && row.canonical_qnsa_price_evidence_checked === true;
  const canonicalPrice = Number(row.price_usd);
  if (usingReviewedWorkbook || row.price_correction_applied === true || row.runtime_price_recovery_applied === true) {
    const reviewedCurrencyStatus = usingReviewedWorkbook
      ? (row.analytics_currency_status || 'CURRENCY_UNVERIFIED')
      : 'VERIFIED';
    return {
      ...conditionCorrectedRow,
      analytics_price_usd: row.price_usd,
      price_normalization: row.price_correction_applied
        ? 'QUALIFIED_SIDECAR_CORRECTION'
        : row.runtime_price_recovery_applied
          ? 'DATED_RUNTIME_SOURCE_RECOVERY'
          : null,
      analytics_currency_status: reviewedCurrencyStatus,
    };
  }
  if (canonicalQnsaEvidence) {
    const verifiedPrice = Number.isFinite(canonicalPrice) && canonicalPrice > 0 ? canonicalPrice : null;
    return {
      ...conditionCorrectedRow,
      analytics_price_usd: verifiedPrice,
      price_normalization: verifiedPrice ? 'CANONICAL_QNSA_VERIFIED_USD' : null,
      analytics_currency_status: verifiedPrice ? 'VERIFIED' : 'MISSING_PRICE',
    };
  }
  return normalizeMarketRow(conditionCorrectedRow, referenceVariants);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  // ponytail: Price Research is intentionally public (see commits adaa4e9,
  // 0b92aa3, 0e51450 on 2026-08-01 — "remove DealerGate from Price Research,
  // now public/free access, no login required"). A later same-day merge
  // (c1f6490, bundled into an unrelated MariaDB ingest commit) accidentally
  // reintroduced this auth gate, breaking reference drill-down for every
  // unauthenticated visitor (401 surfaced as a broken page on click).
  // Outlier/graphics/liquidity evidence is customer-facing analytics, not an
  // admin-only review surface.
  const canReviewExcludedEvidence = true;

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();
  const evidencePage = Math.max(1, Number.parseInt(String(req.query.evidencePage || '1'), 10) || 1);
  const evidencePageSize = Math.min(100, Math.max(25, Number.parseInt(String(req.query.evidencePageSize || '100'), 10) || 100));
  const demandPage = Math.max(1, Number.parseInt(String(req.query.demandPage || '1'), 10) || 1);
  const demandPageSize = Math.min(100, Math.max(12, Number.parseInt(String(req.query.demandPageSize || '24'), 10) || 24));

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand if not provided
  if (!brand) {
    brand = inferBrand(rawRef);
    if (!brand) {
      try {
        brand = await inferReleasedWorkbookBrand(rawRef);
      } catch {
        // The customer can still select a brand from the bounded browse flow.
      }
    }
    if (!brand) {
      return res.status(400).json({
        error: 'Brand could not be identified for this reference. Select a brand and reference from Browse by Model.',
        hint: 'Brand auto-resolution failed. Provide the brand explicitly.'
      });
    }
  }
  const familyPrefix = reviewedFamilyPrefix(brand, rawRef);
  // Approved single-item workbook evidence may authorize its exact
  // brand/reference even when an older deployment allowlist has not yet been
  // expanded. Price qualification remains a separate downstream gate.
  const client = getClient();
  const configuredSourceTable = configuredReviewedPriceSource(brand);
  if (isPendingQnsaBrandRelease(brand)) {
    return res.status(404).json({
      error: 'Brand is not included in this release',
      release_status: 'PENDING_CANARY',
    });
  }
  const preloadReferences = [...new Set([rawRef, ...listEquivalentReferences(rawRef, brand)])];
  let preloadedReviewedWorkbookEvidenceRows = [];
  if (!configuredSourceTable) {
    try {
      preloadedReviewedWorkbookEvidenceRows = await loadReviewedWorkbookEvidenceRows(client, {
        brand,
        references: preloadReferences,
        limit: 10000,
      });
    } catch {
      // The legacy release gates below remain fail-closed when the reviewed view
      // is temporarily unavailable.
    }
  }
  const preloadedReviewedWorkbookRows = preloadedReviewedWorkbookEvidenceRows
    .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS');
  const exactReviewedWorkbookRelease = preloadedReviewedWorkbookEvidenceRows.length > 0;
  if (!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationBrandAllowed(brand)) {
    return res.status(404).json({ error: 'Brand is not included in this release' });
  }
  if (!configuredSourceTable && !exactReviewedWorkbookRelease && !isPublicationReferenceAllowed(brand, rawRef)) {
    return res.status(404).json({ error: 'Reference is not included in this release' });
  }

  try {
    const controlledPaneraiRelease = brand.toLowerCase() === 'panerai';
    const requestedCatalogHit = lookupCatalog(rawRef, brand || null);
    const exactCatalogReference = Boolean(
      requestedCatalogHit?.found
      && requestedCatalogHit.matchType !== 'partial'
      && requestedCatalogHit.reference
    );
    const exactReviewedReleaseReference = isReviewedReleaseReference(brand, rawRef);
    const exactKnownReference = exactCatalogReference || exactReviewedReleaseReference;
    const directWatchRecordBrand = ['rolex', 'patek philippe', 'audemars piguet', 'richard mille', 'cartier', 'zenith']
      .includes(brand.toLowerCase());
    // Reviewed workbooks remain first. When an exact catalog reference has no
    // workbook cohort, query the bounded approved watch-record lane directly;
    // the legacy release view is not needed to rediscover an identity already
    // proven by the catalog. Partial references never enter this path.
    let sourceTable = configuredSourceTable || (!exactReviewedWorkbookRelease
      && exactKnownReference
      && directWatchRecordBrand
      ? 'watch_records'
      : 'price_research_verified_source');

    // Resolve exact stored spellings only. Prefix matches are suggestions for
    // an explicit customer choice; they must never silently become a specific
    // full reference (for example 5711 -> 5711/110P-001).
    let targetRef = rawRef;
    let referenceVariants = [rawRef];
    if (controlledPaneraiRelease) {
      const exactReleaseReference = REVIEWED_PANERAI_REFERENCES.find(reference =>
        normRef(reference) === normRef(rawRef));
      if (exactReleaseReference) {
        targetRef = exactReleaseReference;
        referenceVariants = [exactReleaseReference];
      }
    } else if (rawRef.length >= 3) {
      // Resolve exact references case-insensitively first. Historical imports
      // contain casing variants (for example 116500LN and 116500ln); keep all
      // equivalent stored spellings so the market query aggregates them.
      const equivalentReferences = [...new Set([rawRef, ...listEquivalentReferences(rawRef, brand)])];
      referenceVariants = equivalentReferences;
      if (exactReviewedWorkbookRelease) {
        // The indexed reviewed-workbook preload already proves the exact
        // normalized reference. Re-querying the legacy release view here made
        // every successful request pay for an unrelated multi-million-row
        // lookup before returning the workbook evidence.
        const equivalentKeys = new Set(equivalentReferences.map(normRef));
        const exactVariants = [...new Set(preloadedReviewedWorkbookEvidenceRows
          .map(row => row.reference)
          .filter(reference => equivalentKeys.has(normRef(reference))))];
        const exact = exactVariants[0] || rawRef;
        const catalogHit = lookupCatalog(rawRef, brand || null);
        targetRef = catalogHit?.found && catalogHit.matchType !== 'partial' && catalogHit.reference
          ? catalogHit.reference
          : exact;
        referenceVariants = [...new Set([...equivalentReferences, ...exactVariants])];
      } else if (exactKnownReference) {
        targetRef = exactCatalogReference ? requestedCatalogHit.reference : rawRef;
        referenceVariants = [...new Set([
          ...equivalentReferences,
          targetRef,
        ])];
      } else {
        const exactRefResults = await Promise.all(equivalentReferences.map(reference => client
          .from(sourceTable)
          .select('reference')
          .eq('brand', brand)
          .ilike('reference', reference)
          .limit(50)));
        const exactRefError = exactRefResults.every(result => result.error)
          ? exactRefResults.find(result => result.error)?.error || null
          : null;
        const exactRefs = exactRefResults
          .filter(result => !result.error)
          .flatMap(result => result.data || []);

        let refs = exactRefs;
        let refError = exactRefError;
        if (!exactRefError && (!exactRefs || exactRefs.length === 0)) {
          // Prefix matches remain suggestions only. The catalog fallback may
          // decorate those suggestions, but it never auto-selects one.
          const prefixResult = await client
            .from(sourceTable)
            .select('reference')
            .eq('brand', brand)
            .ilike('reference', `${rawRef}%`)
            .limit(50);
          refs = prefixResult.data;
          refError = prefixResult.error;
          if ((!refs || refs.length === 0) && !refError) {
            try {
              const catalogRefs = listCatalogReferences(brand)
                .filter(e => e.reference && e.reference.toUpperCase().startsWith(rawRef.toUpperCase()))
                .map(e => e.reference);
              refs = [...new Set(catalogRefs)].map(r => ({ reference: r }));
            } catch { /* catalog unavailable, keep refs as-is */ }
          }
        }

        if (!refError && refs && refs.length > 0) {
          const foundRefs = [...new Set(refs.map(r => r.reference))];
          const equivalentKeys = new Set(equivalentReferences.map(normRef));
          const exactVariants = foundRefs.filter(r => equivalentKeys.has(normRef(r)));
          const exact = exactVariants[0];
          if (exact) {
            const catalogHit = lookupCatalog(rawRef, brand || null);
            targetRef = catalogHit?.found && catalogHit.matchType !== 'partial' && catalogHit.reference
              ? catalogHit.reference
              : exact;
            referenceVariants = [...new Set([...equivalentReferences, ...exactVariants])];
          }
          else {
            return res.status(400).json({
              error: 'Enter an exact reference. Prefix matches require an explicit selection.',
              suggestions: foundRefs.slice(0, 20),
            });
          }
        }
      }
    }

    // PostgREST caps each response at 1,000 rows. Keep the customer request to
    // one bounded, indexed page. Ten concurrent offset pages overloaded the
    // multi-million-row legacy table for high-volume Rolex references.
    const pageSize = 1000;
    const sampleLimit = 10000;
    const columns = 'id,brand,model,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,dealer_id,seller_name,seller_phone,confidence,verdict,listing_status,thumbnail_url,image_urls,has_images';
    // ponytail: admit all records for analytics. classifyResearchEligibility
    // applies per-row quality gates downstream (missing price/brand/dial,
    // catalog mismatch, reference-as-price). Pre-filtering on verdict/confidence
    // was silently dropping 100% of the dataset — every record is "Human Review"
    // confidence 30, and none will reach APPROVED/90+ without batch processing.
    //
    // ponytail: keep query simple — .in('reference') + .eq('brand') is
    // indexed; avoid .or() on unindexed listing_status + double-order that
    // forces full scans on the multi-million-row table.
    const buildRowsQuery = table => {
      let query = client
        .from(table)
        .select(columns)
        .eq('brand', brand)
        .eq('listing_type', 'WTS');
      query = table === QNSA_PRICE_RESEARCH_SOURCE && familyPrefix
        ? query.like('reference', `${familyPrefix}%`)
        : query.in('reference', referenceVariants);
      if (table !== QNSA_PRICE_RESEARCH_SOURCE) {
        query = query.in('verdict', ['APPROVED', 'approved', ...HUMAN_REVIEW_VERDICTS]);
      }
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(pageSize);
    };

    // Avoid a filtered COUNT and high-offset scans over the multi-million-row
    // table. Report the bounded sample honestly when it reaches its source cap.
    let rows;
    if (controlledPaneraiRelease) {
      const { data, error } = await client
        .from(sourceTable)
        .select(columns)
        .in('id', REVIEWED_PANERAI_RECORD_IDS)
        .eq('brand', 'Panerai')
        .eq('source', REVIEWED_PANERAI_SOURCE)
        .in('reference', referenceVariants)
        .eq('verdict', 'APPROVED')
        .gte('confidence', MIN_RELEASE_CONFIDENCE)
        .eq('listing_type', 'WTS');
      if (error) throw error;
      rows = data || [];
    } else if (preloadedReviewedWorkbookRows.length) {
      // Do not query the legacy view for rows that the strict workbook preload
      // has already returned. The same immutable rows are used downstream.
      rows = preloadedReviewedWorkbookRows;
    } else if (sourceTable === QNSA_PRICE_RESEARCH_SOURCE) {
      // The dedicated analytics view performs raw-message reference checks and
      // several joins. After the reconciled two-brand release grew, Postgres
      // could time out planning/executing that view for high-volume references.
      // The Trading release base already enforces the same immutable lineage,
      // single-item, duplicate, release-control and verified-price boundaries.
      // Query its indexed brand/reference projection directly and preserve the
      // downstream eligibility/outlier gates below.
      rows = await loadQnsaVerifiedTradingPrices(client, {
        brand,
        referenceVariants,
        familyPrefix,
        limit: pageSize,
      });
    } else {
      let result = await buildRowsQuery(sourceTable);
      if (!configuredSourceTable && (result.error || !(result.data || []).length)) {
        sourceTable = 'watch_records';
        result = await buildRowsQuery(sourceTable);
      }
      if (result.error) throw result.error;
      rows = result.data || [];
      if (sourceTable === QNSA_PRICE_RESEARCH_SOURCE && rows.length === 0) {
        rows = await loadQnsaVerifiedTradingPrices(client, {
          brand,
          referenceVariants,
          familyPrefix,
          limit: pageSize,
        });
      }
    }
    if (sourceTable === QNSA_PRICE_RESEARCH_SOURCE
      && ['richard mille', 'cartier'].includes(String(brand || '').trim().toLowerCase())) {
      const recoveredRows = await loadRuntimePriceRecoveryRows(client, { brand, referenceVariants });
      const rowsById = new Map((rows || []).map(row => [String(row.id), row]));
      for (const row of recoveredRows) rowsById.set(String(row.id), row);
      rows = [...rowsById.values()];
    }
    // Post-cutoff owner-reviewed Rolex/Patek rows are an additive overlay. They
    // supplement the existing QNSA cohort and never select a replacement feed.
    // Exact lineage keys are the only cross-source deduplication boundary;
    // same-reference offers from different dealers/messages remain separate.
    let rolexPatekOverlayRows = [];
    try {
      rolexPatekOverlayRows = await loadRolexPatekOverlayEvidenceRows(client, {
        brand,
        references: referenceVariants,
        limit: sampleLimit,
      });
    } catch (overlayError) {
      console.warn('[price-research] reviewed Rolex/Patek overlay unavailable; preserving QNSA cohort:', overlayError.message);
    }
    const overlayWtsRows = rolexPatekOverlayRows
      .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS');
    const overlayMerge = mergeByExactLineage(rows || [], overlayWtsRows);
    rows = overlayMerge.rows;
    // Reviewed workbooks are the customer-visible canonical inventory. Load
    // every approved WTS/WTB row first; downstream gates independently decide
    // which WTS prices may enter analytics.
    let reviewedWorkbookRows = preloadedReviewedWorkbookRows;
    try {
      if (!configuredSourceTable && !reviewedWorkbookRows.length) {
        const reviewedWorkbookEvidenceRows = await loadReviewedWorkbookEvidenceRows(client, {
          brand, references: referenceVariants, limit: sampleLimit,
        });
        preloadedReviewedWorkbookEvidenceRows = reviewedWorkbookEvidenceRows;
        reviewedWorkbookRows = reviewedWorkbookEvidenceRows
          .filter(row => String(row.listing_type || '').toUpperCase() === 'WTS');
      }
    } catch (workbookError) {
      console.warn('[price-research] reviewed workbook analytics unavailable; using legacy cohort:', workbookError.message);
    }
    const usingReviewedWorkbook = preloadedReviewedWorkbookEvidenceRows.length > 0;
    const usingQnsaReviewedSource = sourceTable === QNSA_PRICE_RESEARCH_SOURCE;
    // Never replace approved workbook evidence with parser-derived fallback
    // prices merely because the exact cohort has no qualified USD observation.
    if (usingReviewedWorkbook) {
      rows = reviewedWorkbookRows;
    }
    const directWtsRows = await loadApprovedDirectSubmissionRows(client, {
      brand, referenceVariants, intent: 'WTS', limit: pageSize,
    });
    if (directWtsRows.length) {
      const rowsById = new Map((rows || []).map(row => [String(row.id), row]));
      for (const row of directWtsRows) rowsById.set(String(row.id), row);
      rows = [...rowsById.values()];
    }
    const baseSampleCount = rows.length;
    const exactEvidenceRecoveryCapped = (rows || [])
      .some(row => row.exact_evidence_recovery_capped === true);
    const sourceSampleCapped = exactEvidenceRecoveryCapped || (usingReviewedWorkbook
      ? baseSampleCount >= sampleLimit
      : baseSampleCount >= pageSize);

    if ((!rows || rows.length === 0) && preloadedReviewedWorkbookEvidenceRows.length === 0) {
      const emptyReconciliation = {
        total_tracked_listings: 0,
        wts_eligible_analytics_count: 0,
        wtb_demand_count: 0,
        excluded_count: 0,
        excluded_breakdown: {
          unpriced: 0,
          outliers: 0,
          unsplit_bundles: 0,
        },
      };
      return res.status(200).json({
        success: true, brand, reference: rawRef,
        resolvedRef: targetRef !== rawRef ? targetRef : null,
        model: null, dialColors: null,
        total_tracked_listings: 0,
        wts_eligible_analytics_count: 0,
        wtb_demand_count: 0,
        demand_rows: [],
        excluded_count: 0,
        excluded_breakdown: emptyReconciliation.excluded_breakdown,
        reconciliation: emptyReconciliation,
        dial_analysis: [],
        totalListings: 0, sampledListings: 0, sampleCapped: false, count: 0,
        analytics_ready: false, listing_count: 0,
        sample_quality: 'observational',
        selected_cohort: { condition: 'All conditions', dial_color: 'Unspecified', count: 0 },
        cohorts: [], outliers: [], outlier_rows: [], outliersRemoved: 0, excludedEvidenceCount: 0, rawCount: 0,
        methodology: { method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0', minimum_sample: 2, included_count: 0, excluded_count: 0 },
        stats: null, liquidity: null, monthly: [], prices: [], rows: [],
        forecast: { ready: false, reasons: ['NO_ELIGIBLE_OBSERVATIONS'] }
      });
    }

    // Exclude synthetic/test sources. mysql_auction_watches is historical market
    // evidence and must not be discarded from analytics.
    const excludedSources = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs']);
    let catalogHit = lookupCatalog(targetRef, brand || null);
    // Historical Patek listings commonly omit the catalog's terminal variant
    // suffix (for example 5712/1A vs 5712/1A-001). An image-only enrichment
    // record must not block the modeled canonical family used for validation.
    if ((!catalogHit?.found || !catalogHit.model)
      && /^\d{4}\/1A$/i.test(targetRef)
      && String(brand || '').toUpperCase() === 'PATEK PHILIPPE') {
      const canonicalVariant = lookupCatalog(`${targetRef}-001`, brand);
      if (canonicalVariant?.found && canonicalVariant.model) catalogHit = canonicalVariant;
    }
    if (catalogHit?.found && catalogHit.dialColors != null && !Array.isArray(catalogHit.dialColors)) {
      catalogHit = { ...catalogHit, dialColors: [catalogHit.dialColors] };
    }

    // A newest-first cap can hide a valid dial when one high-volume variant
    // occupies all 5,000 sampled rows. Supplement only missing catalog dials
    // with a bounded query, then de-duplicate by immutable source ID.
    const observedDialCounts = rows.reduce((counts, row) => {
      const dial = normalizeDialValue(row.dial_color);
      if (dial.known) counts.set(dial.value.toLowerCase(), (counts.get(dial.value.toLowerCase()) || 0) + 1);
      return counts;
    }, new Map());
    const supplementalCatalogDials = (catalogHit?.dialColors || [])
      .map(value => normalizeDialValue(value))
      .filter(dial => dial.known && (
        !observedDialCounts.has(dial.value.toLowerCase())
        || (sourceSampleCapped && observedDialCounts.get(dial.value.toLowerCase()) < 1000)
      ))
      .map(dial => dial.value);
    if (!controlledPaneraiRelease
      && !usingReviewedWorkbook
      && !usingQnsaReviewedSource
      && supplementalCatalogDials.length) {
      const supplementalPages = await Promise.all(supplementalCatalogDials.map(dial => client
        .from(sourceTable)
        .select(columns)
        .eq('brand', brand)
        .in('reference', referenceVariants)
        .eq('listing_type', 'WTS')
        .ilike('dial_color', dial)
        .order('created_at', { ascending: false })
        .limit(1000)));
      const supplementalError = supplementalPages.find(page => page.error)?.error;
      if (supplementalError) throw supplementalError;
      const rowsById = new Map(rows.map(row => [row.id, row]));
      for (const row of supplementalPages.flatMap(page => page.data || [])) rowsById.set(row.id, row);
      rows = [...rowsById.values()];
    }
    rows = usingReviewedWorkbook
      ? rows
      : controlledPaneraiRelease
      ? rows.filter(isOwnerReviewedWorkbookRow)
      : rows;
    const equivalentKeys = new Set(referenceVariants.map(normRef));
    rows = rows.filter(row =>
      (usingReviewedWorkbook || isPriceResearchAdmissionCandidate(row))
      && String(row.brand || '').toLowerCase() === String(brand || '').toLowerCase()
      && (usingQnsaReviewedSource && familyPrefix
        ? normRef(row.reference).startsWith(normRef(familyPrefix))
        : equivalentKeys.has(normRef(row.reference))));
    if (usingQnsaReviewedSource && rows.length === 0) {
      // A stale dedicated-view row shape can survive the database query yet be
      // removed by the legacy post-query contract. Recover from the canonical
      // Trading release after that boundary too; this loader already enforces
      // brand/reference, WTS, verified USD, bundle, and duplicate gates.
      rows = await loadQnsaVerifiedTradingPrices(client, {
        brand,
        referenceVariants,
        familyPrefix,
        limit: pageSize,
      });
    }
    const shadowBundleIds = controlledPaneraiRelease || usingReviewedWorkbook || usingQnsaReviewedSource
      ? new Set()
      : await loadShadowBundleParentIds(client, rows);

    const normalizedRows = rows
      .filter(r => !excludedSources.has(r.source))
      .map(row => {
        const normalized = normalizeAnalyticsPriceRow(row, {
          usingReviewedWorkbook,
          usingQnsaReviewedSource,
          referenceVariants,
        });
        const normalizedDial = normalizeDialValue(normalized.dial_color);
        return {
          ...normalized,
          owner_reviewed_identity: usingQnsaReviewedSource || row.owner_reviewed_identity === true || isOwnerReviewedWorkbookRow(row),
          bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds),
          dial_color: normalizedDial.known ? normalizedDial.value : normalized.dial_color,
          stored_price_usd: row.price_usd,
          price_usd: normalized.analytics_price_usd,
        };
      });
    // The strict view excludes reviewed duplicates in Postgres. Recheck only
    // this bounded cohort so a deployment-order or lookup failure is
    // unavailable rather than silently publishing a suppressed observation.
    const analyticsSuppressedIds = controlledPaneraiRelease || usingReviewedWorkbook || usingQnsaReviewedSource
      ? new Set()
      : await loadAnalyticsSuppressedIds(
          client,
          normalizedRows.map(row => row.id)
        );
    const duplicateSuppressedRows = normalizedRows.filter(row => analyticsSuppressedIds.has(String(row.id)));
    const analyticsRows = normalizedRows.filter(row => !analyticsSuppressedIds.has(String(row.id)));
    const bundleParentExcludedCount = analyticsRows.filter(row => row.bundle_candidate_count > 1).length;
    const totalListings = analyticsRows.length - bundleParentExcludedCount;
    const requestedDial = String(req.query.dial || '').trim().toLowerCase();
    const requiredFieldExclusions = analyticsRows
      .map(row => ({ row, reason: classifyResearchEligibility(row, catalogHit) }))
      .filter(item => item.reason)
      .map(({ row, reason }) => ({ ...row, is_outlier: true, outlier_reason: reason }));
    const retainedEvidenceRows = requiredFieldExclusions.filter(row => (
      isOwnerReviewedWorkbookRow(row)
      && (!requestedDial || String(row.dial_color || '').trim().toLowerCase() === requestedDial)
    ));
    const eligibleMarketRows = analyticsRows.filter(row => !classifyResearchEligibility(row, catalogHit));
    // Reposts remain immutable evidence, but the same dealer repeatedly offering
    // the same configuration at the same price is one market observation.
    const { uniqueRows: marketRows, repostRows } = deduplicateReposts(eligibleMarketRows);
    const isUnknownDial = value => {
      const normalized = String(value || '').trim().toUpperCase();
      return !normalized || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-'].includes(normalized);
    };
    const unknownDialCount = analyticsRows.filter(row => isUnknownDial(row.dial_color)).length;

    const cohorts = buildComparableCohorts(marketRows);
    const dialGroups = buildDialGroups(marketRows);
    const selectedDialGroup = selectDialGroup(dialGroups, requestedDial, summarizeComparableRows);
    const selection = { dial: selectedDialGroup.dial_color };
    const selectedRows = selectedDialGroup.rows;
    const selectedCohort = {
      condition: 'All conditions',
      dial_color: selectedDialGroup.dial_color,
      rows: selectedRows,
      count: selectedRows.length,
    };
    const listedRows = selectedCohort.rows;
    const currencyCorrections = listedRows.filter(row => row.price_normalization).length;

    // A deterministic safety floor runs before IQR. Otherwise a malformed low-
    // price cluster can make the IQR lower fence negative and contaminate every
    // market statistic. Catalog-relative bands are the next refinement.
    const selectedSummary = summarizeComparableRows(listedRows);
    const marketPriceFloorUsd = selectedSummary.marketPriceFloorUsd;
    const validPriceRows = listedRows.filter(r => Number.isFinite(Number(r.price_usd)) && Number(r.price_usd) > 0);
    const summary = selectedSummary.summary;
    const prices = summary.included;
    const classifiedRows = listedRows.map(row => {
      const classification = classifyPrice(row.price_usd, summary.stats, { minimumPrice: marketPriceFloorUsd });
      return { ...row, is_outlier: !classification.included, outlier_reason: classification.reason };
    });
    const includedRows = classifiedRows.filter(row => !row.is_outlier && row.price_usd > 0);
    const {
      statisticalOutlierRows,
      allExcludedRows: outlierRows,
    } = partitionExcludedEvidence(
      requiredFieldExclusions.filter(row => matchesSelection(row, selection)),
      repostRows.filter(row => matchesSelection(row, selection)),
      classifiedRows
    );

    function monthlyAverages(cohortRows) {
      const monthlyMap = {};
      cohortRows.forEach(r => {
      const observedAt = r.listing_date;
      if (!observedAt) return;
      const d = new Date(observedAt);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, sum: 0, min: Infinity, max: 0 };
      monthlyMap[key].count++;
      monthlyMap[key].sum += r.price_usd;
      monthlyMap[key].min = Math.min(monthlyMap[key].min, r.price_usd);
      monthlyMap[key].max = Math.max(monthlyMap[key].max, r.price_usd);
      });
      return Object.values(monthlyMap)
        .map(m => ({ month: m.month, count: m.count, avg_price: Math.round(m.sum / m.count), min_price: m.min, max_price: m.max }))
        .sort((a, b) => a.month.localeCompare(b.month));
    }

    const monthly = monthlyAverages(includedRows);

    // The release cohort is exact brand + reference + dial. Condition remains
    // descriptive listing evidence and does not split market analytics. The
    // helper still enforces sample, identity, recency, and rolling-backtest
    // gates before returning any future values.
    const validatedForecast = buildMarketForecast(includedRows);
    const forecast = validatedForecast.ready
      ? validatedForecast
      : buildIndicativeForecast(includedRows);

    // ── Dial analysis with family rollup + min-5 gate + catalog cross-reference ──
    // Family map: normalize variant names to canonical families
    const DIAL_FAMILY = {
      'blue arabic': 'Blue', 'blue index': 'Blue', 'blue diamond': 'Blue', 'blue roman': 'Blue',
      'sunburst blue': 'Blue', 'navy blue': 'Blue', 'ice blue': 'Ice Blue', 'tiffany blue': 'Tiffany Blue',
      'dark blue': 'Blue', 'light blue': 'Blue',
      'cream white': 'White', 'ivory white': 'White', 'arctic white': 'White',
      'mother of pearl': 'Mother of Pearl', 'mop': 'Mother of Pearl',
      'white mother of pearl': 'Mother of Pearl', 'black mother of pearl': 'Mother of Pearl',
      'black index': 'Black', 'black roman': 'Black', 'black diamond': 'Black',
      'choco': 'Chocolate', 'chocolate': 'Chocolate', 'coffee': 'Chocolate',
      'gold diamond': 'Gold', 'rose gold': 'Gold', 'pave diamond': 'Diamond',
      'pave': 'Diamond', 'paved': 'Diamond',
      'champ': 'Champagne', 'champagne': 'Champagne',
      'slate': 'Grey', 'anthracite': 'Grey',
      'candy': 'Pink', 'candy pink': 'Pink', 'lavender': 'Purple',
      'green index': 'Green', 'olive green': 'Green', 'olive': 'Green',
    };

    function dialToFamily(dialColor) {
      if (!dialColor) return 'Unspecified';
      const key = String(dialColor).trim().toLowerCase();
      if (DIAL_FAMILY[key]) return DIAL_FAMILY[key];
      // If the dial is a known base color, keep it
      const baseColors = ['black', 'white', 'blue', 'green', 'silver', 'grey', 'gray',
        'brown', 'pink', 'red', 'yellow', 'purple', 'orange', 'gold', 'salmon',
        'champagne', 'rhodium', 'meteorite', 'skeleton', 'bronze', 'cream',
        'beige', 'panda', 'wimbledon', 'tiffany', 'platinum'];
      for (const base of baseColors) {
        if (key === base || key.startsWith(base + ' ') || key.startsWith(base + '/')) {
          return base.charAt(0).toUpperCase() + base.slice(1);
        }
      }
      // Unknown custom — keep original but flag as low-signal
      return String(dialColor).trim();
    }

    const dialMap = {};
    const dialAnalysisRows = marketRows;
    dialAnalysisRows.forEach(r => {
      const rawDial = r.dial_color || 'Unspecified';
      const family = dialToFamily(rawDial);
      const key = family.toLowerCase();
      if (!dialMap[key]) dialMap[key] = { dial_color: family, rows: [] };
      dialMap[key].rows.push(r);
    });
    const dial_analysis = Object.values(dialMap)
      .map(d => {
        const dialSummary = summarizeComparableRows(d.rows).summary;
        if (!dialSummary.analytics_ready || !dialSummary.stats) return null;
        return {
          dial_color: d.dial_color,
          count: dialSummary.included.length,
          avg_price: dialSummary.stats.avg,
          min_price: dialSummary.stats.min,
          max_price: dialSummary.stats.max,
        };
      })
      .filter(Boolean)
      .filter(d => d.count >= 2)  // min-2 gate: only show dial families with 2+ listings
      .sort((a, b) => b.count - a.count);
    const dial_trends = Object.values(dialMap)
      .map(d => {
        const dialSummary = summarizeComparableRows(d.rows);
        if (!dialSummary.summary.analytics_ready || !dialSummary.summary.stats) return null;
        const dialIncludedRows = d.rows.filter(row => classifyPrice(
          row.price_usd,
          dialSummary.summary.stats,
          { minimumPrice: dialSummary.marketPriceFloorUsd },
        ).included);
        if (dialIncludedRows.length < 2) return null;
        const validatedDialForecast = buildMarketForecast(dialIncludedRows);
        return {
          dial_color: d.dial_color,
          count: dialIncludedRows.length,
          monthly: monthlyAverages(dialIncludedRows),
          forecast: validatedDialForecast.ready
            ? validatedDialForecast
            : buildIndicativeForecast(dialIncludedRows),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count);
    const dialColors = dial_analysis.map(d => d.dial_color);

    // ── Real model name (catalog decoration) + real liquidity (indicators, no phantom numbers) ──
    const model = catalogHit?.found
      ? (catalogHit.model || null)
      : lookupModel(targetRef, brand)
        || analyticsRows.map(row => String(row.model || '').trim()).find(Boolean)
        || null;
    const demand = await lookupDemand(
      client,
      sourceTable,
      brand,
      referenceVariants,
      catalogHit,
      selection,
      preloadedReviewedWorkbookEvidenceRows,
      familyPrefix,
      { page: demandPage, pageSize: demandPageSize },
      rolexPatekOverlayRows.filter(row => String(row.listing_type || '').toUpperCase() === 'WTB'),
    );
    const liquidity = await lookupLiquidity(client, targetRef, listedRows.length, demand, selection);

    const comparableEvidencePage = paginateEvidenceRows(includedRows, evidencePage, evidencePageSize);
    // Unpriced WTS belongs on the Trading Floor only. Price Research still
    // accounts for it in retained_evidence_count/methodology, but never emits
    // it as a customer sale card. Priced exclusions remain reviewable without
    // entering averages, graphs, or forecasts.
    const customerPricedOutlierRows = outlierRows.filter(isCustomerPricedSaleEvidence);
    const outlierEvidencePage = paginateEvidenceRows(customerPricedOutlierRows, evidencePage, evidencePageSize);
    const serializedComparables = comparableEvidencePage.rows;
    const serializedOutliers = outlierEvidencePage.rows;
    const comparableEvidenceRows = serializedComparables.map(r => ({
      id: r.id,
      listing_type: 'WTS',
      raw_message: r.raw_message ? redactPublicSource(r.raw_message) : null,
      price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
      dial_color: r.dial_color, condition: r.condition,
      source: r.source, year: r.year,
      thumbnail_url: r.thumbnail_url || null,
      image_urls: r.image_urls || null,
      has_images: r.has_images || false,
      image_evidence_type: r.image_evidence_type || null,
      seller_name: r.seller_name || null,
      seller_phone: consentApprovedPhone(r),
      verdict: r.verdict || null,
      confidence: r.confidence || null,
      listing_status: r.listing_status || null,
      contact_publication_approved: r.contact_publication_approved === true,
      source_file: r.source_file || null,
      stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
      is_outlier: r.is_outlier, outlier_reason: r.outlier_reason,
      source_price_amount: r.source_price_amount ?? r.price_raw ?? null,
      source_currency: r.source_currency || r.currency || null,
      ...serializePriceProvenance(r),
    }));
    const outlierDealerEvidenceRows = serializedOutliers.map(r => ({
      id: r.id,
      listing_type: 'WTS',
      raw_message: r.raw_message ? redactPublicSource(r.raw_message) : null,
      price_usd: r.price_usd,
      created_at: r.created_at,
      listing_date: r.listing_date,
      dial_color: r.dial_color,
      condition: r.condition,
      source: r.source,
      year: r.year,
      is_outlier: true,
      outlier_reason: r.outlier_reason,
      stored_price_usd: r.stored_price_usd,
      price_normalization: r.price_normalization,
      source_price_amount: r.source_price_amount ?? r.price_raw ?? null,
      source_currency: r.source_currency || r.currency || null,
      ...serializePriceProvenance(r),
      thumbnail_url: r.thumbnail_url || null,
      image_urls: r.image_urls || null,
      has_images: r.has_images || false,
      image_evidence_type: r.image_evidence_type || null,
      seller_name: r.seller_name || null,
      seller_phone: consentApprovedPhone(r),
      verdict: r.verdict || null,
      confidence: r.confidence || null,
      listing_status: r.listing_status || null,
      contact_publication_approved: r.contact_publication_approved === true,
      source_file: r.source_file || null,
    }));
    const combinedDealerEvidenceRows = await enrichRowsWithExactDealerEvidence(client, [
      ...comparableEvidenceRows,
      ...outlierDealerEvidenceRows,
    ]);
    const comparableRowsWithDealerEvidence = combinedDealerEvidenceRows.slice(0, comparableEvidenceRows.length);
    const outlierRowsWithDealerEvidence = combinedDealerEvidenceRows.slice(
      comparableEvidenceRows.length,
    );

    const wtsEligibleAnalyticsCount = includedRows.length;
    const outliersCount = statisticalOutlierRows.length;
    const unsplitBundlesCount = bundleParentExcludedCount;
    const rawWtbDemand = demand?.demand_count;
    const wtbDemandCount = typeof rawWtbDemand === 'number' && Number.isFinite(rawWtbDemand) && rawWtbDemand >= 0
      ? rawWtbDemand
      : 0;
    // WTS evidence and verified WTB demand are loaded through independent
    // lanes. Count both populations explicitly; capping demand to the number
    // of WTS rows made valid buyer signals disappear from reconciliation.
    const requiredFieldReasonCounts = requiredFieldExclusions.reduce((counts, row) => {
      const reason = String(row.outlier_reason || 'OTHER_REQUIRED_FIELD').toUpperCase();
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {});
    const wtsAccounting = buildWtsReconciliation({
      analyticsRowsCount: analyticsRows.length,
      includedCount: wtsEligibleAnalyticsCount,
      requiredFieldReasonCounts,
      requiredFieldExclusionsCount: requiredFieldExclusions.length,
      repostCount: repostRows.length,
      marketRowsCount: marketRows.length,
      listedRowsCount: listedRows.length,
      outliersCount,
      unsplitBundlesCount,
      duplicateSuppressedCount: duplicateSuppressedRows.length,
    });
    const excludedTotalCount = wtsAccounting.excluded;
    const totalTrackedListings = wtsAccounting.loaded + wtbDemandCount;

    const reconciliation = {
      total_tracked_listings: totalTrackedListings,
      wts_eligible_analytics_count: wtsEligibleAnalyticsCount,
      wtb_demand_count: wtbDemandCount,
      excluded_count: excludedTotalCount,
      excluded_breakdown: {
        ...wtsAccounting.breakdown,
      },
      wts_accounting_reconciles: wtsAccounting.reconciles,
      wts_loaded_count: wtsAccounting.loaded,
      demand_non_watch_excluded_count: demand?.demand_non_watch_excluded_count || 0,
      demand_non_watch_excluded_breakdown: demand?.demand_non_watch_excluded_breakdown || {},
    };

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model, dialColors,
      analytics_source: usingReviewedWorkbook
        ? 'reviewed_workbook_market_source_v2'
        : sourceTable,
      reviewed_overlay: {
        source: 'reviewed_workbook_inventory',
        tier: 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1',
        accepted_usd_statuses: [
          'SOURCE_EXPLICIT_USD_MATCH',
        ],
        bare_currency_policy_statuses_excluded_from_usd_analytics: true,
        input_wts_count: overlayWtsRows.length,
        added_wts_count: overlayMerge.overlay_added_count,
        exact_lineage_duplicates_held: overlayMerge.overlay_duplicate_count,
        wtb_count: rolexPatekOverlayRows.filter(row => String(row.listing_type || '').toUpperCase() === 'WTB').length,
      },
      total_tracked_listings: totalTrackedListings,
      wts_eligible_analytics_count: wtsEligibleAnalyticsCount,
      wtb_demand_count: wtbDemandCount,
      demand_rows: demand?.demand_rows || [],
      demand_evidence: {
        returned: demand?.demand_returned || 0,
        total: wtbDemandCount,
        page: demand?.demand_page || demandPage,
        page_size: demand?.demand_page_size || demandPageSize,
        pages: demand?.demand_pages || Math.max(1, Math.ceil(wtbDemandCount / demandPageSize)),
        sample_capped: demand?.demand_sample_capped === true,
      },
      excluded_count: excludedTotalCount,
      excluded_breakdown: reconciliation.excluded_breakdown,
      exclusion_reason_counts: requiredFieldReasonCounts,
      reconciliation,
      dial_analysis,
      dial_trends,
      dial_data_quality: {
        known_count: analyticsRows.length - unknownDialCount,
        unknown_count: unknownDialCount,
        completeness_percent: analyticsRows.length
          ? Math.round(((analyticsRows.length - unknownDialCount) / analyticsRows.length) * 1000) / 10
          : 0,
        status: unknownDialCount === 0 ? 'complete' : 'incomplete',
      },
      duplicate_data_quality: {
        suppressed_from_analytics: duplicateSuppressedRows.length,
        status: duplicateSuppressedRows.length ? 'reviewed_duplicates_excluded' : 'no_reviewed_duplicates_excluded',
      },
      currency_data_quality: {
        corrected_count: currencyCorrections,
        status: currencyCorrections ? 'corrected_for_analytics' : 'as_stored',
      },
      bundle_data_quality: {
        unsplit_parent_excluded_count: bundleParentExcludedCount,
        status: bundleParentExcludedCount ? 'excluded_from_analytics' : 'clean',
      },
      condition_policy: {
        analytics_dimension: false,
        cohort: 'All conditions',
        listing_description_retained: true,
      },
      admission_policy: {
        verdicts: ['APPROVED', ...HUMAN_REVIEW_VERDICTS],
        human_review_scope: ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith'],
        human_review_is_analytics_eligible_only_after_all_evidence_gates: true,
        approved_minimum_confidence: MIN_RELEASE_CONFIDENCE,
        human_review_minimum_confidence: null,
        confidence_is_probability: false,
        exact_release_reference_required: true,
        canonical_identity_review_required: true,
        explicit_currency_evidence_required: true,
        verified_fx_provenance_required: false,
        catalog_model_and_dial_required: true,
        catalog_or_owner_reviewed_identity_required: true,
        unsplit_bundles_excluded: true,
        reviewed_duplicates_excluded: true,
      },
      totalListings: listedRows.length,
      reference_listing_count: totalListings,
      listing_count: listedRows.length,
      eligible_observation_count: listedRows.length,
      unique_offer_count: listedRows.length,
      market_listings_count: analyticsRows.length,
      analytics_eligible_count: marketRows.length,
      analytics_excluded_count: analyticsRows.length - marketRows.length,
      repost_count: repostRows.filter(row => matchesSelection(row, selection)).length,
      sampledListings: rows.length,
      sampleCapped: sourceSampleCapped,
      count: prices.length,
      rawCount: validPriceRows.length,
      outliersRemoved: statisticalOutlierRows.length,
      excludedEvidenceCount: outlierRows.length,
      retained_evidence_count: retainedEvidenceRows.length,
      outliers: canReviewExcludedEvidence ? statisticalOutlierRows.map(row => row.price_usd) : [],
      outlier_rows: canReviewExcludedEvidence ? outlierRowsWithDealerEvidence : [],
      analytics_ready: summary.analytics_ready,
      sample_quality: summary.sample_quality,
      stats: summary.analytics_ready ? summary.stats : null,
      selected_cohort: {
        condition: selectedCohort.condition,
        dial_color: selectedCohort.dial_color,
        count: selectedCohort.count,
      },
      cohorts: cohorts.map(cohort => {
        const cohortSummary = summarizeComparableRows(cohort.rows).summary;
        return {
          condition: cohort.condition,
          dial_color: cohort.dial_color,
          count: cohort.count,
          avg_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.avg ?? null) : null,
          min_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.min ?? null) : null,
          max_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.max ?? null) : null,
        };
      }),
      dial_groups: dialGroups.map(group => {
        const groupSummary = summarizeComparableRows(group.rows).summary;
        return {
          dial_color: group.dial_color,
          count: group.count,
          condition_counts: group.condition_counts,
          avg_price: groupSummary.analytics_ready ? (groupSummary.stats?.avg ?? null) : null,
          min_price: groupSummary.analytics_ready ? (groupSummary.stats?.min ?? null) : null,
          max_price: groupSummary.analytics_ready ? (groupSummary.stats?.max ?? null) : null,
        };
      }),
      methodology: {
        method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0',
        formula: 'Q1 - 3.0 * IQR <= price <= Q3 + 3.0 * IQR',
        iqr_multiplier: 3.0,
        analytics_dimensions: ['brand', 'reference', 'dial_color'],
        condition_policy: 'DESCRIPTION_ONLY_NOT_A_COHORT_DIMENSION',
        minimum_sample: 2,
        included_count: includedRows.length,
        priced_wts_before_plausibility_count: validPriceRows.length,
        priced_wts_after_plausibility_count: summary.raw_count,
        excluded_count: outlierRows.length,
        statistical_outlier_count: statisticalOutlierRows.length,
        required_field_excluded_count: requiredFieldExclusions.length,
        repost_excluded_count: repostRows.length,
        duplicate_suppressed_count: duplicateSuppressedRows.length,
        unsplit_bundle_excluded_count: bundleParentExcludedCount,
        plausibility_floor_usd: marketPriceFloorUsd,
        plausibility_excluded_count: outlierRows.filter(row => row.outlier_reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR').length,
        lower_fence: summary.stats?.lower_fence ?? null,
        upper_fence: summary.stats?.upper_fence ?? null,
      },
      evidence: {
        comparable_returned: serializedComparables.length,
        comparable_total: includedRows.length,
        comparable_page: comparableEvidencePage.page,
        comparable_page_size: comparableEvidencePage.page_size,
        comparable_pages: comparableEvidencePage.pages,
        retained_returned: 0,
        retained_total: retainedEvidenceRows.length,
        retained_pages: 1,
        outliers_returned: serializedOutliers.length,
        outliers_total: customerPricedOutlierRows.length,
        outlier_pages: outlierEvidencePage.pages,
        sale_page: comparableEvidencePage.page,
        sale_pages: Math.max(
          1,
          Math.ceil(includedRows.length / evidencePageSize),
          Math.ceil(customerPricedOutlierRows.length / evidencePageSize),
        ),
        truncated: includedRows.length > evidencePageSize
          || customerPricedOutlierRows.length > evidencePageSize,
      },
      liquidity,
      monthly, prices, forecast,
      retained_rows: [],
      rows: comparableRowsWithDealerEvidence,
    });
  } catch (err) {
    console.error('[price-research] error:', err.message, err.stack?.split('\n').slice(0, 3).join(' '));
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};

module.exports.directSubmissionToMarketRow = directSubmissionToMarketRow;
module.exports.qnsaReferenceRowToMarketRow = qnsaReferenceRowToMarketRow;
module.exports.loadApprovedDirectSubmissionRows = loadApprovedDirectSubmissionRows;
module.exports.loadZenithReviewedTradingRows = loadZenithReviewedTradingRows;
module.exports.loadQnsaExactReleasedEvidence = loadQnsaExactReleasedEvidence;
module.exports.loadQnsaVerifiedTradingPrices = loadQnsaVerifiedTradingPrices;
module.exports.normalizeAnalyticsPriceRow = normalizeAnalyticsPriceRow;
module.exports.paginateEvidenceRows = paginateEvidenceRows;
module.exports.isCustomerPricedSaleEvidence = isCustomerPricedSaleEvidence;
module.exports.serializePriceProvenance = serializePriceProvenance;
module.exports.loadQnsaTradingDemand = loadQnsaTradingDemand;
module.exports.loadRuntimePriceRecoveryRows = loadRuntimePriceRecoveryRows;
module.exports.reviewedFamilyPrefix = reviewedFamilyPrefix;
module.exports.configuredReviewedPriceSource = configuredReviewedPriceSource;
module.exports.isPendingQnsaBrandRelease = isPendingQnsaBrandRelease;
module.exports.consentApprovedPhone = consentApprovedPhone;
