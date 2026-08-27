'use strict';

const { getClient } = require('./_lib/supabase');
const { parseTradingSearch } = require('./_lib/trading-search.cjs');
const { listCanonicalCatalogReferences, listCatalogReferences, listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const { ratedDealerEvidence } = require('./_lib/dealer-directory-source.cjs');
const { applyEffectivePrice } = require('./_lib/corrected-price-source.cjs');
const { recoverRecordPrices } = require('./_lib/runtime-price-recovery.cjs');
const { deterministicCandidateCount } = require('./_lib/unsplit-bundle-filter.cjs');
const { classifyZenithIdentityEvidence } = require('./_lib/zenith-identity-evidence.cjs');
const { luxuryIdentityEligibility, normalizeLuxuryIdentity } = require('./_lib/luxury-item-normalization.cjs');
const { classifyWatchPartListing } = require('./_lib/watch-item-classification.cjs');
const { normalizeWatchConditionFields } = require('./_lib/watch-condition-normalization.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const {
  MARKET_SELECTOR: CURATED_SHADOW_MARKET_SOURCE,
  isShadowBrand,
  loadInventory: loadCuratedShadowInventory,
  shadowCursorMatches,
} = require('./_lib/curated-luxury-shadow.cjs');
const {
  isFourBrand,
  isMissingEffectiveRpcError,
  isTransientEffectiveRpcTimeout,
  loadEffectiveCount,
  loadEffectiveEnrichments,
} = require('./_lib/four-brand-field-enrichment.cjs');
const {
  databaseTradingIntentFilter,
  isPublicTradingIntent,
  resolveTradingIntent,
} = require('./_lib/trading-intent.cjs');
const {
  isExactRolexPatekMultiParent,
  isRolexPatekOverlayBrand,
  loadRolexPatekOverlayExactKeys,
  loadRolexPatekOverlayRows,
  mergeByExactLineage,
  overlayExactKeys,
  ROLEX_PATEK_DELTA_TIER,
} = require('./_lib/rolex-patek-reviewed-overlay.cjs');
const {
  cleanExactText,
  loadSummary,
  resolvePageWindow,
} = require('./reviewed-workbook-inventory.js');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const EXPLICIT_USD_STATUS = 'SOURCE_EXPLICIT_USD_MATCH';
const { applyConfirmedFiveWatchPublication } = require('./_lib/five-watch-publication.cjs');
const OWNER_ASSUMED_USD_STATUSES = new Set([
  'OWNER_ASSUMED_USD',
  'OWNER_ASSUMED_USD_CANDIDATE',
  'OWNER_DOLLAR_USD_POLICY',
  'OWNER_K_USD_POLICY',
]);
const MULTI_PARENT_VERIFICATION_STATUS = 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY';
const MULTI_PARENT_PUBLICATION_LANE = 'OWNER_MULTI_PARENT_SOURCE_LINEAGE_V1';
const ALLOWED_MARKET_SOURCE_VIEWS = new Set([
  'reviewed_workbook_market_source_v2',
  'qnsa_rolex_patek_trading_floor_source',
  CURATED_SHADOW_MARKET_SOURCE,
]);
const requestedMarketSourceView = String(process.env.TRADING_FLOOR_SOURCE_VIEW || '').trim();
const MARKET_SOURCE_VIEW = ALLOWED_MARKET_SOURCE_VIEWS.has(requestedMarketSourceView)
  ? requestedMarketSourceView
  : 'qnsa_rolex_patek_trading_floor_source';
const MULTIPLE_LISTING_IDENTITY_VALUES = ['multiple', 'multi', 'mixed'];
const MIN_PUBLIC_WORKBOOK_PRICE_USD = 1_000;
const MAX_PUBLIC_WORKBOOK_PRICE_USD = 100_000_000;
const SIX_REVIEWED_WATCH_BRANDS = [
  'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith',
  'Omega', 'Tudor', 'TAG Heuer', 'Vacheron Constantin',
];
const SIX_REVIEWED_BRAND_CURSOR_CODES = Object.freeze({
  Rolex: 'r',
  'Patek Philippe': 'p',
  'Audemars Piguet': 'a',
  'Richard Mille': 'm',
  Cartier: 'c',
  Zenith: 'z',
  Omega: 'o',
  Tudor: 't',
  'TAG Heuer': 'th',
  'Vacheron Constantin': 'v',
});
const REVIEWED_WORKBOOK_ADMISSION_BRANDS = new Set([
  'A. Lange & Söhne', 'Audemars Piguet', 'Bell & Ross', 'Blancpain', 'Breguet', 'Breitling',
  'Bulgari', 'Cartier', 'Chopard', 'F.P. Journe', 'Franck Muller',
  'Girard-Perregaux', 'Glashütte Original', 'Grand Seiko', 'H. Moser & Cie',
  'Hublot', 'IWC', 'Jacob & Co', 'Jaeger-LeCoultre', 'Longines', 'Omega', 'Panerai',
  'Patek Philippe', 'Richard Mille', 'Rolex', 'Seiko', 'TAG Heuer', 'Tissot',
  'Tudor', 'Ulysse Nardin', 'Vacheron Constantin', 'Zenith',
]);

async function loadQnsaReviewedReleaseSummary(client) {
  const { data, error } = await client.rpc('qnsa_market_feed_counts');
  // Summary counts are useful metadata, but they must never take the customer
  // inventory feed offline. The bounded page RPC remains the authoritative
  // row path while a stale/missing count snapshot is repaired separately.
  if (error) {
    console.warn('[reviewed-market-inventory] QNSA count snapshot unavailable:', error.message);
  }
  const marketCounts = Array.isArray(data) ? data : [];
  const watchRows = marketCounts.filter(row => String(row.category || '').toUpperCase() === 'WATCH');
  return {
    files_total: 1,
    files_complete: 1,
    source_rows: 1_394_269,
    rows_scanned: 1_394_269,
    canonical_listings: watchRows.reduce((sum, row) => sum + Number(row.row_count || 0), 0),
    duplicate_rows_held: null,
    errors: 0,
    reconciled: !error,
    count_snapshot_available: !error,
    source: 'mariadb-normalized-20260811-codex-v1',
    brands: ['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier', 'Zenith',
      'Vacheron Constantin', 'Omega', 'Tudor'].map(brand => ({
      brand,
      files: 1,
      files_complete: 1,
      source_rows: null,
      canonical_listings: watchRows
        .filter(row => String(row.brand || '').toLowerCase() === brand.toLowerCase())
        .reduce((sum, row) => sum + Number(row.row_count || 0), 0),
      duplicate_rows_held: null,
    })),
    market_counts: marketCounts,
  };
}

function unavailableQnsaReleaseSummary() {
  return {
    files_total: 1,
    files_complete: 1,
    source_rows: 1_394_269,
    rows_scanned: 1_394_269,
    canonical_listings: null,
    duplicate_rows_held: null,
    errors: 0,
    reconciled: false,
    count_snapshot_available: false,
    source: 'mariadb-normalized-20260811-codex-v1',
    brands: [
      'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier',
      'TAG Heuer', 'Omega', 'Tudor', 'Vacheron Constantin', 'Breguet', 'Hublot',
      'A. Lange & Söhne', 'Blancpain', 'Bulgari', 'Panerai', 'IWC', 'F.P. Journe',
      'Zenith', 'Chopard', 'Jaeger-LeCoultre', 'Breitling', 'Grand Seiko',
      'H. Moser & Cie', 'Jacob & Co', 'Longines', 'Franck Muller', 'Ulysse Nardin',
      'Girard-Perregaux', 'Glashütte Original', 'Tissot', 'Bell & Ross', 'Seiko'
    ].map(brand => ({
      brand,
      files: 1,
      files_complete: 1,
      source_rows: null,
      canonical_listings: null,
      duplicate_rows_held: null,
    })),
    market_counts: [],
  };
}

function snapshotInventoryTotal(summary, filters) {
  if (summary?.count_snapshot_available === false) return null;
  const unsupported = filters.search || filters.model || filters.reference || filters.dial || filters.imagesOnly
    || filters.condition || filters.region || filters.rating || filters.postedAfter
    || ['WTS', 'WTB'].includes(filters.listingType);
  if (unsupported || !Array.isArray(summary?.market_counts)) return null;
  return summary.market_counts
    .filter(row => filters.itemCategory === 'ALL'
      || String(row.category || '').toUpperCase() === filters.itemCategory)
    .filter(row => !filters.brand
      || String(row.brand || '').toLowerCase() === filters.brand.toLowerCase())
    .filter(row => !filters.listingType
      || String(row.listing_type || '').toUpperCase() === filters.listingType)
    .filter(row => !filters.pricedOnly || row.supplied_price === true)
    .reduce((sum, row) => sum + Number(row.row_count || 0), 0);
}

const EVIDENCE_CONTRACT = Object.freeze({
  scope: 'returned_page',
  identity_fields: ['brand', 'model', 'reference', 'dial_color'],
  identity: 'Available identity fields are published; complete valid identity is required only for price-research eligibility.',
  contact: 'Seller identity may be published when supplied; phone/contact details require source-backed publication consent.',
  image: 'Only an exact supplied HTTP(S) source URL is image-eligible.',
  price: 'Analytics accepts explicit-source USD/USDT or complete dated-FX evidence. Bare dollar/K and incomplete foreign-currency evidence remain visible only as original source evidence.',
  rating: 'Rated status requires either a source-supplied score plus review count or an exact phone/profile match to public dealer feedback. Feedback counts are never converted into a five-point score.',
  ordering: Object.freeze({
    qnsa_database: 'Global exact-source-image lane first. Dealer rating/profile is enriched after the bounded RPC and is not globally ordered.',
    admitted_workbook_database: 'Postgres orders has_image, WTS before WTB, controlled explicit-price evidence, verified workbook USD, then stable ID before range().',
    returned_page: 'Within the bounded server page only: explicit released singles, exact source image, source-backed dealer evidence, verified explicit price, completeness, then recency.',
  }),
});

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function workbookPriceReviewReason(value) {
  const price = positiveNumber(value);
  if (price === null) return null;
  if (price < MIN_PUBLIC_WORKBOOK_PRICE_USD) return 'WORKBOOK_PRICE_BELOW_PUBLIC_PLAUSIBILITY';
  if (price > MAX_PUBLIC_WORKBOOK_PRICE_USD) return 'WORKBOOK_PRICE_ABOVE_PUBLIC_PLAUSIBILITY';
  return null;
}

function exactHttpUrl(value) {
  const exact = cleanExactText(value, 2_000);
  if (!exact) return null;
  try {
    const parsed = new URL(exact);
    return ['http:', 'https:'].includes(parsed.protocol) ? exact : null;
  } catch {
    return null;
  }
}

function referenceComparisonKey(value) {
  return cleanExactText(value, 80).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function amountComparisonKey(value) {
  const amount = positiveNumber(value);
  return amount === null ? '' : String(amount).replace(/[^0-9]/g, '');
}

function currencyComparisonKey(value) {
  return cleanExactText(value, 12).toUpperCase().replace(/[^A-Z]/g, '');
}

function referenceIsPriceToken(reference, sourceAmount, sourceCurrency) {
  const referenceKey = referenceComparisonKey(reference);
  if (!referenceKey) return false;
  if (/^(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)[0-9]+$/.test(referenceKey)) {
    return true;
  }
  if (/^[0-9]+(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)$/.test(referenceKey)) {
    return true;
  }
  const amountKey = amountComparisonKey(sourceAmount);
  const currencyKey = currencyComparisonKey(sourceCurrency);
  return Boolean(
    amountKey
    && ((/^\d+$/.test(referenceKey) && referenceKey === amountKey)
      || (currencyKey && (referenceKey === `${amountKey}${currencyKey}`
        || referenceKey === `${currencyKey}${amountKey}`))),
  );
}

function ownerAssumedDisplayPrice({
  row,
  resolvedIntent,
  sourceAmount,
  workbookUsd,
  priceEvidenceStatus,
  invalidReference,
  workbookPriceReview,
  rmMyrPriceArtifact,
}) {
  if (resolvedIntent !== 'WTS' || !OWNER_ASSUMED_USD_STATUSES.has(priceEvidenceStatus)) return null;
  if (invalidReference || workbookPriceReview || rmMyrPriceArtifact) return null;
  if (/MULTIPLE|COMPETING|AMBIGUOUS_AMOUNT|YEAR_TOKEN|DIMENSION|WEIGHT|QUANTITY|SERIAL/i
    .test(String(row?.review_reasons || ''))) return null;
  const candidate = positiveNumber(row?.display_price_usd)
    ?? positiveNumber(row?.owner_assumed_price_usd)
    ?? positiveNumber(workbookUsd)
    ?? positiveNumber(sourceAmount);
  if (candidate === null) return null;
  const currentYear = new Date().getUTCFullYear();
  if (Number.isInteger(candidate) && candidate >= 1900 && candidate <= currentYear + 2) return null;
  if (referenceIsPriceToken(
    row?.normalized_reference || row?.raw_reference || row?.catalog_reference,
    candidate,
    'USD',
  )) return null;
  return candidate;
}

function hasValidIntentPrice(row, sourceAmount) {
  const candidate = positiveNumber(sourceAmount);
  if (candidate === null) return false;
  const currentYear = new Date().getUTCFullYear();
  if (Number.isInteger(candidate) && candidate >= 1900 && candidate <= currentYear + 2) return false;
  if (referenceIsPriceToken(
    row?.normalized_reference || row?.raw_reference || row?.catalog_reference || row?.reference,
    candidate,
    row?.source_currency || row?.currency,
  )) return false;
  return !/MULTIPLE|COMPETING|AMBIGUOUS_AMOUNT|DIMENSION|WEIGHT|QUANTITY|SERIAL/i
    .test(String(row?.review_reasons || row?.data_quality_issues || ''));
}

function evidenceValuePresent(value) {
  return value !== null
    && value !== undefined
    && !/^(?:unknown|null|n\/a)$/i.test(String(value).trim())
    && String(value).trim() !== '';
}

function isNormalizedWorkbookSummary(row) {
  const raw = cleanExactText(row.raw_message, 10_000).replace(/\s+/g, ' ');
  if (!raw || !row.source_file || !/\.xlsx$/i.test(String(row.source_file))) return false;
  const brand = cleanExactText(row.supplied_brand || row.canonical_brand || row.brand_scope, 80);
  const reference = cleanExactText(row.normalized_reference || row.raw_reference || row.catalog_reference, 80);
  const dial = cleanExactText(row.dial_color || row.catalog_dial, 80);
  const type = cleanExactText(row.listing_type || 'OTHER', 12).toUpperCase();
  // Workbook-generated summaries can contain the normalized workbook amount even
  // when no source-backed price was retained. Use it only to identify the
  // summary text; publication eligibility still depends on source evidence.
  const amount = positiveNumber(row.source_price_amount) ?? positiveNumber(row.workbook_price_usd);
  const base = [type, brand, reference, dial].filter(Boolean).join(' ');
  const candidates = new Set([base]);
  if (amount !== null) {
    candidates.add(`${base} ${amount.toFixed(2)}`);
    candidates.add(`${base} ${amount}`);
  }
  return candidates.has(raw);
}

function combineInventoryTotal(baseTotal, overlayTotal, overlayCountWithheld = false) {
  if (baseTotal === null || baseTotal === undefined || overlayCountWithheld) return baseTotal ?? null;
  return Number(baseTotal) + Math.max(0, Number(overlayTotal) || 0);
}

function boundReviewedOverlayPage(baseRecords, overlayRecords, pageSize) {
  const available = Math.max(0, Number(pageSize) - (Array.isArray(baseRecords) ? baseRecords.length : 0));
  return (Array.isArray(overlayRecords) ? overlayRecords : []).slice(0, available);
}

function isAuditedRolexPatekDeltaSingle(row) {
  const id = cleanExactText(row?.id, 90);
  const listingType = cleanExactText(row?.listing_type, 30).toUpperCase();
  const brand = row?.supplied_brand || row?.canonical_brand || row?.brand_scope || row?.brand;
  return /^rpdelta_[0-9a-f]{64}$/.test(id)
    && row?.verification_tier === ROLEX_PATEK_DELTA_TIER
    && row?.verification_status === 'APPROVED_SINGLE_CANDIDATE'
    && Number(row?.confidence) === 100
    && row?.raw_lineage_verified === true
    && ['WTS', 'WTB'].includes(listingType)
    && isRolexPatekOverlayBrand(brand);
}

function isAuditedFourBrandEffectiveSingle(row) {
  const listingType = cleanExactText(row?.listing_type, 30).toUpperCase();
  const brand = row?.canonical_brand || row?.brand_scope || row?.brand;
  return row?.publication_lane === 'QNSA_FOUR_BRAND_EFFECTIVE_SIDECAR_V1'
    && row?.verification_status === 'APPROVED_SINGLE_CANDIDATE'
    && row?.raw_lineage_verified === true
    && row?.normalization_run_complete === true
    && isFourBrand(brand)
    && ['WTS', 'WTB'].includes(listingType);
}

function isMultiListing(row) {
  const listingType = cleanExactText(row.listing_type, 30).toUpperCase();
  if (row.is_bundle === true || row.multi_listing === true
    || ['MULTI', 'MULTI_LISTING', 'BUNDLE'].includes(listingType)) return true;
  if ([row.model, row.catalog_model, row.dial_color, row.catalog_dial]
    .some(value => MULTIPLE_LISTING_IDENTITY_VALUES.includes(cleanExactText(value, 40).toLowerCase()))) {
    return true;
  }

  // This marker is assigned only after the reviewed Rolex/Patek delta importer
  // has verified one deterministic offer and immutable raw lineage. Let that
  // narrower audit outrank the legacy prose splitter, which can mistake noisy
  // dealer signatures or accessory text for a second watch. Explicit bundle
  // flags, multi intents, and multi identity sentinels above still fail closed.
  if (isAuditedRolexPatekDeltaSingle(row)) return false;

  // The effective four-brand RPC has already enforced immutable lineage,
  // released single-candidate identity, parent_id NULL, is_bundle=false and
  // duplicate suppression. Its lane replaces the older brand-specific lane
  // names, so retain that exact audited single without re-running the generic
  // prose splitter. Explicit bundle/type/identity sentinels above still win.
  if (isAuditedFourBrandEffectiveSingle(row)) return false;

  if (row.publication_lane === 'QNSA_VACHERON_OVERSEAS_RELEASE_V1'
    && row.raw_lineage_verified === true
    && row.normalization_run_complete === true
    && cleanExactText(row?.canonical_brand || row?.brand_scope, 80) === 'Vacheron Constantin'
    && cleanExactText(row?.catalog_model || row?.model, 80) === 'Overseas'
    && ['WTS', 'WTB'].includes(listingType)) return false;
  if (row.publication_lane === 'QNSA_OMEGA_RELEASE_V1'
    && row.raw_lineage_verified === true
    && row.normalization_run_complete === true
    && cleanExactText(row?.canonical_brand || row?.brand_scope, 80) === 'Omega'
    && ['WTS', 'WTB'].includes(listingType)) return false;
  if (row.publication_lane === 'QNSA_TUDOR_RELEASE_V1'
    && row.raw_lineage_verified === true
    && row.normalization_run_complete === true
    && cleanExactText(row?.canonical_brand || row?.brand_scope, 80) === 'Tudor'
    && ['WTS', 'WTB'].includes(listingType)) return false;
  if (row.publication_lane === 'QNSA_CARTIER_RELEASE_V1'
    && row.raw_lineage_verified === true
    && row.normalization_run_complete === true
    && cleanExactText(row?.canonical_brand || row?.brand_scope, 80) === 'Cartier'
    && ['WTS', 'WTB'].includes(listingType)) return false;

  // The QNSA Zenith lane is reconciled against immutable raw text before its
  // release control is enabled. Its exact classifier understands dotted Zenith
  // references and quarantines cross-brand/Daytona/no-reference evidence. The
  // generic splitter predates those references and falsely split 41 of the 453
  // reconciled single-watch rows. Trust the narrower evidence classifier only
  // for this audited publication lane; every other lane keeps the generic gate.
  if (row.publication_lane === 'QNSA_ZENITH_REVIEWED_V1') {
    return classifyZenithIdentityEvidence(row.raw_message || row.raw_message_text || '').decision !== 'RELEASE_SAFE';
  }

  // Some legacy rows were normalized as a single watch before the source raw
  // message was deterministically segmented. Re-run the same bounded,
  // evidence-only segmentation used by Price Research so those unresolved
  // multi-watch messages cannot appear as one public listing. The raw message
  // remains immutable; separation stays in the deferred review lane.
  return deterministicCandidateCount({
    raw_message: row.raw_message || row.raw_message_text || '',
    flags: row.flags,
  }) > 1;
}

function safeSearchTerm(value) {
  return cleanExactText(value, 120)
    .replace(/[,%()*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function locationSearchPattern(value) {
  const tokens = cleanExactText(value, 100)
    .split(/[,%()*\s]+/)
    .map(token => token.trim())
    .filter(Boolean);
  return tokens.length ? `*${tokens.join('*')}*` : '';
}

function locationMatches(value, query) {
  return postingCountryName(value) !== null
    && postingCountryName(value) === postingCountryName(query);
}

function deduplicateRecordsById(records) {
  const seen = new Set();
  let duplicateCount = 0;
  const uniqueRecords = (records || []).filter(record => {
    const id = String(record?.id);
    if (seen.has(id)) {
      duplicateCount += 1;
      return false;
    }
    seen.add(id);
    return true;
  });
  return { records: uniqueRecords, duplicateCount };
}

const POSTING_COUNTRY_NAMES = (() => {
  const countries = {};
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        if (['EU', 'EZ', 'UN', 'XA', 'XB'].includes(code)) continue;
        const name = displayNames.of(code);
        if (name && name !== code && !/^Unknown Region/i.test(name)) {
          countries[code] = name;
          countries[name.toUpperCase()] = name;
        }
      }
    }
  } catch {}
  return Object.freeze({
    ...countries,
    US: 'United States', USA: 'United States', 'UNITED STATES': 'United States',
    GB: 'United Kingdom', GBR: 'United Kingdom', UK: 'United Kingdom', 'UNITED KINGDOM': 'United Kingdom',
    HK: 'Hong Kong', HKG: 'Hong Kong', 'HONG KONG': 'Hong Kong',
    AE: 'United Arab Emirates', ARE: 'United Arab Emirates', UAE: 'United Arab Emirates', 'UNITED ARAB EMIRATES': 'United Arab Emirates',
  });
})();

const CURRENT_ISO_ALPHA2_CODES = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

// The frozen shadow preserves its observed location tokens. Translate only
// proven customer aliases; an unsupported country must fail closed to no rows.
const CURATED_SHADOW_COUNTRY_TOKENS = Object.freeze({
  'United States': 'USA',
  'Hong Kong': 'HKG',
});

function postingCountryName(value) {
  const raw = cleanExactText(value, 100);
  if (!raw) return null;
  const candidate = raw.split(',').at(-1).trim().toUpperCase();
  return POSTING_COUNTRY_NAMES[candidate] || null;
}

function databasePostingCountryToken(country) {
  const canonical = postingCountryName(country);
  const tokens = {
    'United States': ', US',
    'United Kingdom': ', UK',
    'Hong Kong': 'Hong Kong',
    'United Arab Emirates': 'UAE',
  };
  if (!canonical) return null;
  if (tokens[canonical]) return tokens[canonical];
  const alpha2 = Object.entries(POSTING_COUNTRY_NAMES)
    .find(([key, name]) => CURRENT_ISO_ALPHA2_CODES.has(key) && name === canonical)?.[0];
  return alpha2 ? `, ${alpha2}` : null;
}

const DATE_WINDOWS = Object.freeze({
  '1D': 1,
  '7D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
});

function dateWindowStart(value, now = new Date()) {
  const days = DATE_WINDOWS[cleanExactText(value, 4).toUpperCase()];
  if (!days || Number.isNaN(now.getTime())) return null;
  return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString();
}

function isSourceBackedRatedDealer(record) {
  const rating = Number(record?.seller_rating);
  const reviews = Number(record?.seller_review_count);
  const scored = record?.seller_rating_evidence_status === 'SOURCE_SUPPLIED'
    && Number.isFinite(rating) && rating > 0;
  const feedbackBacked = record?.seller_rating_evidence_status === 'SOURCE_FEEDBACK_COUNT';
  return (scored || feedbackBacked) && Number.isFinite(reviews) && reviews > 0;
}

function ratingMatches(record, requestedRating) {
  const filter = cleanExactText(requestedRating, 12).toLowerCase();
  if (!filter) return true;
  const rated = isSourceBackedRatedDealer(record);
  return filter === 'rated' ? rated : filter === 'unrated' ? !rated : false;
}

function isPriorityHumanReviewBrand(value) {
  const brand = cleanExactText(value, 80).toUpperCase();
  return brand === 'ROLEX'
    || brand === 'PATEK PHILIPPE'
    || brand === 'PATEK'
    || brand === 'AUDEMARS PIGUET'
    || brand === 'RICHARD MILLE'
    || brand === 'CARTIER'
    || brand === 'ZENITH'
    || brand === 'VACHERON CONSTANTIN';
}

function searchTermsMatch(record, query) {
  const normalizeSearchText = value => String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = safeSearchTerm(query).toLowerCase().split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeSearchText([
    record.brand,
    record.model,
    record.reference,
    record.dial_color,
    record.seller_name,
    record.seller_phone,
    record.location,
    record.raw_message,
  ].filter(Boolean).join(' '));
  const compactHaystack = haystack.replace(/\s+/g, '');
  return tokens.every(token => haystack.includes(token) || compactHaystack.includes(token.replace(/\s+/g, '')));
}

function recordEvidenceCoverage({
  brand,
  model,
  reference,
  dialColor,
  sellerName,
  sellerPhone,
  contactApproved,
  exactImageUrl,
  sourceAmount,
  sourceCurrency,
  hasCompleteIdentity,
  invalidReferenceReason,
  priceEligible,
}) {
  const identity = { brand, model, reference, dial_color: dialColor };
  const presentFields = Object.entries(identity)
    .filter(([, value]) => evidenceValuePresent(value))
    .map(([field]) => field);
  const missingFields = Object.keys(identity).filter(field => !presentFields.includes(field));
  return {
    identity: {
      complete: hasCompleteIdentity,
      present_fields: presentFields,
      missing_fields: missingFields,
      invalid_reference_reason: invalidReferenceReason,
    },
    contact: {
      name_present: evidenceValuePresent(sellerName),
      phone_present: evidenceValuePresent(sellerPhone),
      publication_approved: contactApproved,
      available: evidenceValuePresent(sellerPhone),
    },
    image: {
      available: exactImageUrl !== null,
      provenance: exactImageUrl ? 'EXACT_SOURCE_URL' : 'NONE',
    },
    price: {
      source_amount_present: sourceAmount !== null,
      source_currency_present: evidenceValuePresent(sourceCurrency),
      analytics_eligible: priceEligible,
    },
  };
}

function summarizeCoverage(records) {
  const totals = {
    scope: 'returned_page',
    record_count: records.length,
    identity_complete: 0,
    contact_available: 0,
    exact_source_image: 0,
    supplied_price: 0,
    price_not_supplied: 0,
    price_analytics_eligible: 0,
  };
  for (const record of records) {
    totals.identity_complete += Number(record.evidence_coverage.identity.complete);
    totals.contact_available += Number(record.evidence_coverage.contact.available);
    totals.exact_source_image += Number(record.evidence_coverage.image.available);
    totals.supplied_price += Number(Boolean(hasUsableSourcePrice(record)));
    totals.price_not_supplied += Number(!hasUsableSourcePrice(record));
    totals.price_analytics_eligible += Number(record.evidence_coverage.price.analytics_eligible);
  }
  return totals;
}

function hasUsableSourcePrice(record) {
  return positiveNumber(record?.source_price_amount)
    ?? positiveNumber(record?.price_raw)
    ?? positiveNumber(record?.price_usd)
    ?? null;
}

function hasExactSourceImage(record) {
  if (record?.multi_listing === true || record?.is_unbundled_child === true) return false;
  const evidence = cleanExactText(record?.image_evidence_type, 40).toUpperCase();
  const sourceBacked = ['SELLER_LISTING_IMAGE', 'SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'].includes(evidence)
    || record?.has_exact_source_image === true;
  const urls = [record?.thumbnail_url, ...(Array.isArray(record?.image_urls) ? record.image_urls : [])];
  return sourceBacked && urls.some(value => exactHttpUrl(value));
}

function dealerEvidenceRank(record) {
  const reviewCount = Number(record?.seller_review_count || 0);
  const rating = positiveNumber(record?.seller_rating);
  const ratingStatus = cleanExactText(record?.seller_rating_evidence_status, 40).toUpperCase();
  if (rating !== null && reviewCount > 0
    && ['SOURCE_SUPPLIED', 'SOURCE_FEEDBACK_COUNT'].includes(ratingStatus)) return 2;
  if (evidenceValuePresent(record?.dealer_id) && evidenceValuePresent(record?.dealer_profile_path)) return 1;
  return 0;
}

function hasVerifiedExplicitPrice(record) {
  const status = cleanExactText(record?.price_evidence_status, 60).toUpperCase();
  return record?.price_research_eligible === true
    && ['SOURCE_EXPLICIT_USD_MATCH', 'SOURCE_EXPLICIT_USD_USDT', 'EXPLICIT_SOURCE_FX_CONVERTED', 'DATED_VERIFIED_FX'].includes(status)
    && hasUsableSourcePrice(record) !== null;
}

function reviewedOverlayCursorState({
  requestedDeltaOffset,
  reviewedOverlayTotal,
  reviewedOverlayConsumed,
  canonicalBaseHasMore,
  canonicalBaseRecordCount,
}) {
  const laneActive = Number(requestedDeltaOffset) < Number(reviewedOverlayTotal);
  const overlayHasMore = laneActive
    && Number(requestedDeltaOffset) + Number(reviewedOverlayConsumed) < Number(reviewedOverlayTotal);
  return {
    laneActive,
    overlayHasMore,
    hasMore: laneActive
      ? overlayHasMore || Boolean(canonicalBaseHasMore) || Number(canonicalBaseRecordCount) > 0
      : Boolean(canonicalBaseHasMore),
  };
}

function excludeReviewedOverlayExactLineage(records, reviewedExactKeys, privateExactKeysById = new Map()) {
  if (!(reviewedExactKeys instanceof Set) || reviewedExactKeys.size === 0) return records;
  return (records || []).filter(record =>
    !(privateExactKeysById.get(String(record?.id)) || overlayExactKeys(record))
      .some(key => reviewedExactKeys.has(key)));
}

function listingCompletenessScore(record) {
  return [
    record?.brand, record?.model, record?.reference, record?.dial_color,
    record?.condition, record?.listing_date || record?.created_at,
    record?.seller_name, record?.location, record?.raw_message,
  ].reduce((score, value) => score + Number(evidenceValuePresent(value)), 0);
}

function isExplicitlyReleasedMultiListing(row) {
  const status = cleanExactText(row?.trading_floor_status || row?.listing_status, 60).toUpperCase();
  const qnsaReleased = row?.publication_lane === 'QNSA_EXPLICIT_MULTI_RELEASE_V1'
    && row?.publication_state === 'APPROVED'
    && row?.normalization_run_complete === true
    && row?.raw_lineage_verified === true
    && ['PUBLISHED_MULTI_LISTING', 'PUBLISHED_BUNDLE'].includes(status);
  const workbookParentReleased = row?.publication_lane === MULTI_PARENT_PUBLICATION_LANE
    && cleanExactText(row?.verification_status || row?.verdict, 80).toUpperCase()
      === MULTI_PARENT_VERIFICATION_STATUS
    && cleanExactText(row?.listing_type, 30).toUpperCase() === 'MULTI'
    && row?.publication_state === 'APPROVED'
    && row?.raw_lineage_verified === true
    && status === 'PUBLISHED_MULTI_LISTING';
  return qnsaReleased || workbookParentReleased;
}

function inventoryIdentityKey(record) {
  const brand = cleanExactText(record?.brand || record?.canonical_brand || record?.supplied_brand, 80)
    .toUpperCase();
  const reference = referenceComparisonKey(
    record?.reference || record?.normalized_reference || record?.catalog_reference,
  );
  const model = cleanExactText(record?.model || record?.catalog_model, 120).toUpperCase();
  return `${brand}\u001f${reference || model}`;
}

function inventoryIntentRank(record) {
  const intent = cleanExactText(record?.listing_type || record?.intent, 30).toUpperCase();
  if (['WTS', 'SELL', 'FOR SALE', 'AVAILABLE', 'FS'].includes(intent)) return 2;
  if (['WTB', 'BUY', 'WANT', 'WANTED', 'LOOKING TO BUY'].includes(intent)) return 1;
  return 0;
}

function compareInventoryForDisplay(left, right) {
  // This is deliberately a page-local presentation rank inside the already-bounded
  // server page. Cursor/keyset membership and advancement remain controlled
  // by the database source, so sparse cards are never discarded or skipped.
  // It is not a global ordering guarantee. QNSA globally guarantees only its
  // indexed image lanes; dealer enrichment happens after the bounded read.
  const releasedMultiDifference = Number(left?.multi_listing_release_approved === true)
    - Number(right?.multi_listing_release_approved === true);
  if (releasedMultiDifference !== 0) return releasedMultiDifference;
  const imageDifference = Number(hasExactSourceImage(right)) - Number(hasExactSourceImage(left));
  if (imageDifference !== 0) return imageDifference;

  const rightDate = Date.parse(right?.listing_date || right?.created_at || '') || 0;
  const leftDate = Date.parse(left?.listing_date || left?.created_at || '') || 0;
  if (rightDate !== leftDate) return rightDate - leftDate;

  // Keep buyer demand visibly separate from sell inventory inside both the
  // image-backed and no-image lanes. This remains page-local and cannot alter
  // cursor membership or suppress a valid listing.
  const intentDifference = inventoryIntentRank(right) - inventoryIntentRank(left);
  if (intentDifference !== 0) return intentDifference;
  const dealerDifference = dealerEvidenceRank(right) - dealerEvidenceRank(left);
  if (dealerDifference !== 0) return dealerDifference;
  const priceDifference = Number(hasVerifiedExplicitPrice(right))
    - Number(hasVerifiedExplicitPrice(left));
  if (priceDifference !== 0) return priceDifference;
  const completenessDifference = listingCompletenessScore(right) - listingCompletenessScore(left);
  if (completenessDifference !== 0) return completenessDifference;

  return String(right?.id || '').localeCompare(String(left?.id || ''));
}

function isApprovedInventoryRecord(record) {
  const storedConfidence = Number(record?.confidence);
  const confidence = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const status = String(record?.listing_status || '').trim().toUpperCase();
  return String(record?.verdict || '').trim().toUpperCase() === 'APPROVED'
    && Number.isFinite(confidence)
    && confidence >= 90
    && !['BUNDLE_CHILD_PENDING_REVIEW', 'BUNDLE_PENDING_SEPARATION', 'SUPPRESSED_EXACT_DUPLICATE', 'HIDDEN', 'REJECTED', 'DELETED'].includes(status);
}

function normalizeItemCategory(value) {
  const category = cleanExactText(value, 30).toUpperCase();
  return ['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY', 'OTHER'].includes(category)
    ? category
    : 'OTHER';
}

// Older reviewed rows predate item_category and were emitted as OTHER. Recover
// WATCH only from a watch-exclusive brand plus a source-backed reference. Do
// not infer cross-category houses (Cartier, Bulgari, Chanel, Hermes, Chopard),
// because their brand/reference fields can describe jewelry or leather goods.
const WATCH_EXCLUSIVE_BRANDS = new Set([
  'ROLEX', 'PATEK PHILIPPE', 'PATEK', 'AUDEMARS PIGUET', 'RICHARD MILLE',
  'HUBLOT', 'OMEGA', 'VACHERON CONSTANTIN', 'JAEGER-LECOULTRE', 'IWC',
  'A. LANGE & SOHNE', 'A. LANGE & SÖHNE', 'BREGUET', 'BLANCPAIN', 'TUDOR',
  'BREITLING', 'TAG HEUER', 'PANERAI', 'GRAND SEIKO', 'SEIKO', 'ORIS',
  'ZENITH', 'ROGER DUBUIS', 'URWERK', 'MB&F', 'F.P. JOURNE',
  'FP JOURNE', 'H. MOSER & CIE', 'GREUBEL FORSEY', 'JACOB & CO',
]);

function effectiveItemCategory(row) {
  const watchPart = classifyWatchPartListing(row);
  if (watchPart) return watchPart.category;
  const explicit = normalizeItemCategory(row?.item_category || row?.category);
  if (explicit !== 'OTHER') return explicit;
  const brand = cleanExactText(
    row?.canonical_brand || row?.supplied_brand || row?.brand_scope || row?.brand,
    80,
  ).toUpperCase();
  const reference = cleanExactText(
    row?.catalog_reference || row?.normalized_reference || row?.raw_reference || row?.reference,
    80,
  );
  return WATCH_EXCLUSIVE_BRANDS.has(brand) && reference ? 'WATCH' : 'OTHER';
}

function hasObviousCrossBrandConflict(row) {
  const brand = cleanExactText(row?.canonical_brand || row?.supplied_brand || row?.brand_scope, 80).toUpperCase();
  const raw = String(row?.raw_message || '').toLowerCase();
  if (!raw) return false;
  const explicitlyPatek = /\b(?:patek|philippe)\b/i.test(raw);
  const explicitlyRolex = /\brolex\b/i.test(raw);
  if (brand === 'PATEK PHILIPPE') {
    return !explicitlyPatek && /\b(?:vacheron|rolex|audemars|cartier|omega|hublot)\b|\brichard\s+mille\b/i.test(raw);
  }
  if (brand === 'ROLEX') {
    return !explicitlyRolex && /\b(?:patek|vacheron|audemars|cartier|omega|hublot)\b|\brichard\s+mille\b/i.test(raw);
  }
  return false;
}

function isTradingFloorSourceRow(row) {
  const itemCategory = effectiveItemCategory(row);
  const status = cleanExactText(row?.trading_floor_status || row?.listing_status, 60).toUpperCase();
  const decision = cleanExactText(row?.verdict || row?.verification_status, 80).toUpperCase();
  if (!['WATCH', 'HANDBAG', 'JEWELRY', 'ACCESSORY'].includes(itemCategory)) return false;
  if (['REJECTED', 'HIDDEN', 'DELETED', 'ARCHIVED'].includes(decision)) return false;
  const explicitlyReleasedMultiListing = isExplicitlyReleasedMultiListing(row);
  if (explicitlyReleasedMultiListing) return true;
  const multiListing = isMultiListing(row);
  if (multiListing) return false;
  const sourceAmount = positiveNumber(row?.source_price_amount)
    ?? positiveNumber(row?.price_raw);
  const resolvedIntent = resolveTradingIntent({
    rawMessage: row?.raw_message,
    structuredIntent: row?.listing_type,
    hasSourcePrice: hasValidIntentPrice(row, sourceAmount),
    eligibleSingleWatch: itemCategory === 'WATCH',
  });
  if (!isPublicTradingIntent(resolvedIntent.intent)) return false;
  if (hasObviousCrossBrandConflict(row)) return false;
  const isUnbundledChild = evidenceValuePresent(row?.parent_id)
    || evidenceValuePresent(row?.parent_source_message_id)
    || cleanExactText(row?.verification_tier, 80).toUpperCase() === 'OWNER_UNBUNDLED_ADMISSION_LEDGER';
  const storedConfidence = Number(row?.confidence);
  const confidencePercent = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const exactReviewedChild = isUnbundledChild
    && row?.is_bundle !== true
    && row?.raw_lineage_verified === true
    && row?.normalization_run_complete === true
    && Number.isFinite(confidencePercent)
    && confidencePercent >= 90;
  if ((row?.is_bundle === true || (isUnbundledChild && !exactReviewedChild))
    && !explicitlyReleasedMultiListing) return false;
  if (['BUNDLE_CHILD_PENDING_REVIEW', 'BUNDLE_PENDING_SEPARATION', 'SUPPRESSED_EXACT_DUPLICATE', 'HIDDEN', 'REJECTED', 'DELETED', 'ARCHIVED'].includes(status)) {
    return false;
  }
  if (isApprovedInventoryRecord({
    verdict: row?.verdict || row?.verification_status,
    confidence: row?.confidence,
    listing_status: status,
  })) {
    return true;
  }
  const reviewedQnsaRelease = [
    'QNSA_ROLEX_PATEK_REVIEWED_V1',
    'QNSA_GENERAL_MARKET_FEED_V1',
    'QNSA_NON_WATCH_FEED_V1',
    'QNSA_REVIEWED_LATER_BRAND_V1',
    'QNSA_SIX_BRAND_IMAGE_LANE_V1',
    'QNSA_ZENITH_REVIEWED_V1',
    'QNSA_VACHERON_OVERSEAS_RELEASE_V1',
    'QNSA_OMEGA_RELEASE_V1',
    'QNSA_TUDOR_RELEASE_V1',
    'QNSA_CARTIER_RELEASE_V1',
  ]
    .includes(row?.publication_lane)
    && row?.normalization_run_complete === true
    && row?.raw_lineage_verified === true
    && ['APPROVED', 'PENDING_VERIFICATION'].includes(row?.publication_state);
  const pendingCategoryEligible = itemCategory === 'WATCH'
    ? isPriorityHumanReviewBrand(row?.canonical_brand || row?.supplied_brand || row?.brand_scope)
    : true;
  return pendingCategoryEligible && (reviewedQnsaRelease || (
    status === 'PUBLISHED_PENDING_VERIFICATION'
    && row?.publication_lane === 'QNSA_NORMALIZED_STAGING_V1'
    && row?.normalization_run_complete === true
    && row?.raw_lineage_verified === true
    && row?.publication_state === 'PENDING_VERIFICATION'
  ));
}

function mapDealerSubmission(row) {
  const claimed = row.claimed_fields || {};
  const multiListing = claimed.is_bundle === true;
  const imageUrls = (row.image_urls || []).filter(value => exactHttpUrl(value));
  const priceRaw = positiveNumber(claimed.price_amount);
  const currency = cleanExactText(claimed.currency, 12).toUpperCase() || null;
  const priceUsd = currency === 'USD' ? priceRaw : null;
  const brand = cleanExactText(claimed.brand, 80) || null;
  const model = cleanExactText(claimed.model, 120) || cleanExactText(claimed.title, 240) || null;
  const reference = cleanExactText(claimed.reference, 80) || null;
  const watchPart = classifyWatchPartListing({
    item_category: row.category,
    raw_message: row.raw_message,
  });
  const itemCategory = watchPart?.category || normalizeItemCategory(row.category);
  const correctedWatchFields = itemCategory === 'WATCH'
    ? normalizeWatchConditionFields({
        dial_color: cleanExactText(claimed.dial_color, 80),
        condition: claimed.condition,
        raw_message: row.raw_message,
      })
    : { dial_color: cleanExactText(claimed.dial_color, 80) || null, condition: claimed.condition || null };
  const dialColor = correctedWatchFields.dial_color;
  const sellerName = cleanExactText(claimed.poster_name, 160) || null;
  const contactApproved = claimed.contact_publication_approved === true;
  const sellerPhone = contactApproved ? (cleanExactText(claimed.poster_phone, 50) || null) : null;
  const hasCompleteIdentity = itemCategory !== 'WATCH' || Boolean(brand && model && reference && dialColor);
  const priceEligible = itemCategory === 'WATCH' && hasCompleteIdentity && priceUsd !== null;
  const watchPartIdentity = watchPart ? {
    brand,
    model: watchPart.item_type,
    luxury_item_name: [brand, watchPart.item_type].filter(Boolean).join(' ') || watchPart.item_type,
    luxury_item_type: watchPart.item_type,
    source_item_description: row.raw_message || null,
    maker_evidence_status: brand ? 'SOURCE_OR_SIGNATURE_EVIDENCE' : 'MISSING_REVIEW_REQUIRED',
  } : null;
  const luxuryIdentity = itemCategory === 'WATCH' ? null : (watchPartIdentity || normalizeLuxuryIdentity({
    raw_message: row.raw_message,
    raw_data: { brand, model, title: claimed.title, reference },
  }, itemCategory));
  const luxuryEligibility = itemCategory === 'WATCH' ? null : watchPart
    ? { eligible: true, reasons: [] }
    : luxuryIdentityEligibility({
    raw_message: row.raw_message,
    raw_data: { brand, model, title: claimed.title, reference },
  }, itemCategory);
  const evidenceCoverage = recordEvidenceCoverage({
    brand, model, reference, dialColor, sellerName, sellerPhone,
    contactApproved, exactImageUrl: imageUrls[0] || null,
    sourceAmount: priceRaw, sourceCurrency: currency, hasCompleteIdentity,
    invalidReferenceReason: null, priceEligible,
  });
  return {
    id: row.id, brand: luxuryIdentity?.brand || brand, model: luxuryIdentity?.model || model, reference,
    luxury_item_name: luxuryIdentity?.luxury_item_name || null,
    luxury_item_type: luxuryIdentity?.luxury_item_type || null,
    luxury_identity_eligible: luxuryEligibility?.eligible ?? true,
    luxury_identity_review_reasons: luxuryEligibility?.reasons || [],
    reference_search_key: reference ? referenceComparisonKey(reference) : null,
    raw_reference: reference, normalized_reference: reference, catalog_reference: null,
    reference_invalid_reason: null, has_complete_identity: hasCompleteIdentity,
    dial_color: dialColor, condition: correctedWatchFields.condition,
    listing_type: row.intent, listing_date: row.created_at, created_at: row.created_at,
    raw_message: redactPublicSource(row.raw_message), raw_message_scope: 'stored_source_message',
    raw_message_evidence_type: 'USER_ENTERED_SOURCE_MESSAGE',
    seller_name: sellerName, seller_phone: sellerPhone, seller_avatar_url: row.poster_image_url || null,
    // Internal join hint only. `enrichRecordsWithDealerDirectory` removes it
    // before the customer response and publishes a dealer_id/profile only
    // when the authenticated submission owner resolves to a verified dealer.
    source_dealer_id: evidenceValuePresent(row.dealer_id) ? row.dealer_id : null,
    seller_rating: positiveNumber(claimed.dealer_rating),
    seller_review_count: Number(claimed.review_count || 0),
    seller_rating_evidence_status: positiveNumber(claimed.dealer_rating) !== null && Number(claimed.review_count || 0) > 0
      ? 'SOURCE_SUPPLIED'
      : 'UNAVAILABLE',
    seller_group_count: Number(claimed.group_count || 0),
    seller_credential_status: cleanExactText(claimed.credential_status, 30) || null,
    contact_publication_approved: contactApproved, price_usd: priceUsd, price_raw: priceRaw,
    currency, workbook_price_usd: null, workbook_price_review_reason: null,
    source_price_amount: priceRaw, source_price_text: priceRaw == null ? null : String(priceRaw),
    source_currency: currency, price_evidence_status: priceEligible ? EXPLICIT_USD_STATUS : priceRaw == null ? 'NO_PRICE_SUPPLIED' : 'NON_USD_USER_SUPPLIED',
    price_research_eligible: priceEligible, confidence: 1, verdict: row.review_status,
    listing_status: row.publication_status, source: 'AUTHENTICATED_USER_FORM',
    source_type: 'authenticated_user_form', source_file: null, source_row_number: null,
    source_record_id: row.id, item_category: itemCategory,
    watch_part_classification_reason: watchPart?.reason || null,
    multi_listing: multiListing,
    is_unbundled_child: false,
    has_images: !multiListing && imageUrls.length > 0,
    thumbnail_url: multiListing ? null : (imageUrls[0] || null),
    image_urls: multiListing ? [] : imageUrls,
    image_evidence_type: multiListing ? 'NO_IMAGE' : 'SOURCE_LISTING_IMAGE',
    image_evidence_label: multiListing ? null : 'Posting-user supplied item image',
    image_evidence_notice: multiListing
      ? 'A multi-item source image is withheld until each item is separated and verified.'
      : 'Photo supplied directly with this authenticated post.',
    location: claimed.location || null, evidence_coverage: evidenceCoverage,
  };
}

function directSubmissionMatches(record, filters) {
  if (filters.itemCategory && filters.itemCategory !== 'ALL' && record.item_category !== filters.itemCategory) return false;
  if (filters.imagesOnly && !record.has_images) return false;
  if (filters.pricedOnly && record.price_raw == null) return false;
  if (filters.listingType && record.listing_type !== filters.listingType) return false;
  if (filters.brand && record.brand?.toLowerCase() !== filters.brand.toLowerCase()) return false;
  if (filters.model && record.model?.toLowerCase() !== filters.model.toLowerCase()) return false;
  if (filters.reference && record.reference_search_key !== filters.reference) return false;
  if (filters.dial && record.dial_color?.toLowerCase() !== filters.dial.toLowerCase()) return false;
  if (filters.condition && record.condition?.toLowerCase() !== filters.condition.toLowerCase()) return false;
  if (filters.region) {
    if (!locationMatches(record.location, filters.region)) return false;
  }
  if (!ratingMatches(record, filters.rating)) return false;
  if (filters.postedAfter && new Date(record.listing_date || record.created_at || 0).getTime() < new Date(filters.postedAfter).getTime()) return false;
  if (filters.search) {
    if (!searchTermsMatch(record, filters.search)) return false;
  }
  return true;
}

function directSubmissionMatchesImageLane(record, lane) {
  return lane === 'images' ? record.has_images === true : record.has_images === false;
}

async function enrichRecordsWithDealerDirectory(client, records = []) {
  const recordsWithoutJoinHints = records.map(record => {
    const { source_dealer_id: _sourceDealerId, ...publicRecord } = record;
    if (publicRecord.contact_publication_approved === true) return publicRecord;
    return {
      ...publicRecord,
      seller_phone: null,
      phone_number: null,
      from_number: null,
    };
  });
  const ids = [...new Set(records.map(record => String(record?.id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return recordsWithoutJoinHints;
  // The admission importer owns this stable text prefix. All other IDs stay
  // on the established listing ledger path (whose deployed schema validates
  // its UUID type) so legacy/test adapters are not rerouted accidentally.
  const reviewedIds = ids.filter(id => id.startsWith('admission_') || id.startsWith('rpdelta_'));
  const uuidIds = ids.filter(id => !reviewedIds.includes(id));
  const verifiedLinks = [];
  if (uuidIds.length) {
    const { data: links, error: linkError } = await client
      .from('dealer_listing_links')
      .select('listing_id,dealer_id,link_method')
      .eq('link_status', 'APPLIED')
      .in('listing_id', uuidIds);
    if (!linkError && Array.isArray(links)) verifiedLinks.push(...links);
  }
  if (reviewedIds.length) {
    // Reviewed admission IDs are text, so they cannot enter the UUID link
    // ledger. This private sidecar is optional/fail-closed: a missing table or
    // lookup error leaves the listing visible without dealer evidence.
    const { data: reviewedLinks, error: reviewedLinkError } = await client
      .from('reviewed_workbook_dealer_links')
      .select('reviewed_listing_id,dealer_id,link_method')
      .eq('link_status', 'APPLIED')
      .in('reviewed_listing_id', reviewedIds);
    if (!reviewedLinkError && Array.isArray(reviewedLinks)) {
      verifiedLinks.push(...reviewedLinks.map(link => ({
        listing_id: link.reviewed_listing_id,
        dealer_id: link.dealer_id,
        link_method: link.link_method,
      })));
    }
  }
  const sourceDealerIds = records
    .map(record => String(record?.source_dealer_id || '').trim())
    .filter(Boolean);
  const dealerIds = [...new Set([
    ...verifiedLinks.map(link => String(link.dealer_id || '')).filter(Boolean),
    ...sourceDealerIds,
  ])];
  if (dealerIds.length === 0) return recordsWithoutJoinHints;
  const { data: dealers, error: dealerError } = await client
    .from('dealers')
    .select('id,display_name,company_name,country_code,city,rating,review_count,whatsapp_group_count,status')
    .eq('status', 'VERIFIED')
    .in('id', dealerIds);
  if (dealerError || !Array.isArray(dealers)) return recordsWithoutJoinHints;
  const dealerById = new Map(dealers.map(dealer => [String(dealer.id), dealer]));
  const dealerIdByListing = new Map(verifiedLinks
    .map(link => [String(link.listing_id), String(link.dealer_id)]));
  const linkMethodByListing = new Map(verifiedLinks
    .map(link => [String(link.listing_id), String(link.link_method || 'EXACT_VERIFIED_PHONE')]));
  return records.map(record => {
    const { source_dealer_id: sourceDealerId, ...publicRecord } = record;
    if (publicRecord.contact_publication_approved !== true) {
      publicRecord.seller_phone = null;
      publicRecord.phone_number = null;
      publicRecord.from_number = null;
    }
    const dealerId = String(sourceDealerId || '').trim()
      || dealerIdByListing.get(String(record.id));
    const dealer = dealerById.get(dealerId);
    if (!dealer) return publicRecord;
    const reviewCount = Math.max(0, Number(dealer.review_count || 0));
    const numericRating = positiveNumber(dealer.rating);
    const ratingStatus = numericRating !== null && reviewCount > 0
      ? 'SOURCE_SUPPLIED'
      : reviewCount > 0 ? 'SOURCE_FEEDBACK_COUNT' : 'UNAVAILABLE';
    return {
      ...publicRecord,
      source_seller_name: publicRecord.seller_name || null,
      seller_name: dealer.display_name || publicRecord.seller_name || null,
      dealer_id: dealer.id,
      dealer_display_name: dealer.display_name || null,
      dealer_company_name: dealer.company_name || null,
      dealer_country_code: dealer.country_code || null,
      dealer_city: dealer.city || null,
      dealer_profile_path: `/reference-check/${dealer.id}`,
      seller_rating: ratingStatus === 'SOURCE_SUPPLIED' ? numericRating : null,
      seller_review_count: reviewCount,
      seller_rating_evidence_status: ratingStatus,
      seller_group_count: Math.max(0, Number(dealer.whatsapp_group_count || 0)),
      seller_rating_source_url: null,
      dealer_directory_link_status: linkMethodByListing.get(String(record.id))
        || (sourceDealerId ? 'AUTHENTICATED_SUBMISSION' : 'EXACT_VERIFIED_PHONE'),
    };
  });
}

function mapReviewedRecord(row) {
  row = applyEffectivePrice(row);
  const rmMyrPriceArtifact = rmReferenceIsMyrPriceArtifact(
    row.normalized_reference || row.raw_reference || row.catalog_reference,
    row.source_price_amount,
    row.source_currency,
    row.raw_message,
  );
  // Inspect all candidate image URL fields from source/view data
  const candidateImageUrl = row.user_image_url
    || (row.has_exact_source_image === true ? (
      row.image_url
      || row.thumbnail_url
      || (Array.isArray(row.image_urls) ? row.image_urls.find(u => Boolean(u && /^https?:\/\/[^\s]+$/i.test(String(u).trim()))) : null)
    ) : null)
    || null;
  const hasExactSourceImage = Boolean(candidateImageUrl)
    && String(candidateImageUrl).trim().length > 0
    && /^https?:\/\/[^\s]+$/i.test(String(candidateImageUrl).trim());
  const hasVerifiedUsdPrice = !rmMyrPriceArtifact && row.has_verified_usd_price === true
    && row.verified_price_usd > 0;
  const verifiedPriceUsd = hasVerifiedUsdPrice ? row.verified_price_usd : null;

  // Preserve valid HTTP(S) source image URL
  const exactImageUrl = hasExactSourceImage
    ? String(candidateImageUrl).trim()
    : null;
  const contactApproved = row.contact_publication_approved === true;
  const sourceAmount = rmMyrPriceArtifact ? null : positiveNumber(row.source_price_amount);
  const sourceCurrency = rmMyrPriceArtifact ? null : (row.source_currency || null);
  const workbookUsd = positiveNumber(row.workbook_price_usd);
  const workbookPriceReview = workbookPriceReviewReason(row.workbook_price_usd);
  const verifiedUsd = hasVerifiedUsdPrice
    ? positiveNumber(verifiedPriceUsd)
    : null;
  // A reviewed workbook anomaly must not remain available as a normalized USD
  // value through the customer API. Preserve the raw/source amount and the
  // review reason so the listing stays visible and auditable.
  const publicVerifiedUsd = workbookPriceReview ? null : verifiedUsd;
  const brand = row.supplied_brand || row.canonical_brand || row.brand_scope;
  const watchPart = classifyWatchPartListing(row);
  const itemCategory = watchPart?.category || effectiveItemCategory(row);
  const storedModel = row.model || row.catalog_model || null;
  const sourceReference = row.normalized_reference || row.raw_reference || row.catalog_reference || null;
  const catalogIdentity = sourceReference && brand ? lookupCatalog(sourceReference, brand) : null;
  const model = storedModel || (catalogIdentity?.found ? catalogIdentity.model : null) || null;
  const invalidReference = row.reference_is_price_token === true
    || referenceIsPriceToken(sourceReference, sourceAmount, sourceCurrency);
  const approvedReference = invalidReference ? null : (row.public_reference || sourceReference);
  const reference = !invalidReference
    && evidenceValuePresent(row.raw_reference)
    && referenceComparisonKey(row.raw_reference) === referenceComparisonKey(approvedReference)
    ? row.raw_reference
    : approvedReference;
  const correctedWatchFields = itemCategory === 'WATCH'
    ? normalizeWatchConditionFields({
        dial_color: row.dial_color || row.catalog_dial,
        condition: row.condition,
        raw_message: row.raw_message,
      })
    : { dial_color: row.dial_color || row.catalog_dial || null, condition: row.condition || null };
  const dialColor = correctedWatchFields.dial_color;
  const sellerName = evidenceValuePresent(row.posted_by || row.seller_name || row.from_name)
    ? (row.posted_by || row.seller_name || row.from_name)
    : null;
  const sellerPhone = contactApproved && evidenceValuePresent(row.phone_number || row.seller_phone || row.from_number)
    ? (row.phone_number || row.seller_phone || row.from_number)
    : null;
  const directRating = positiveNumber(row.dealer_rating);
  const directReviewCount = Number(row.review_count || 0);
  const publicRatedEvidence = ratedDealerEvidence({
    dealerId: row.dealer_id || row.company_id,
    phone: sellerPhone,
  });
  const ratingEvidenceStatus = directRating !== null && directReviewCount > 0
    ? 'SOURCE_SUPPLIED'
    : publicRatedEvidence?.review_count > 0
      ? 'SOURCE_FEEDBACK_COUNT'
      : 'UNAVAILABLE';
  const referenceSearchKey = row.reference_search_key
    || referenceComparisonKey(reference)
    || null;

  const locallyCompleteIdentity = [brand, storedModel, reference, dialColor]
    .every(evidenceValuePresent);
  const hasCompleteIdentity = itemCategory === 'WATCH'
    ? locallyCompleteIdentity && !invalidReference
    : true;
  const normalizedSummary = isNormalizedWorkbookSummary(row);
  const multiListing = isMultiListing(row);
  const exactReviewedMultiParent = isExactRolexPatekMultiParent(row);
  const isUnbundledChild = evidenceValuePresent(row.parent_id)
    || evidenceValuePresent(row.parent_source_message_id);
  const publicImageUrl = multiListing || isUnbundledChild ? null : exactImageUrl;
  const tradingIntent = resolveTradingIntent({
    rawMessage: row.raw_message,
    structuredIntent: row.listing_type,
    hasSourcePrice: hasValidIntentPrice(row, sourceAmount),
    eligibleSingleWatch: itemCategory === 'WATCH' && !multiListing,
  });
  const priceEvidenceStatus = cleanExactText(row.price_evidence_status, 80).toUpperCase();
  const ownerAssumedUsd = ownerAssumedDisplayPrice({
    row,
    resolvedIntent: tradingIntent.intent,
    sourceAmount,
    workbookUsd,
    priceEvidenceStatus,
    invalidReference,
    workbookPriceReview,
    rmMyrPriceArtifact,
  });
  const displayPriceUsd = publicVerifiedUsd ?? ownerAssumedUsd;
  const priceEligible = itemCategory === 'WATCH' && hasCompleteIdentity && publicVerifiedUsd !== null;
  const publicImageEvidenceType = publicImageUrl
    ? (String(row.image_evidence_type || '').toUpperCase() === 'SELLER_LISTING_IMAGE'
      ? 'SELLER_LISTING_IMAGE'
      : 'SOURCE_LISTING_IMAGE')
    : 'NO_IMAGE';
  const storedConfidence = Number(row.confidence);
  const confidencePercent = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const priorityHumanReview = isPriorityHumanReviewBrand(brand)
    && (!Number.isFinite(confidencePercent) || confidencePercent < 90
      || /(?:HUMAN|NEEDS_REVIEW|UNVERIFIED|CONFLICT)/i.test(String(row.verification_status || row.verdict || '')));
  const pendingVerification = priorityHumanReview
    || String(row.publication_state || '').toUpperCase() === 'PENDING_VERIFICATION'
    || String(row.trading_floor_status || '').toUpperCase() === 'PUBLISHED_PENDING_VERIFICATION';
  const evidenceCoverage = recordEvidenceCoverage({
    brand,
    model,
    reference,
    dialColor,
    sellerName,
    sellerPhone,
    contactApproved,
    exactImageUrl: publicImageUrl,
    sourceAmount,
    sourceCurrency,
    hasCompleteIdentity,
    invalidReferenceReason: invalidReference ? 'PRICE_CURRENCY_TOKEN' : null,
    priceEligible,
  });
  const watchPartIdentity = watchPart ? {
    brand,
    model: watchPart.item_type,
    luxury_item_name: [brand, watchPart.item_type].filter(Boolean).join(' ') || watchPart.item_type,
    luxury_item_type: watchPart.item_type,
    source_item_description: row.raw_message || null,
    maker_evidence_status: brand ? 'SOURCE_OR_SIGNATURE_EVIDENCE' : 'MISSING_REVIEW_REQUIRED',
  } : null;
  const luxuryIdentity = itemCategory === 'WATCH' ? null : (watchPartIdentity || normalizeLuxuryIdentity({
    raw_message: row.raw_message,
    raw_data: { brand, model: storedModel, title: storedModel, reference },
  }, itemCategory));
  const luxuryEligibility = itemCategory === 'WATCH' ? null : watchPart
    ? { eligible: true, reasons: [] }
    : luxuryIdentityEligibility({
    raw_message: row.raw_message,
    raw_data: { brand, model: storedModel, title: storedModel, reference },
  }, itemCategory);

  return {
    id: row.id,
    brand: luxuryIdentity?.brand || brand,
    model: luxuryIdentity?.model || model,
    luxury_item_name: luxuryIdentity?.luxury_item_name || null,
    luxury_item_type: luxuryIdentity?.luxury_item_type || null,
    source_item_description: luxuryIdentity?.source_item_description
      ? redactPublicSource(luxuryIdentity.source_item_description)
      : null,
    maker_evidence_status: luxuryIdentity?.maker_evidence_status || null,
    luxury_identity_eligible: luxuryEligibility?.eligible ?? true,
    luxury_identity_review_reasons: luxuryEligibility?.reasons || [],
    reference,
    reference_search_key: invalidReference ? null : referenceSearchKey,
    raw_reference: row.raw_reference || null,
    normalized_reference: row.normalized_reference || null,
    catalog_reference: row.catalog_reference || null,
    reference_invalid_reason: invalidReference ? 'PRICE_CURRENCY_TOKEN' : null,
    has_complete_identity: hasCompleteIdentity,
    dial_color: dialColor,
    condition: correctedWatchFields.condition,
    listing_type: exactReviewedMultiParent ? 'MULTI' : tradingIntent.intent,
    listing_type_original: exactReviewedMultiParent ? 'MULTI' : tradingIntent.original_intent,
    listing_type_provenance: exactReviewedMultiParent ? 'REVIEWED_EXACT_MULTI_PARENT' : tradingIntent.provenance,
    listing_type_inferred: exactReviewedMultiParent ? false : tradingIntent.inferred,
    listing_type_review_reason: exactReviewedMultiParent
      ? 'Exact structured multi-offer parent; singular price, identity, and media withheld.'
      : tradingIntent.review_reason,
    listing_date: row.posting_date || null,
    source_posted_at_text: evidenceValuePresent(row.source_posted_at_text)
      ? row.source_posted_at_text
      : null,
    created_at: row.posting_date || row.imported_at || null,
    raw_message: row.raw_message ? redactPublicSource(row.raw_message) : null,
    raw_message_scope: normalizedSummary ? 'normalized_summary' : 'stored_source_message',
    raw_message_evidence_type: normalizedSummary ? 'WORKBOOK_NORMALIZED_SUMMARY' : 'SOURCE_RAW_MESSAGE',
    seller_name: sellerName,
    seller_phone: sellerPhone,
    // Private exact join hint. Removed by enrichRecordsWithDealerDirectory
    // before the customer response, after resolving the canonical profile.
    source_dealer_id: evidenceValuePresent(row.dealer_id) ? row.dealer_id : null,
    seller_rating: ratingEvidenceStatus === 'SOURCE_SUPPLIED' ? directRating : null,
    seller_review_count: ratingEvidenceStatus === 'SOURCE_SUPPLIED'
      ? directReviewCount
      : publicRatedEvidence?.review_count || 0,
    seller_rating_evidence_status: ratingEvidenceStatus,
    seller_trust_status: publicRatedEvidence?.trust_status || null,
    // Legacy crawl provenance remains private; the public payload carries only
    // the source-backed rating/feedback result and canonical profile path.
    seller_rating_source_url: null,
    contact_publication_approved: contactApproved,
    price_usd: displayPriceUsd,
    effective_price_source: publicVerifiedUsd !== null
      ? (row.effective_price_source || 'VERIFIED_USD')
      : ownerAssumedUsd !== null
        ? 'OWNER_ASSUMED_USD'
        : (row.effective_price_source || null),
    price_correction_applied: row.price_correction_applied === true,
    price_correction_id: row.price_correction_id || null,
    price_correction_key: row.price_correction_key || null,
    analytics_fx_rate: row.effective_fx_rate || null,
    analytics_fx_source: row.effective_fx_source || null,
    analytics_fx_date: row.effective_fx_date || null,
    price_raw: sourceAmount,
    currency: sourceCurrency,
    workbook_price_usd: workbookUsd,
    workbook_price_review_reason: workbookPriceReview,
    source_price_amount: sourceAmount,
    source_price_text: rmMyrPriceArtifact ? null : (row.source_price_text || null),
    source_currency: sourceCurrency,
    price_evidence_status: rmMyrPriceArtifact
      ? 'REFERENCE_TOKEN_AS_PRICE'
      : ownerAssumedUsd !== null
        ? 'OWNER_ASSUMED_USD'
        : row.price_evidence_status,
    price_research_eligible: priceEligible,
    confidence: row.confidence == null ? null : Number(row.confidence),
    verdict: row.verdict || row.verification_status || null,
    listing_status: row.trading_floor_status || row.listing_status || row.verification_status || null,
    source: 'REVIEWED_WORKBOOK_INVENTORY',
    source_type: 'owner_reviewed_workbook',
    source_file: row.source_file,
    source_row_number: row.source_row_number,
    source_record_id: row.source_record_id || null,
    location: evidenceValuePresent(row.location || row.region) ? (row.location || row.region) : null,
    item_category: itemCategory,
    watch_part_classification_reason: watchPart?.reason || null,
    publication_state: row.publication_state || 'APPROVED',
    publication_lane: row.publication_lane || null,
    verification_label: 'Listing',
    data_quality_review_required: pendingVerification,
    multi_listing: multiListing,
    multi_listing_release_approved: multiListing && isExplicitlyReleasedMultiListing(row),
    is_unbundled_child: isUnbundledChild,
    has_images: publicImageUrl !== null,
    thumbnail_url: publicImageUrl,
    image_urls: publicImageUrl ? [publicImageUrl] : [],
    image_evidence_type: publicImageEvidenceType,
    image_evidence_label: publicImageUrl ? 'Source-supplied listing image' : null,
    image_evidence_notice: multiListing || isUnbundledChild
      ? 'A multi-item source image is withheld until it can be assigned to the correct child listing.'
      : publicImageUrl
      ? 'Exact image URL supplied with this source listing.'
      : null,
    evidence_coverage: evidenceCoverage,
  };
}

function parseCursorPage(value) {
  const cursor = cleanExactText(value, 80);
  if (!cursor) return null;
  if (/^[1-9]\d*$/.test(cursor)) {
    const page = Number(cursor);
    return Number.isSafeInteger(page) ? page : null;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^[1-9]\d*$/.test(decoded)) return null;
    const page = Number(decoded);
    return Number.isSafeInteger(page) ? page : null;
  } catch {
    return null;
  }
}

function parseInventoryCursor(value, pageSize) {
  // Six independently bounded brand streams need six independent keysets.
  // Keep the token self-contained and strictly validated, while allowing
  // enough room for six ISO timestamps and UUIDs.
  const cursor = cleanExactText(value, 2048);
  if (!cursor) return { lane: 'images', offset: 0, page: 1 };
  const legacyPage = parseCursorPage(cursor);
  if (legacyPage !== null) {
    return {
      lane: 'images',
      offset: (legacyPage - 1) * pageSize,
      page: legacyPage,
    };
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (decoded?.v === 3 || decoded?.v === 4) {
      const page = Number(decoded.p);
      const listingLane = decoded.v === 4 && (decoded.l === 0 || decoded.l === 1)
        ? decoded.l : null;
      const timestampIsNull = decoded.n === true;
      const timestamp = timestampIsNull ? null : new Date(decoded.t || '');
      const currentListingKey = String(decoded.k || '');
      const scope = String(decoded.s || '');
      if (!Number.isSafeInteger(page) || page < 2
        || (!timestampIsNull && Number.isNaN(timestamp.getTime()))
        || !/^[0-9a-f]{64}$/i.test(currentListingKey)
        || !/^[0-9a-f]{64}$/i.test(scope)
        || (decoded.v === 4 && listingLane === null)
        || Object.keys(decoded).some(key => !['v', 'p', 'l', 't', 'n', 'k', 's'].includes(key))) return null;
      return {
        lane: 'images', offset: 0, page,
        shadowKeyset: {
          listingLane, sourceTimestamp: timestampIsNull ? null : timestamp.toISOString(),
          currentListingKey, timestampIsNull, scope,
        },
      };
    }
    if (decoded?.v !== 1 && decoded?.v !== 2) return null;
    const lane = decoded?.l === 'i' ? 'images' : decoded?.l === 'n' ? 'no-images' : null;
    const offset = Number(decoded?.o);
    const page = Number(decoded?.p);
    const deltaOffset = decoded?.d === undefined ? offset : Number(decoded.d);
    if (!lane || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(deltaOffset) || deltaOffset < 0
      || !Number.isSafeInteger(page) || page < 1) return null;
    let keyset;
    if (decoded?.k !== undefined) {
      const createdAt = new Date(decoded?.k?.c || '');
      const id = String(decoded?.k?.i || '');
      if (typeof decoded?.k?.h !== 'boolean' || Number.isNaN(createdAt.getTime())
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
      keyset = { hasPrice: decoded.k.h, createdAt: createdAt.toISOString(), id };
    }
    let brandKeysets;
    let brandScope;
    if (decoded?.v === 2) {
      if (offset !== 0 || Object.keys(decoded).some(key =>
        !['v', 'l', 'o', 'p', 'd', 'b', 's'].includes(key))) return null;
      if (!decoded?.b || typeof decoded.b !== 'object' || Array.isArray(decoded.b)) return null;
      brandKeysets = {};
      for (const brand of SIX_REVIEWED_WATCH_BRANDS) {
        const compact = decoded.b[SIX_REVIEWED_BRAND_CURSOR_CODES[brand]];
        if (compact === undefined || compact === null) continue;
        const createdAt = new Date(compact?.c || '');
        const id = String(compact?.i || '');
        if (typeof compact?.h !== 'boolean' || Number.isNaN(createdAt.getTime())
          || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
        brandKeysets[brand] = {
          hasPrice: compact.h, createdAt: createdAt.toISOString(), id,
        };
      }
      if (Object.keys(decoded.b).some(code =>
        !Object.values(SIX_REVIEWED_BRAND_CURSOR_CODES).includes(code))) return null;
      if (decoded.s !== undefined) {
        if (!Array.isArray(decoded.s) || decoded.s.length === 0
          || new Set(decoded.s).size !== decoded.s.length
          || decoded.s.some(code => !Object.values(SIX_REVIEWED_BRAND_CURSOR_CODES).includes(code))) return null;
        brandScope = decoded.s.map(code => Object.entries(SIX_REVIEWED_BRAND_CURSOR_CODES)
          .find(([, compact]) => compact === code)?.[0]);
      }
    }
    return { lane, offset, ...(decoded?.d !== undefined ? { deltaOffset } : {}), page, ...(keyset ? { keyset } : {}),
      ...(brandKeysets ? { brandKeysets } : {}), ...(brandScope ? { brandScope } : {}) };
  } catch {
    return null;
  }
}

function encodeInventoryCursor({ lane, offset, deltaOffset = 0, page, keyset = null, brandKeysets = null, brandScope = null }) {
  const payload = {
    v: 1,
    l: lane === 'images' ? 'i' : 'n',
    // Composite streams are keyset-only. Carrying a source-row offset makes
    // the v2 token self-invalid and can skip rows after the global merge.
    o: brandKeysets ? 0 : offset,
    p: page,
  };
  if (deltaOffset > 0) payload.d = deltaOffset;
  if (brandKeysets) {
    payload.v = 2;
    payload.b = {};
    for (const brand of SIX_REVIEWED_WATCH_BRANDS) {
      const value = brandKeysets[brand];
      if (!value) continue;
      payload.b[SIX_REVIEWED_BRAND_CURSOR_CODES[brand]] = {
        h: value.hasPrice, c: value.createdAt, i: value.id,
      };
    }
    if (Array.isArray(brandScope) && brandScope.length > 0) {
      payload.s = brandScope.map(brand => SIX_REVIEWED_BRAND_CURSOR_CODES[brand]);
    }
  }
  if (keyset) payload.k = { h: keyset.hasPrice, c: keyset.createdAt, i: keyset.id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function sixBrandRowKeyset(row) {
  const createdAt = new Date(row?.posting_date || row?.imported_at || row?.created_at || '');
  const id = String(row?.id || '');
  if (Number.isNaN(createdAt.getTime())
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  return {
    hasPrice: typeof row?.has_price === 'boolean' ? row.has_price
      : positiveNumber(row?.source_price_amount) !== null
        || positiveNumber(row?.workbook_price_usd) !== null,
    createdAt: createdAt.toISOString(), id,
  };
}

function compareSixBrandKeysets(a, b) {
  if (a.hasPrice !== b.hasPrice) return Number(b.hasPrice) - Number(a.hasPrice);
  if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
  return b.id.localeCompare(a.id);
}

function compareSixBrandRows(left, right) {
  const a = sixBrandRowKeyset(left);
  const b = sixBrandRowKeyset(right);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return compareSixBrandKeysets(a, b);
}

function parseSixBrandEnvelope(payload) {
  const value = Array.isArray(payload) && payload.length === 1
    && payload[0]?.qnsa_six_brand_image_lane_page
    ? payload[0].qnsa_six_brand_image_lane_page : payload;
  if (!value || Array.isArray(value) || !Array.isArray(value.rows)
    || typeof value.has_more !== 'boolean') return null;
  if (value.has_more && !parseSixBrandKeyset(value.next_cursor)) return null;
  return value;
}

function parseSixBrandKeyset(value) {
  const createdAt = new Date(value?.created_at || value?.createdAt || '');
  const id = String(value?.id || '');
  const hasPrice = value?.has_price ?? value?.hasPrice;
  if (typeof hasPrice !== 'boolean' || Number.isNaN(createdAt.getTime())
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  return { hasPrice, createdAt: createdAt.toISOString(), id };
}

function validateSixBrandStreamEnvelope(envelope, previousKeyset = null) {
  const rowKeysets = envelope.rows.map(sixBrandRowKeyset);
  if (rowKeysets.some(value => !value)) return false;
  const ids = new Set();
  for (let index = 0; index < rowKeysets.length; index += 1) {
    const current = rowKeysets[index];
    if (ids.has(current.id)) return false;
    ids.add(current.id);
    if (previousKeyset && compareSixBrandKeysets(current, previousKeyset) <= 0) return false;
    if (index > 0 && compareSixBrandKeysets(rowKeysets[index - 1], current) >= 0) return false;
  }
  if (envelope.has_more) {
    const next = parseSixBrandKeyset(envelope.next_cursor);
    if (!next) return false;
    if (previousKeyset && compareSixBrandKeysets(next, previousKeyset) <= 0) return false;
    const last = rowKeysets.at(-1);
    if (last && compareSixBrandKeysets(next, last) < 0) return false;
  }
  return true;
}

async function refillSixBrandStream({
  brand, previousKeyset = null, pageSize, fetchWindow, maxWindows = 5,
}) {
  const rows = [];
  const seenIds = new Set();
  let cursor = previousKeyset;
  let hasMore = true;
  let scannedCount = 0;
  let windows = 0;
  let finalCursor = previousKeyset;

  while (hasMore && rows.length < pageSize && windows < maxWindows) {
    const envelope = await fetchWindow(cursor);
    if (!envelope || !validateSixBrandStreamEnvelope(envelope, cursor)) {
      throw new Error(`QNSA six-brand ${brand} returned a non-progressing envelope`);
    }
    for (const row of envelope.rows) {
      if (cleanExactText(row?.brand_scope || row?.canonical_brand, 80) !== brand
        || !sixBrandRowKeyset(row) || seenIds.has(String(row.id))) {
        throw new Error(`QNSA six-brand ${brand} returned an out-of-contract row`);
      }
      seenIds.add(String(row.id));
      rows.push(row);
    }
    windows += 1;
    scannedCount += Number(envelope.scanned_count || 0);
    hasMore = envelope.has_more === true;
    const scannedCursor = parseSixBrandKeyset(envelope.next_cursor);
    // Every returned row is retained in this per-brand buffer, so consuming
    // the RPC's exact scanned boundary before the next refill cannot skip it.
    if (scannedCursor) {
      finalCursor = scannedCursor;
      cursor = scannedCursor;
    }
  }

  return {
    brand,
    windows,
    envelope: {
      rows,
      has_more: hasMore,
      next_cursor: finalCursor ? {
        has_price: finalCursor.hasPrice,
        created_at: finalCursor.createdAt,
        id: finalCursor.id,
      } : null,
      scanned_count: scannedCount,
      eligible_count: rows.length,
    },
  };
}

function mergeSixBrandEnvelopes(entries, limit, previousKeysets = {}) {
  const taggedRows = entries.flatMap(entry => (entry.envelope?.rows || [])
    .map(row => ({ brand: entry.brand, row })))
    .sort((left, right) => compareSixBrandRows(left.row, right.row));
  const selected = taggedRows.slice(0, limit);
  const nextBrandKeysets = { ...previousKeysets };

  // Advance each stream only through the prefix actually emitted. Advancing
  // every brand to one global cutoff loses fetched-but-unselected rows.
  for (const brand of SIX_REVIEWED_WATCH_BRANDS) {
    const selectedForBrand = selected.filter(item => item.brand === brand);
    const entry = entries.find(item => item.brand === brand);
    const returnedCount = (entry?.envelope?.rows || []).length;
    const scannedCursor = parseSixBrandKeyset(entry?.envelope?.next_cursor);
    if (selectedForBrand.length) {
      // When every returned row from this stream was emitted, the RPC's
      // scanned boundary can also consume filtered candidates after that row.
      // Otherwise stop at the last emitted row so buffered rows remain.
      nextBrandKeysets[brand] = selectedForBrand.length === returnedCount && scannedCursor
        ? scannedCursor
        : sixBrandRowKeyset(selectedForBrand[selectedForBrand.length - 1].row);
      continue;
    }
    if (returnedCount === 0 && entry?.envelope?.has_more === true) {
      // A sparse bounded window may contain no eligible row. Its own cursor is
      // safe to consume because there is no buffered public row to preserve.
      if (scannedCursor) nextBrandKeysets[brand] = scannedCursor;
    }
  }
  const hasMore = taggedRows.length > limit
    || entries.some(entry => entry.envelope?.has_more === true);
  return {
    rows: selected.map(item => item.row),
    hasMore,
    nextBrandKeysets,
    selectedBrands: selected.map(item => item.brand),
  };
}

function publicationBrandsFromSummary(summary) {
  return (summary.brands || [])
    .filter(brand => summary.count_snapshot_available === false
      || Number(brand.canonical_listings || 0) > 0)
    .map(brand => brand.brand)
    .filter(Boolean);
}

function rmReferenceIsMyrPriceArtifact(reference, sourceAmount, sourceCurrency, rawMessage) {
  if (currencyComparisonKey(sourceCurrency) !== 'MYR') return false;
  const referenceKey = referenceComparisonKey(reference);
  const match = referenceKey.match(/^RM0*([1-9][0-9]{0,3})$/);
  if (!match || positiveNumber(sourceAmount) !== Number(match[1])) return false;
  const raw = cleanExactText(rawMessage, 10_000);
  if (!raw) return true;
  // Preserve genuine Malaysian-ringgit evidence only when MYR is directly
  // attached to an amount. `RM 001` is a Richard Mille reference, not a
  // Malaysian-ringgit price of 1.
  const explicitMyrAmount = /\bMYR\b\s*[:=$-]?\s*\d[\d,.]*/i.test(raw)
    || /\d[\d,.]*\s*\bMYR\b/i.test(raw);
  return !explicitMyrAmount;
}

function suppressPublicReferenceTokenPrice(record) {
  if (!rmReferenceIsMyrPriceArtifact(
    record?.reference,
    record?.source_price_amount ?? record?.price_raw,
    record?.source_currency ?? record?.currency,
    record?.raw_message,
  )) return record;
  return {
    ...record,
    price_usd: null,
    price_raw: null,
    currency: null,
    source_price_amount: null,
    source_price_text: null,
    source_currency: null,
    analytics_fx_rate: null,
    analytics_fx_source: null,
    analytics_fx_date: null,
    effective_price_source: null,
    runtime_price_recovery_applied: false,
    price_evidence_status: 'REFERENCE_TOKEN_AS_PRICE',
    price_research_eligible: false,
  };
}

function isPlausibleLaterBrandReference(brand, value) {
  const key = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!key || ['BRANDNEW', 'BREATHABLE', 'RM001EITHER'].includes(key)) return false;
  if (brand === 'Richard Mille') return /^RM[A-Z0-9]*\d[A-Z0-9]*$/.test(key);
  if (brand === 'Cartier') return /^W[A-Z0-9]*\d[A-Z0-9]*$/.test(key);
  return true;
}

function boundedPage(rows, pageSize, hasLookaheadQuery) {
  const ordered = rows || [];
  return {
    records: hasLookaheadQuery ? ordered.slice(0, pageSize) : ordered,
    hasLookahead: hasLookaheadQuery && ordered.length > pageSize,
  };
}

function unwrapRpcRowData(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => row?.row_data || row)
    .filter(Boolean);
}

function sortPageWithoutMovingLookahead(rows, pageSize, comparator) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const visibleRows = sourceRows.slice(0, pageSize).sort(comparator);
  return [...visibleRows, ...sourceRows.slice(pageSize)];
}

function sourceCursorAdvance(rawRows, directRecordCount = 0, displayedSourceCount = 0) {
  // Normal database pages advance by the source window, including rows later
  // removed by presentation filters. Direct submissions are merged only on the
  // first page; in that exceptional case retain the prior non-skipping rule so
  // displaced database rows remain reachable on the next request.
  return directRecordCount > 0
    ? Math.max(0, Number(displayedSourceCount) || 0)
    : (Array.isArray(rawRows) ? rawRows.length : 0);
}

function shouldFallbackLaterBrandCandidate(status) {
  const statusCode = Number(status);
  return [400, 404, 408].includes(statusCode)
    || (statusCode >= 500 && statusCode <= 599);
}

function isLegacyReviewedInventoryRecord(record) {
  const storedConfidence = Number(record?.confidence);
  const confidence = storedConfidence >= 0 && storedConfidence <= 1
    ? storedConfidence * 100
    : storedConfidence;
  const status = String(record?.listing_status || record?.verdict || '').trim().toUpperCase();
  const blocked = /(?:BUNDLE_CHILD_PENDING_REVIEW|BUNDLE_PENDING_SEPARATION|SUPPRESSED_EXACT_DUPLICATE|REJECTED|HIDDEN|DELETED|ARCHIVED)/.test(status);
  if (blocked) return false;
  if (Number.isFinite(confidence) && confidence >= 90) return true;
  return isPriorityHumanReviewBrand(record?.brand)
    && evidenceValuePresent(record?.reference)
    && !isMultiListing(record);
}

function buildLegacyMarketQueryParams({
  pageSize,
  offset = 0,
  imageLane = 'images',
  brand,
  requestedReference,
  exactDialVariants,
  listingType,
  imagesOnly,
  pricedOnly,
  search,
  postedAfter,
}) {
  const legacyColumns = [
    'id,source_file,source_row_number,source_record_id,posting_date,posted_by',
    'phone_number,contact_publication_approved,raw_message,listing_type,brand_scope',
    'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
    'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
    'workbook_price_usd,source_price_amount,source_price_text,source_currency',
    'price_evidence_status,confidence,verification_status,user_image_url,imported_at',
    'has_exact_source_image,verified_price_usd,has_verified_usd_price,has_complete_identity',
  ].join(',');
  const params = new URLSearchParams({
    select: legacyColumns,
    // Page each side of the image boundary independently. The production
    // expression index uses has_exact_source_image as its leading key, so an
    // equality lane plus descending ID stays indexed without an 8.5M-row sort.
    order: 'id.desc',
    limit: String(pageSize + 1),
  });
  params.set('has_exact_source_image', imageLane === 'images' ? 'eq.true' : 'eq.false');
  if (offset > 0) params.set('offset', String(offset));
  if (brand) params.set('brand_scope', `eq.${brand}`);
  if (requestedReference) {
    const exactVariants = listEquivalentReferences(requestedReference, brand || null);
    params.set('normalized_reference', `in.(${exactVariants.join(',')})`);
  }
  if (exactDialVariants.length) params.set('dial_color', `in.(${exactDialVariants.join(',')})`);
  if (listingType) params.set('listing_type', `eq.${listingType}`);
  if (imagesOnly) params.set('has_exact_source_image', 'eq.true');
  if (pricedOnly) params.set('has_supplied_price', 'eq.true');
  if (postedAfter) params.set('posting_date', `gte.${postedAfter}`);
  const genericSearch = safeSearchTerm(search);
  if (genericSearch && !genericSearch.includes(' ') && !requestedReference && !exactDialVariants.length) {
    const pattern = `*${genericSearch}*`;
    params.set('or', `(${[
      `supplied_brand.ilike.${pattern}`,
      `canonical_brand.ilike.${pattern}`,
      `brand_scope.ilike.${pattern}`,
      `model.ilike.${pattern}`,
      `catalog_model.ilike.${pattern}`,
      `raw_reference.ilike.${pattern}`,
      `normalized_reference.ilike.${pattern}`,
      `catalog_reference.ilike.${pattern}`,
      `posted_by.ilike.${pattern}`,
      `phone_number.ilike.${pattern}`,
      `raw_message.ilike.${pattern}`,
    ].join(',')})`);
  }
  return params;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Do not let an edge cache preserve an empty/transient response while the
  // underlying release database is healthy. Successful calls may be cached
  // briefly; failures are explicitly changed to no-store below.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Schema-compatibility fallback is request-local. A single malformed or
    // deployment-gap request must never poison a warm serverless instance and
    // force every later broad Trading Floor request onto the expensive joined
    // REST view. That sticky state caused intermittent empty inventory/503s.
    let legacyMarketViewContractDetected = false;
    const pagination = cleanExactText(req.query?.pagination, 20).toLowerCase();
    const requestedPageSize = Number.parseInt(
      String(req.query?.pageSize || DEFAULT_PAGE_SIZE),
      10,
    );
    // Honor the 50-card marketplace page. The old 12-row cap was applied
    // before safety filtering and produced visibly sparse Rolex/Patek pages.
    const pageSizeLimit = pagination === 'cursor' ? 50 : MAX_PAGE_SIZE;
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(Math.max(requestedPageSize, 12), pageSizeLimit)
      : Math.min(DEFAULT_PAGE_SIZE, pageSizeLimit);
    const cursorProvided = req.query?.cursor != null && String(req.query.cursor).trim() !== '';
    const inventoryCursor = pagination === 'cursor'
      ? parseInventoryCursor(req.query?.cursor, pageSize)
      : null;
    if (cursorProvided && inventoryCursor === null) {
      return res.status(400).json({ status: 'error', error: 'Invalid pagination cursor' });
    }
    const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
    const page = pagination === 'cursor' && inventoryCursor !== null
      ? inventoryCursor.page
      : (Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1);
    const search = cleanExactText(req.query?.q, 120);
    const parsedSearch = parseTradingSearch(search);
    // Only an explicit brand filter is exact. Free-text brand/model/seller terms
    // remain case-insensitive searches; parsing them as exact brand names made
    // aliases such as "patek" incorrectly exclude "Patek Philippe".
    const brandQueryValues = (Array.isArray(req.query?.brand) ? req.query.brand : [req.query?.brand])
      .map(value => cleanExactText(value, 80))
      .filter(Boolean);
    const requestedBrands = [...new Set(brandQueryValues.map(value =>
      SIX_REVIEWED_WATCH_BRANDS.find(brand => brand.toLowerCase() === value.toLowerCase()) || value))];
    const requestedBrand = requestedBrands.length === 1 ? requestedBrands[0] : '';
    const multiBrandSelection = requestedBrands.length > 1;
    const requestedModel = cleanExactText(req.query?.model, 120);
    const requestedModelReferences = requestedBrand === 'Zenith' && requestedModel
      ? listCanonicalCatalogReferences('Zenith')
        .filter(entry => entry.model === requestedModel)
        .map(entry => entry.reference)
        .slice(0, 50)
      : [];
    const requestedReference = cleanExactText(req.query?.reference || parsedSearch.reference, 80);
    const reference = referenceComparisonKey(requestedReference);
    const requestedDial = cleanExactText(req.query?.dial || parsedSearch.dial, 40);
    const exactDialVariants = requestedDial
      ? [...new Set([
          requestedDial.toLowerCase(),
          `${requestedDial[0].toUpperCase()}${requestedDial.slice(1).toLowerCase()}`,
          requestedDial.toUpperCase(),
        ])]
      : [];
    const imagesOnly = String(req.query?.images || '').toLowerCase() === 'true';
    const pricedOnly = String(req.query?.priced || '').toLowerCase() === 'true';
    const sourceShape = cleanExactText(req.query?.sourceShape, 12).toLowerCase();
    const listingLane = sourceShape === 'single' ? 0 : sourceShape === 'multi' ? 1 : null;
    if (sourceShape && listingLane === null) {
      return res.status(400).json({ status: 'error', error: 'Invalid listing source shape' });
    }
    const listingType = cleanExactText(req.query?.type, 12).toUpperCase();
    const condition = cleanExactText(req.query?.condition, 80);
    const requestedItem = cleanExactText(req.query?.item, 20).toLowerCase();
    const itemCategories = { all: 'ALL', watches: 'WATCH', handbags: 'HANDBAG', jewelry: 'JEWELRY', accessories: 'ACCESSORY', other: 'OTHER' };
    const itemCategory = requestedItem ? itemCategories[requestedItem] : 'ALL';
    const requestedRegions = (Array.isArray(req.query?.region) ? req.query.region : [req.query?.region])
      .flatMap(value => String(value || '').split(','))
      .map(value => cleanExactText(value, 100))
      .filter(Boolean);
    const resolvedRegions = requestedRegions.map(postingCountryName);
    const shadowMarketRequest = MARKET_SOURCE_VIEW === CURATED_SHADOW_MARKET_SOURCE
      && isShadowBrand(requestedBrand);
    if (requestedRegions.length && resolvedRegions.some(value => !value)) {
      return res.status(400).json({ status: 'error', error: 'Location filters must be a recognized posting country' });
    }
    if (resolvedRegions.length > 1 && !shadowMarketRequest) {
      return res.status(400).json({ status: 'error', error: 'Multiple location filters are unavailable for this source' });
    }
    const region = resolvedRegions[0] || '';
    const requestedRegion = requestedRegions.join(',');
    const databaseRegion = databasePostingCountryToken(region);
    const shadowCountryCodes = resolvedRegions.map(country =>
      CURATED_SHADOW_COUNTRY_TOKENS[country] || '__NO_MATCH__');
    const rating = cleanExactText(req.query?.rating, 12).toLowerCase();
    const dateWindow = cleanExactText(req.query?.date, 4).toUpperCase();
    const postedAfter = dateWindowStart(dateWindow);

    if (listingType && !['WTS', 'WTB', 'OTHER', 'MULTI'].includes(listingType)) {
      return res.status(400).json({ status: 'error', error: 'Invalid listing type' });
    }
    // WTS/WTB can be an owner fallback for an otherwise approved single-watch
    // row whose stored intent is missing. Fetch the bounded unresolved source
    // window and apply that policy after mapping; exact MULTI/OTHER filters can
    // still be pushed into PostgreSQL/RPCs.
    const databaseListingType = databaseTradingIntentFilter(listingType);
    if (rating && !['rated', 'unrated'].includes(rating)) {
      return res.status(400).json({ status: 'error', error: 'Invalid dealer rating filter' });
    }
    if (dateWindow && !postedAfter) {
      return res.status(400).json({ status: 'error', error: 'Invalid posting date window' });
    }
    if (multiBrandSelection) {
      const unsupportedBrands = requestedBrands.filter(brand => !SIX_REVIEWED_WATCH_BRANDS.includes(brand));
      const unsupportedFacets = [
        requestedItem !== 'watches' ? 'category (must be Watches)' : '',
        search ? 'search' : '',
        requestedModel ? 'model' : '',
        requestedReference ? 'exact reference' : '',
        requestedDial ? 'dial' : '',
        condition ? 'condition' : '',
        pricedOnly ? 'price supplied' : '',
        region ? 'location' : '',
        rating ? 'dealer rating' : '',
        dateWindow ? 'posted date' : '',
      ].filter(Boolean);
      if (unsupportedBrands.length || unsupportedFacets.length) {
        return res.status(400).json({
          status: 'error',
          error: `Multi-brand pagination currently supports released watch brands with listing type and image-only filters. ${unsupportedBrands.length ? `Unsupported brands: ${unsupportedBrands.join(', ')}. ` : ''}${unsupportedFacets.length ? `Remove: ${unsupportedFacets.join(', ')}.` : ''}`.trim(),
          pendingMigration: 'Extend qnsa_six_brand_image_lane_page with array-valued indexed predicates and bind the full facet fingerprint into its keyset cursor.',
        });
      }
    }
    if (requestedReference && !reference) {
      return res.status(400).json({ status: 'error', error: 'Invalid exact reference' });
    }
    if (condition && !(requestedBrand && reference)) {
      return res.status(400).json({
        status: 'error',
        error: 'Condition filters require an exact brand and reference until a dedicated publication index is available',
      });
    }

    if (shadowMarketRequest && ['ALL', 'WATCH'].includes(itemCategory)) {
      const client = getClient();
      const shadowOptions = {
        brand: requestedBrand,
        listingType,
        countries: shadowCountryCodes,
        pricedOnly,
        imagesOnly,
        search: requestedReference || search || requestedModel || requestedDial || null,
        reference: requestedReference || null,
        listingLane,
        page,
        pageSize,
        cursor: inventoryCursor?.shadowKeyset || null,
      };
      if ((cursorProvided && !inventoryCursor?.shadowKeyset)
        || !shadowCursorMatches(inventoryCursor?.shadowKeyset || null, shadowOptions)) {
        return res.status(400).json({ status: 'error', error: 'Invalid or stale shadow cursor' });
      }
      if (page > 1 && !inventoryCursor?.shadowKeyset) {
        return res.status(400).json({ status: 'error', error: 'Shadow pagination requires a cursor after page one' });
      }
      const result = await loadCuratedShadowInventory(client, shadowOptions);
      return res.status(200).json(result);
    }

    const client = getClient();
    // The high-volume six-brand lane remains on the bounded QNSA feed. Newly
    // admitted owner-reviewed brands live in the reviewed-workbook source and
    // must not be sent to the six-brand RPC merely because production selects
    // QNSA as its default source. This preserves strict single-item admission
    // while making the approved cohort visible after import.
    const activeMarketSourceView = MARKET_SOURCE_VIEW === CURATED_SHADOW_MARKET_SOURCE ? 'qnsa_rolex_patek_trading_floor_source' : MARKET_SOURCE_VIEW === 'qnsa_rolex_patek_trading_floor_source'
      && requestedBrand && REVIEWED_WORKBOOK_ADMISSION_BRANDS.has(requestedBrand)
      && !isRolexPatekOverlayBrand(requestedBrand)
      && !isFourBrand(requestedBrand)
      ? 'reviewed_workbook_market_source_v2'
      : MARKET_SOURCE_VIEW;
    // Summary and authenticated direct-post reads are independent of the
    // reviewed market REST request. Start them without serializing three
    // remote database round trips on every page load.
    const summaryPromise = activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      // Counts are metadata, not an admission gate. Never serialize the
      // customer page behind a global snapshot RPC: if that RPC is stale or
      // locked it can consume the hosted statement timeout before the bounded
      // 50-row feed is attempted. Counts remain explicitly unavailable until
      // refreshed out of band.
      ? Promise.resolve(unavailableQnsaReleaseSummary())
      : loadSummary(client);
    const brand = requestedBrand;
    // Cursor pages publish the current reviewed inventory, including incomplete
    // identities and no-price rows; analytics eligibility remains stricter.
    const scopedFilter = true;
    const canReverse = !scopedFilter;
    const summary = await summaryPromise;
    // RM is explicitly controlled by the production release ledger. It is
    // included in discovery only after the reviewed RM deployment exists;
    // counts remain unavailable while the optional snapshot is offline.
    if (activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      && !summary.brands.some(entry => entry.brand === 'Richard Mille')) {
      summary.brands.push({ brand: 'Richard Mille', files: 1, files_complete: 1,
        source_rows: null, canonical_listings: null, duplicate_rows_held: null });
    }
    // The snapshot is an exact census of the enabled reconciled market-feed
    // run. Totals stay withheld for predicates the snapshot does not encode.
    let publicInventoryTotal = activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source' && !multiBrandSelection
      ? snapshotInventoryTotal(summary, {
          search, model: requestedModel, reference, dial: requestedDial, imagesOnly, condition, region,
          rating, postedAfter, itemCategory, brand, listingType, pricedOnly,
        })
      : null;
    let fourBrandCountOptions = null;
    const vacheronOverseasRelease = brand === 'Vacheron Constantin' && ['ALL', 'WATCH'].includes(itemCategory);
    const omegaRelease = brand === 'Omega' && ['ALL', 'WATCH'].includes(itemCategory);
    const tudorRelease = brand === 'Tudor' && ['ALL', 'WATCH'].includes(itemCategory);
    const cartierRelease = brand === 'Cartier' && ['ALL', 'WATCH'].includes(itemCategory);
    const fourBrandEffectiveScope = isFourBrand(brand) && ['ALL', 'WATCH'].includes(itemCategory);
    const zenithModelRelease = brand === 'Zenith' && requestedModel && ['ALL', 'WATCH'].includes(itemCategory);
    const controlledBrandRelease = vacheronOverseasRelease || omegaRelease || cartierRelease || tudorRelease;
    if (controlledBrandRelease
      && !search && !requestedModel && !reference && !requestedDial && !condition
      && !region && !rating && !postedAfter && !pricedOnly && !imagesOnly) {
      const releaseCountRpc = cartierRelease ? 'qnsa_cartier_release_count'
        : omegaRelease ? 'qnsa_omega_release_count'
        : tudorRelease ? 'qnsa_tudor_release_count' : 'qnsa_vacheron_overseas_release_count';
      const { data: exactCount, error: exactCountError } = await client
        .rpc(releaseCountRpc, {
          p_listing_type: controlledBrandRelease && ['WTS', 'WTB'].includes(listingType)
            ? listingType : databaseListingType,
        });
      publicInventoryTotal = exactCountError ? null : Number(exactCount || 0);
    }
    if (requestedModel && (omegaRelease || cartierRelease || tudorRelease) && !search && !reference && !requestedDial && !condition
      && !region && !rating && !postedAfter && !pricedOnly && !imagesOnly) {
      const { data: exactModelCount, error: exactModelCountError } = await client
        .rpc('qnsa_controlled_model_release_count', {
          p_brand: brand,
          p_model: requestedModel,
          p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
        });
      publicInventoryTotal = exactModelCountError ? null : Number(exactModelCount || 0);
    }
    if (zenithModelRelease && !search && !reference && !requestedDial && !condition
      && !region && !rating && !postedAfter && !pricedOnly && !imagesOnly) {
      const { data: zenithModelCount, error: zenithModelCountError } = requestedModelReferences.length
        ? await client.rpc('qnsa_zenith_model_release_count', {
            p_references: requestedModelReferences,
            p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
          })
        : { data: 0, error: null };
      publicInventoryTotal = zenithModelCountError ? null : Number(zenithModelCount || 0);
    }
    // The effective count RPC uses the same release, immutable-lineage,
    // single-watch and customer-filter predicates as the effective page. A
    // missing forward RPC preserves the prior zero-outage withheld-total state.
    const firstEffectiveCountPage = pagination === 'cursor'
      ? !cursorProvided && page === 1 && (inventoryCursor?.offset || 0) === 0
      : page === 1;
    if (fourBrandEffectiveScope && firstEffectiveCountPage && publicInventoryTotal === null) {
      fourBrandCountOptions = {
        brand,
        listingType: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
        model: requestedModel || null,
        reference: requestedReference || null,
        dial: requestedDial || null,
        condition: condition || null,
        search: search || null,
        references: null,
        imagesOnly,
        pricedOnly,
        postedAfter,
        region: databaseRegion || null,
        rating: rating || null,
      };
      publicInventoryTotal = null;
    } else if (fourBrandEffectiveScope && publicInventoryTotal === null) {
      // Cursor continuation pages never repeat the exact cohort-wide count.
      publicInventoryTotal = null;
    }
    if (vacheronOverseasRelease && requestedModel.toLowerCase() === 'overseas'
      && !search && !reference && !requestedDial && !condition && !region && !rating
      && !postedAfter && !pricedOnly && !imagesOnly) {
      const { data: overseasCount, error: overseasCountError } = await client
        .rpc('qnsa_vacheron_overseas_release_count', {
          p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
        });
      publicInventoryTotal = overseasCountError ? null : Number(overseasCount || 0);
    }
    const pageWindow = resolvePageWindow({
      page,
      pageSize,
      total: 0,
      canReverse,
    });

    if (pageWindow.empty) {
      const publicationBrands = publicationBrandsFromSummary(summary);
      return res.status(200).json({
        status: 'ok', count: 0, total: publicInventoryTotal, page, pageSize,
        totalIsEstimate: false,
        totalStatus: publicInventoryTotal === null ? 'withheld_for_unsupported_filter' : 'available_from_market_feed_counts',
        hasMore: false, nextCursor: null,
        records: [], summary, publicationBrands,
        evidenceContract: EVIDENCE_CONTRACT,
        coverage: summarizeCoverage([]),
      });
    }

    if (brand && REVIEWED_WORKBOOK_ADMISSION_BRANDS.has(brand)
      && !fourBrandEffectiveScope
      && !(activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
        && isRolexPatekOverlayBrand(brand))) {
      const admissionSearch = safeSearchTerm(search);
      const admissionColumns = [
        'id,source_file,source_row_number,source_record_id,source_message_id,parent_source_message_id,posting_date,posted_by,phone_number',
        'contact_publication_approved,raw_message,listing_type,brand_scope,supplied_brand,canonical_brand',
        'model,catalog_model,raw_reference,normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
        'workbook_price_usd,source_price_amount,source_price_text,source_currency,price_evidence_status',
        'confidence,verification_status,verification_tier,user_image_url,has_image,imported_at,review_reasons,source_payload_sha256',
      ].join(',');
      let admissionQuery = client
        .from('reviewed_workbook_inventory')
        .select(admissionColumns, { count: 'exact' })
        .eq('brand_scope', brand)
        .in('verification_status', [
          'APPROVED_SINGLE_CANDIDATE',
          MULTI_PARENT_VERIFICATION_STATUS,
        ])
        .eq('confidence', 100);
      if (databaseListingType) {
        admissionQuery = admissionQuery.eq('listing_type', databaseListingType);
      } else {
        admissionQuery = admissionQuery.or('listing_type.in.(WTS,WTB,MULTI,OTHER,UNKNOWN),listing_type.is.null');
      }
      if (requestedReference) {
        admissionQuery = admissionQuery.in('normalized_reference', listEquivalentReferences(requestedReference, brand));
      }
      if (requestedDial) admissionQuery = admissionQuery.ilike('dial_color', requestedDial);
      if (imagesOnly) admissionQuery = admissionQuery.eq('has_image', true);
      if (pricedOnly) admissionQuery = admissionQuery.gt('source_price_amount', 0);
      if (postedAfter) admissionQuery = admissionQuery.gte('posting_date', postedAfter);
      if (admissionSearch && !admissionSearch.includes(' ')) {
        const pattern = `*${admissionSearch}*`;
        admissionQuery = admissionQuery.or([
          `model.ilike.${pattern}`,
          `catalog_model.ilike.${pattern}`,
          `raw_reference.ilike.${pattern}`,
          `normalized_reference.ilike.${pattern}`,
          `posted_by.ilike.${pattern}`,
          `raw_message.ilike.${pattern}`,
        ].join(','));
      }
      const admissionOffset = pagination === 'cursor'
        ? (inventoryCursor?.offset || 0)
        : pageWindow.start;
      const { data: admissionRows, count: admissionCount, error: admissionError } = await admissionQuery
        // This ordering is applied by PostgREST/Postgres before range(), so it
        // is a real admitted-brand cursor order rather than a page-local sort.
        // The admission importer emits WTS/WTB plus a controlled price-evidence
        // vocabulary: WTS sorts before WTB and SOURCE_EXPLICIT_USD_MATCH sorts
        // before PRICE_* / DATED_* states. The existing brand+image index keeps
        // the leading brand/image boundary bounded; no schema change is needed.
        .order('has_image', { ascending: false })
        .order('verification_status', { ascending: false })
        .order('listing_type', { ascending: false })
        .order('price_evidence_status', { ascending: false })
        .order('workbook_price_usd', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(admissionOffset, admissionOffset + pageSize);
      if (admissionError) throw admissionError;
      const mappedAdmissionRows = (admissionRows || []).slice(0, pageSize).map(row => {
        const isApprovedMultiParent = row.verification_status === MULTI_PARENT_VERIFICATION_STATUS
          && row.listing_type === 'MULTI';
        return mapReviewedRecord({
        ...row,
        parent_id: isApprovedMultiParent ? row.source_record_id : null,
        is_bundle: isApprovedMultiParent,
        has_exact_source_image: row.has_image === true,
        verified_price_usd: row.price_evidence_status === EXPLICIT_USD_STATUS
          ? Number(row.workbook_price_usd) || null
          : null,
        has_verified_usd_price: row.price_evidence_status === EXPLICIT_USD_STATUS
          && Number(row.workbook_price_usd) > 0,
        has_complete_identity: Boolean(row.canonical_brand && row.model && row.normalized_reference && row.dial_color),
        verdict: isApprovedMultiParent ? MULTI_PARENT_VERIFICATION_STATUS : 'APPROVED',
        trading_floor_status: isApprovedMultiParent ? 'PUBLISHED_MULTI_LISTING' : 'APPROVED',
        item_category: 'WATCH',
        publication_state: 'APPROVED',
        publication_lane: isApprovedMultiParent
          ? MULTI_PARENT_PUBLICATION_LANE
          : 'OWNER_REVIEWED_ADMISSION',
        normalization_run_complete: true,
        raw_lineage_verified: /^[0-9a-f]{64}$/i.test(String(row.source_payload_sha256 || '')),
      });
      });
      const records = (await enrichRecordsWithDealerDirectory(client, mappedAdmissionRows))
        .filter(record => !record.multi_listing || record.multi_listing_release_approved === true)
        .filter(record => isPublicTradingIntent(record.listing_type)
          || record.multi_listing_release_approved === true)
        .filter(record => !listingType
          || cleanExactText(record.listing_type, 30).toUpperCase() === listingType)
        .filter(record => !condition || cleanExactText(record.condition, 80).toLowerCase() === condition.toLowerCase())
        .filter(record => !region || locationMatches(record.location, region))
        .filter(record => ratingMatches(record, rating))
        .sort(compareInventoryForDisplay);
      const hasMore = (admissionRows || []).length > pageSize;
      const nextOffset = admissionOffset + Math.min(pageSize, (admissionRows || []).length);
      return res.status(200).json({
        status: 'ok',
        count: records.length,
        total: ['WTS', 'WTB'].includes(listingType) ? null : Number(admissionCount || 0),
        page,
        pageSize,
        totalIsEstimate: false,
        totalStatus: ['WTS', 'WTB'].includes(listingType)
          ? 'withheld_for_owner_intent_fallback_filter'
          : 'available_from_approved_admission_inventory',
        hasMore,
        nextCursor: hasMore ? encodeInventoryCursor({ lane: 'images', offset: nextOffset, page: page + 1 }) : null,
        records,
        summary: {
          source: 'reviewed_workbook_inventory',
          canonical_listings: Number(admissionCount || 0),
          brands: [{ brand, canonical_listings: Number(admissionCount || 0) }],
        },
        publicationBrands: [{ brand, listing_count: Number(admissionCount || 0) }],
        evidenceContract: EVIDENCE_CONTRACT,
        coverage: summarizeCoverage(records),
        displayPolicy: {
          unpriced_listings_visible: true,
          unpriced_listings_count_toward_activity: true,
          unpriced_listings_excluded_from_price_analytics: true,
          within_reference_order: 'SOURCE_IMAGE_FIRST_THEN_NEWEST',
        },
        viewContract: 'approved-admission-inventory',
      });
    }

    const columns = [
      'id,parent_id,source_file,source_row_number,source_record_id,posting_date,seller_name',
      'seller_phone,contact_publication_approved,raw_message,listing_type,brand_scope',
      'supplied_brand,canonical_brand,model,catalog_model,raw_reference',
      'normalized_reference,catalog_reference,dial_color,catalog_dial,condition',
      'workbook_price_usd,source_price_amount,source_currency',
      'price_evidence_status,confidence,verdict,verification_status,user_image_url,imported_at',
      'has_exact_source_image,verified_price_usd,has_verified_usd_price,has_complete_identity,trading_floor_status,reference_search_key,location,item_category',
      'corrected_price_usd,corrected_source_amount,corrected_source_currency,corrected_fx_rate,corrected_fx_source,corrected_fx_date,price_correction_status,price_correction_id,price_correction_key',
      'publication_state,publication_lane,normalization_run_complete,raw_lineage_verified,dealer_rating,review_count',
    ].join(',');

    // ponytail: use raw REST instead of Supabase client to avoid client-side issues
    const queryParams = new URLSearchParams();
    queryParams.set('select', columns);
    // The QNSA release view already excludes every blocked status and may carry
    // a NULL source status. Applying SQL NOT IN again would also reject NULL and
    // erase otherwise eligible reviewed rows.
    if (activeMarketSourceView !== 'qnsa_rolex_patek_trading_floor_source') {
      queryParams.set('trading_floor_status', 'not.in.(bundle_child_pending_review,bundle_pending_separation,suppressed_exact_duplicate)');
    }
    // Keep the brand predicate in PostgreSQL. The forward QNSA feed indexes now
    // cover (brand_normalized, created_at DESC, id DESC), so scanning an
    // unpartitioned 501-row window and filtering it in Node is both slower and
    // capable of starving one brand when the newest global rows skew toward the
    // other brand.
    const qnsaBroadPage = activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      && !reference;
    if (brand) queryParams.set('brand_scope', `eq.${brand}`);
    if (reference) {
      const normalizedBrand = String(brand || '').trim().toLowerCase();
      const familyPrefix = (normalizedBrand === 'rolex' && reference === '116500')
        || (normalizedBrand === 'patek philippe' && reference === '5712')
        ? reference
        : null;
      if (activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source') {
        if (familyPrefix) {
          queryParams.set('normalized_reference', `like.${familyPrefix}*`);
        } else {
          const exactVariants = listEquivalentReferences(requestedReference, brand || null);
          queryParams.set('normalized_reference', `in.(${exactVariants.join(',')})`);
        }
      } else {
        queryParams.set('reference_search_key', `eq.${reference}`);
      }
    }
    if (exactDialVariants.length) queryParams.set('dial_color', `in.(${exactDialVariants.join(',')})`);
    if (databaseListingType) queryParams.set('listing_type', `eq.${databaseListingType}`);
    if (itemCategory === 'WATCH') {
      // Include legacy OTHER rows only so the fail-closed brand/reference rule
      // above can recover real watches. The mapped category filter removes
      // every OTHER row that lacks that evidence.
      queryParams.set('item_category', 'in.(WATCH,OTHER)');
    } else if (itemCategory !== 'ALL') {
      queryParams.set('item_category', `eq.${itemCategory}`);
    }
    if (imagesOnly) queryParams.set('has_exact_source_image', 'eq.true');
    if (pricedOnly) queryParams.set('source_price_amount', 'gt.0');
    const regionPattern = locationSearchPattern(region);
    if (regionPattern) queryParams.set('location', `ilike.${regionPattern}`);
    if (postedAfter) queryParams.set('posting_date', `gte.${postedAfter}`);
    const genericSearch = safeSearchTerm(search);
    if (genericSearch && !genericSearch.includes(' ') && !requestedReference && !requestedDial) {
      const pattern = `*${genericSearch}*`;
      queryParams.set('or', `(${[
        `supplied_brand.ilike.${pattern}`,
        `canonical_brand.ilike.${pattern}`,
        `brand_scope.ilike.${pattern}`,
        `model.ilike.${pattern}`,
        `catalog_model.ilike.${pattern}`,
        `raw_reference.ilike.${pattern}`,
        `normalized_reference.ilike.${pattern}`,
        `catalog_reference.ilike.${pattern}`,
        `seller_name.ilike.${pattern}`,
        `seller_phone.ilike.${pattern}`,
        `location.ilike.${pattern}`,
        `raw_message.ilike.${pattern}`,
      ].join(',')})`);
    }
    if (!itemCategory) return res.status(400).json({ status: 'error', error: 'Invalid item category' });
    // ponytail: simplified query — ORDER BY with offset times out on large views
    // QNSA already excludes bundle parents/children in the release view. Do not
    // force its default customer request into either media lane: a historical
    // replay may legitimately contain source-backed photos, and forcing
    // `has_exact_source_image=false` made every such Rolex/Patek disappear.
    // The explicit Images filter remains strict; the general feed is ordered by
    // the bounded publication index and renders an image only when the row
    // supplies one.
    const watchFeed = ['ALL', 'WATCH'].includes(itemCategory);
    const sixBrandBroadScope = qnsaBroadPage && watchFeed && !zenithModelRelease
      && (!brand || SIX_REVIEWED_WATCH_BRANDS.includes(brand));
    const sixBrandCompositeScope = sixBrandBroadScope
      && !controlledBrandRelease && !fourBrandEffectiveScope;
    const sixBrandScope = requestedBrands.length > 0 ? requestedBrands : SIX_REVIEWED_WATCH_BRANDS;
    if (sixBrandCompositeScope && pagination !== 'cursor' && page > 1) {
      return res.status(400).json({
        status: 'error',
        error: 'Six-brand Trading Floor pagination requires a cursor after the first page.',
      });
    }
    if (sixBrandCompositeScope && pagination === 'cursor' && cursorProvided
      && page > 1 && !inventoryCursor?.brandKeysets) {
      return res.status(400).json({
        status: 'error',
        error: 'This Trading Floor cursor is stale; refresh to start the safe six-brand feed.',
      });
    }
    if (multiBrandSelection && pagination === 'cursor' && cursorProvided && page > 1) {
      const cursorScope = [...(inventoryCursor?.brandScope || [])].sort();
      const requestedScope = [...sixBrandScope].sort();
      if (cursorScope.length !== requestedScope.length
        || cursorScope.some((brand, index) => brand !== requestedScope[index])) {
        return res.status(400).json({
          status: 'error',
          error: 'This Trading Floor cursor belongs to a different multi-brand selection. Refresh to start the selected brand feed.',
        });
      }
    }
    const qnsaUnpartitionedMedia = activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      && !imagesOnly && (!sixBrandBroadScope || controlledBrandRelease || fourBrandEffectiveScope);
    // A single controlled release uses a manifest offset, even though its
    // brand also belongs to the historical six-brand family. Encoding that
    // offset as a composite v2 cursor forces it to zero and repeats page one.
    const sixBrandKeysetCursor = sixBrandCompositeScope;
    const requestedLane = imagesOnly ? 'images' : (inventoryCursor?.lane || 'images');
    const requestedOffset = pagination === 'cursor'
      ? (inventoryCursor?.offset || 0)
      : pageWindow.start;
    const requestedDeltaOffset = pagination === 'cursor'
      ? (inventoryCursor?.deltaOffset || 0)
      : pageWindow.start;
    const firstPageOfLane = sixBrandBroadScope
      ? Object.keys(inventoryCursor?.brandKeysets || {}).length === 0
        && (requestedLane === 'images' ? page === 1 : true)
      : requestedOffset === 0 && (requestedLane === 'images' ? page === 1 : true);
    let directRowsPromise = Promise.resolve({ data: [], error: null });
    // Six-brand pages use only the canonical immutable/staging release. POST IT
    // rows enter that pipeline before publication; overlaying submissions here
    // would introduce an unpaged seventh stream and break deterministic order.
    if (firstPageOfLane && !sixBrandBroadScope) {
      let directQuery = client.from('dealer_listing_submissions')
        .select('id,dealer_id,intent,category,raw_message,claimed_fields,image_urls,poster_image_url,review_status,publication_status,created_at')
        .eq('publication_status', 'PUBLISHED')
        .eq('review_status', 'APPROVED')
        .order('created_at', { ascending: false })
        .limit(100);
      if (itemCategory !== 'ALL') directQuery = directQuery.eq('category', itemCategory);
      if (postedAfter) directQuery = directQuery.gte('created_at', postedAfter);
      directRowsPromise = Promise.resolve(directQuery);
    }
    if (!qnsaUnpartitionedMedia) {
      queryParams.set('has_exact_source_image', requestedLane === 'images' ? 'eq.true' : 'eq.false');
    }
    queryParams.set('order', activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      // Match the QNSA feed indexes exactly. Ordering the joined publication
      // view by posting_date forced a full sort across the complete release and
      // timed out after the release switches were enabled.
      ? 'created_at.desc,id.desc'
      : 'id.desc');
    const qnsaBrandScanLimit = pageSize + 1;
    let qnsaCandidateCursorMeta = null;
    queryParams.set('limit', String(qnsaBrandScanLimit));
    if (requestedOffset > 0) queryParams.set('offset', String(requestedOffset));
    
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg';
    const headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    };
    let activeQueryParams = legacyMarketViewContractDetected
      ? buildLegacyMarketQueryParams({
          pageSize, offset: requestedOffset, imageLane: requestedLane,
          brand, requestedReference, exactDialVariants,
          listingType: databaseListingType, imagesOnly, pricedOnly, search, postedAfter,
        })
      : queryParams;
    let usedLegacyViewContract = legacyMarketViewContractDetected;
    const laterReviewedBrand = ['Richard Mille', 'Cartier', 'Zenith', 'Omega', 'Tudor'].includes(brand);
    // Broad QNSA brand pages first resolve a tiny ordered ID page from the
    // enabled normalization run. Fetching the strict evidence view by those IDs
    // avoids a slow ordered scan through its release-control/checkpoint joins.
    if ((qnsaBroadPage || fourBrandEffectiveScope) && !legacyMarketViewContractDetected) {
      // WATCH browsing uses the proven indexed watch-only feed. The general
      // category feed performs additional expression sorting and immutable
      // evidence joins that can exceed the hosted statement timeout on broad
      // brand pages. Keep it for non-watch categories only.
      if (fourBrandEffectiveScope) {
        const directReleaseRpc = cartierRelease ? 'qnsa_cartier_page_rows'
          : omegaRelease ? 'qnsa_omega_page_rows'
          : tudorRelease ? 'qnsa_tudor_page_rows' : null;
        if (directReleaseRpc && !search && !condition && !region && !rating && !postedAfter && !pricedOnly && !imagesOnly) {
          const directResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${directReleaseRpc}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              p_limit: qnsaBrandScanLimit,
              p_offset: requestedOffset,
              p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
              p_reference: requestedReference || null,
            }),
          });
          if (directResponse.ok) {
            preloadedQnsaResponse = new Response(JSON.stringify(await directResponse.json()), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        if (!preloadedQnsaResponse) {
          const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_four_brand_effective_page_rows`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              p_brand: brand,
              p_limit: qnsaBrandScanLimit,
              p_offset: requestedOffset,
              p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
              p_model: requestedModel || null,
              p_reference: requestedReference || null,
              p_dial: requestedDial || null,
              p_condition: condition || null,
              p_search: search || null,
              p_references: null,
              p_images_only: imagesOnly,
              p_priced_only: pricedOnly,
              p_posted_after: postedAfter,
              p_region: databaseRegion || null,
              p_rating: rating || null,
            }),
          });
          if (!response.ok) {
            const body = await response.text();
            const rpcError = { status: response.status, message: body };
            if (isMissingEffectiveRpcError(rpcError) || isTransientEffectiveRpcTimeout(rpcError)) {
              console.warn('[reviewed-market-inventory] four-brand effective RPC unavailable or timed out; preserving bounded base release path');
              const releaseRpc = cartierRelease ? 'qnsa_cartier_page_rows'
                : omegaRelease ? 'qnsa_omega_page_rows'
                : tudorRelease ? 'qnsa_tudor_page_rows' : null;
            const controlledModelRpc = requestedModel && releaseRpc
              ? 'qnsa_controlled_model_page_rows'
              : releaseRpc;
            if (controlledModelRpc) {
              const fallbackResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${controlledModelRpc}`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  p_limit: qnsaBrandScanLimit,
                  p_offset: requestedOffset,
                  p_listing_type: ['WTS', 'WTB'].includes(listingType)
                    ? listingType : databaseListingType,
                  p_reference: requestedReference || null,
                  ...(requestedModel
                    ? { p_brand: brand, p_model: requestedModel }
                    : {}),
                }),
              });
              if (!fallbackResponse.ok) {
                const fallbackBody = await fallbackResponse.text();
                throw new Error(`QNSA controlled brand fallback page failed: ${fallbackResponse.status} ${fallbackBody.slice(0, 200)}`);
              }
              preloadedQnsaResponse = new Response(JSON.stringify(await fallbackResponse.json()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
          } else {
            throw new Error(`QNSA four-brand effective page failed: ${response.status} ${body.slice(0, 200)}`);
          }
        } else {
          preloadedQnsaResponse = new Response(JSON.stringify(await response.json()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    } else if (zenithModelRelease) {
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_zenith_model_page_rows`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_references: requestedModelReferences,
            p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset,
            p_listing_type: ['WTS', 'WTB'].includes(listingType) ? listingType : databaseListingType,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`QNSA Zenith model page failed: ${response.status} ${body.slice(0, 200)}`);
        }
        preloadedQnsaResponse = new Response(JSON.stringify(await response.json()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (vacheronOverseasRelease || omegaRelease || cartierRelease || tudorRelease) {
        const releaseRpc = cartierRelease ? 'qnsa_cartier_page_rows'
          : omegaRelease ? 'qnsa_omega_page_rows'
          : tudorRelease ? 'qnsa_tudor_page_rows' : 'qnsa_vacheron_overseas_page_rows';
        const controlledModelRpc = requestedModel && (omegaRelease || cartierRelease || tudorRelease)
          ? 'qnsa_controlled_model_page_rows'
          : releaseRpc;
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${controlledModelRpc}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset,
            p_listing_type: controlledBrandRelease && ['WTS', 'WTB'].includes(listingType)
              ? listingType : databaseListingType,
            p_reference: requestedReference || null,
            ...(requestedModel && (omegaRelease || cartierRelease || tudorRelease)
              ? { p_brand: brand, p_model: requestedModel }
              : {}),
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`QNSA controlled brand page failed: ${response.status} ${body.slice(0, 200)}`);
        }
        preloadedQnsaResponse = new Response(JSON.stringify(await response.json()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (sixBrandBroadScope) {
        const streamBrands = sixBrandScope;
        const previousBrandKeysets = inventoryCursor?.brandKeysets || {};
        const entries = await Promise.all(streamBrands.map(brandName => {
          const brandCursor = previousBrandKeysets[brandName] || null;
          return refillSixBrandStream({
            brand: brandName,
            previousKeyset: brandCursor,
            pageSize,
            maxWindows: 5,
            fetchWindow: async windowCursor => {
              const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_six_brand_image_lane_page`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  p_brand: brandName,
                  p_has_image: requestedLane === 'images',
                  p_after_has_price: windowCursor?.hasPrice ?? null,
                  p_after_created_at: windowCursor?.createdAt ?? null,
                  p_after_id: windowCursor?.id ?? null,
                  p_limit: pageSize,
                  p_listing_type: databaseListingType,
                  p_scan_limit: 500,
                }),
              });
              if (!response.ok) {
                const body = await response.text();
                throw new Error(`QNSA six-brand ${brandName} page failed: ${response.status} ${body.slice(0, 200)}`);
              }
              const envelope = parseSixBrandEnvelope(await response.json());
              if (!envelope) throw new Error(`QNSA six-brand ${brandName} returned a malformed envelope`);
              return envelope;
            },
          });
        }));
        const returnedIds = entries.flatMap(entry =>
          entry.envelope.rows.map(row => String(row.id)));
        if (new Set(returnedIds).size !== returnedIds.length) {
          throw new Error('QNSA six-brand streams returned duplicate listing IDs');
        }
        const merged = mergeSixBrandEnvelopes(entries, pageSize, previousBrandKeysets);
        qnsaCandidateCursorMeta = {
          hasMore: merged.hasMore,
          nextBrandKeysets: merged.nextBrandKeysets,
          previousBrandKeysets,
          scannedCount: entries.reduce((sum, entry) =>
            sum + Number(entry.envelope.scanned_count || 0), 0),
        };
        var preloadedQnsaResponse = new Response(JSON.stringify(merged.rows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
      const nonWatchFeed = ['HANDBAG', 'JEWELRY', 'ACCESSORY'].includes(itemCategory);
      let pageRowsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${watchFeed
        ? (laterReviewedBrand ? 'qnsa_later_brand_candidate_stride_page' : 'qnsa_trading_floor_page_rows')
        : (nonWatchFeed ? 'qnsa_non_watch_market_page_rows' : 'qnsa_market_feed_page_rows')}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(watchFeed
          ? (laterReviewedBrand
            ? { p_brand: brand || null, p_limit: pageSize,
                p_offset: requestedOffset, p_listing_type: databaseListingType }
            : { p_brand: brand || null, p_limit: qnsaBrandScanLimit,
                p_offset: requestedOffset, p_listing_type: databaseListingType })
          : {
              p_category: itemCategory,
              p_limit: qnsaBrandScanLimit,
              p_offset: requestedOffset,
              p_listing_type: databaseListingType,
              p_images_only: imagesOnly,
              p_location: databaseRegion || null,
              p_posted_after: postedAfter,
            }),
      });
      if (!pageRowsRes.ok && nonWatchFeed && [400, 404].includes(pageRowsRes.status)) {
        // Preserve availability during the narrow API-before-migration window.
        pageRowsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_market_feed_page_rows`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_brand: brand || null,
            p_category: itemCategory,
            p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset,
            p_listing_type: databaseListingType,
            p_images_only: imagesOnly,
            p_location: databaseRegion || null,
            p_posted_after: postedAfter,
          }),
        });
      }
      if (!pageRowsRes.ok && laterReviewedBrand
        && shouldFallbackLaterBrandCandidate(pageRowsRes.status)) {
        // Application and forward migration can deploy independently. During
        // that narrow window, or if the candidate RPC times out/transiently
        // fails, retain the previous bounded wrapper. It may expose a short page
        // but remains publication-safe.
        pageRowsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_later_brand_page_rows_strict`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_brand: brand || null, p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset, p_listing_type: databaseListingType }),
        });
      }
      if (!pageRowsRes.ok && [404, 400].includes(pageRowsRes.status) && ['ALL', 'WATCH'].includes(itemCategory)) {
        // The application can deploy before the forward database migration.
        // Preserve the proven two-brand watch feed during that short window;
        // non-watch categories remain empty rather than being misclassified.
        pageRowsRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_trading_floor_page_rows`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_brand: brand || null, p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset, p_listing_type: databaseListingType }),
        });
      }
      if (!pageRowsRes.ok) {
        const pageRowsError = await pageRowsRes.text();
        throw new Error(`QNSA page rows failed: ${pageRowsRes.status} ${pageRowsError.slice(0, 200)}`);
      }
      const pageRowsPayload = await pageRowsRes.json();
      const unwrappedCandidatePayload = Array.isArray(pageRowsPayload)
        && pageRowsPayload.length === 1
        && pageRowsPayload[0]?.qnsa_later_brand_candidate_stride_page
        ? pageRowsPayload[0].qnsa_later_brand_candidate_stride_page
        : pageRowsPayload;
      const candidateEnvelope = laterReviewedBrand && unwrappedCandidatePayload
        && !Array.isArray(unwrappedCandidatePayload) && Array.isArray(unwrappedCandidatePayload.rows)
        ? unwrappedCandidatePayload
        : null;
      if (candidateEnvelope) {
        qnsaCandidateCursorMeta = {
          nextOffset: Number(candidateEnvelope.next_offset),
          hasMore: candidateEnvelope.has_more === true,
          scannedCount: Number(candidateEnvelope.scanned_count || 0),
        };
      }
      let pageRows = (candidateEnvelope ? candidateEnvelope.rows : pageRowsPayload)
        .map(row => row.row_data || row).filter(Boolean);
      if (laterReviewedBrand && pageRows.length === 0 && !candidateEnvelope) {
        const fallbackRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/qnsa_later_brand_page_rows`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_brand: brand || null, p_limit: 51,
            p_offset: brand === 'Cartier' ? requestedOffset + 2650 : requestedOffset,
            p_listing_type: databaseListingType }),
        });
        if (fallbackRes.ok) {
          pageRows = (await fallbackRes.json())
            .map(row => row.row_data || row)
            .filter(row => row && isPlausibleLaterBrandReference(
              brand,
              row.normalized_reference || row.catalog_reference || row.raw_reference,
            ));
        }
      }
      const directResponse = new Response(JSON.stringify(pageRows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      // Reuse the common mapping/filtering path below without a second joined
      // view query. `restRes` is assigned before its normal declaration.
      preloadedQnsaResponse = directResponse;
      }
    }
    if (!preloadedQnsaResponse
      && activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      && brand && reference && !legacyMarketViewContractDetected) {
      const normalizedBrand = String(brand).trim().toLowerCase();
      const familyReference = (normalizedBrand === 'rolex' && reference === '116500')
        || (normalizedBrand === 'patek philippe' && reference === '5712');
      const patekBaseEquivalent = normalizedBrand === 'patek philippe'
        && /-001$/i.test(String(requestedReference || ''))
        ? String(requestedReference).trim().toUpperCase().replace(/-001$/i, '')
        : null;
      // Audemars Piguet listings commonly preserve the complete catalog
      // reference (for example 15500ST.OO.1220ST.01), while users search by
      // its model-family prefix (15500ST). Route only well-formed AP base
      // references through the indexed prefix lane; complete dotted
      // references remain exact matches.
      const audemarsBaseFamily = normalizedBrand === 'audemars piguet'
        && /^\d{5}[A-Z]{2,4}$/i.test(String(requestedReference || '').trim())
        ? String(requestedReference).trim().toUpperCase()
        : null;
      const rpcReference = familyReference
        ? reference
        : (patekBaseEquivalent || audemarsBaseFamily || String(requestedReference).trim().toUpperCase());
      // AP shorthand families can cover several full dotted catalog variants.
      // Query those variants through exact indexed predicates and merge the
      // small result sets in memory. This avoids the expensive prefix-sort
      // plan that can cross the hosted statement timeout on large families.
      const apExactReferences = audemarsBaseFamily
        ? [...new Set(listCatalogReferences('Audemars Piguet')
          .map(entry => String(entry.reference || '').trim().toUpperCase())
          .filter(candidate => candidate.startsWith(`${audemarsBaseFamily}.`)))]
        : [];
      let referenceRows;
      if (apExactReferences.length) {
        const client = getClient();
        const apEvidenceReferences = [audemarsBaseFamily, ...apExactReferences];
        const [wtsResult, wtbResult] = await Promise.all(['WTS', 'WTB'].map(listingIntent => client.rpc(
          'qnsa_bounded_price_research_rows',
          {
            p_brand: brand,
            p_references: apEvidenceReferences,
            p_listing_type: listingIntent,
            p_limit: 2500,
          },
        )));
        const rpcError = wtsResult.error || wtbResult.error;
        if (rpcError) throw new Error(`QNSA AP reference evidence failed: ${rpcError.message || rpcError}`);
        referenceRows = [...(wtsResult.data || []), ...(wtbResult.data || [])].map(row => ({
          id: row.id,
          source_file: row.source,
          posting_date: row.listing_date || row.created_at,
          seller_name: row.seller_name,
          seller_phone: row.seller_phone,
          // The bounded Price Research RPC returns source identity evidence,
          // not an explicit contact-publication consent decision.
          contact_publication_approved: false,
          raw_message: row.raw_message,
          listing_type: row.listing_type,
          brand_scope: row.brand,
          canonical_brand: row.brand,
          catalog_model: row.model,
          normalized_reference: row.reference,
          catalog_reference: row.reference,
          dial_color: row.dial_color,
          condition: row.condition,
          workbook_price_usd: row.price_usd,
          verified_price_usd: row.price_usd,
          source_price_amount: row.price_raw,
          source_currency: row.currency,
          price_evidence_status: Number(row.price_usd) > 0 ? 'EXPLICIT_SOURCE_FX_CONVERTED' : 'PRICE_NOT_SUPPLIED',
          confidence: row.confidence,
          verdict: row.verdict,
          verification_status: row.verdict,
          user_image_url: row.thumbnail_url,
          has_exact_source_image: row.has_images === true,
          has_verified_usd_price: Number(row.price_usd) > 0,
          has_complete_identity: true,
          trading_floor_status: row.listing_status,
          reference_search_key: referenceComparisonKey(row.reference),
          location: row.location,
          item_category: 'WATCH',
          publication_state: 'PENDING_VERIFICATION',
          publication_lane: 'QNSA_ROLEX_PATEK_REVIEWED_V1',
          normalization_run_complete: true,
          raw_lineage_verified: true,
          dealer_rating: row.seller_rating,
        }));
      }
      const rpcRequests = apExactReferences.length
        ? []
        : [{ reference: rpcReference, family: Boolean(familyReference || patekBaseEquivalent) }];
      const zenithExactReference = normalizedBrand === 'zenith' && !familyReference;
      const vacheronExactReference = normalizedBrand === 'vacheron constantin';
      const omegaExactReference = normalizedBrand === 'omega';
      const tudorExactReference = normalizedBrand === 'tudor';
      const rpcResponses = await Promise.all(rpcRequests.map(request => fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/${tudorExactReference
          ? 'qnsa_tudor_reference_rows'
          : omegaExactReference
          ? 'qnsa_omega_reference_rows'
          : vacheronExactReference
          ? 'qnsa_vacheron_overseas_reference_rows'
          : (zenithExactReference ? 'qnsa_zenith_reference_rows' : 'qnsa_trading_floor_reference_rows')}`,
        {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify((vacheronExactReference || omegaExactReference || tudorExactReference) ? {
            p_reference: request.reference,
            p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset,
            p_listing_type: databaseListingType,
          } : zenithExactReference ? {
            p_reference: request.reference,
            p_limit: qnsaBrandScanLimit,
            p_offset: requestedOffset,
            p_listing_type: databaseListingType,
          } : {
            p_brand: brand,
            p_reference: request.reference,
            p_family: request.family,
            p_limit: apExactReferences.length ? 101 : qnsaBrandScanLimit,
            p_offset: apExactReferences.length ? 0 : requestedOffset,
          }),
        },
      )));
      for (const rpcResponse of rpcResponses) {
        if (!rpcResponse.ok) {
          const referenceRowsError = await rpcResponse.text();
          throw new Error(`QNSA reference rows failed: ${rpcResponse.status} ${referenceRowsError.slice(0, 200)}`);
        }
      }
      const fetchedReferenceRows = (referenceRows || (await Promise.all(rpcResponses.map(response => response.json())))
        .flat()
        .map(row => row.row_data || row)
        .filter(Boolean));
      const compareReferenceRows = (left, right) => {
          const leftPriced = Number(left.verified_price_usd || left.workbook_price_usd || 0) > 0 ? 1 : 0;
          const rightPriced = Number(right.verified_price_usd || right.workbook_price_usd || 0) > 0 ? 1 : 0;
          if (leftPriced !== rightPriced) return rightPriced - leftPriced;
          const dateDelta = new Date(right.posting_date || right.imported_at || 0).getTime()
            - new Date(left.posting_date || left.imported_at || 0).getTime();
          return dateDelta || String(right.id || '').localeCompare(String(left.id || ''));
        };
      referenceRows = apExactReferences.length
        ? fetchedReferenceRows.sort(compareReferenceRows)
          .slice(requestedOffset, requestedOffset + qnsaBrandScanLimit)
        : sortPageWithoutMovingLookahead(fetchedReferenceRows, pageSize, compareReferenceRows);
      var preloadedQnsaResponse = new Response(JSON.stringify(referenceRows), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    let restUrl = `${process.env.SUPABASE_URL}/rest/v1/${activeMarketSourceView}?${activeQueryParams.toString()}`;
    let restRes = preloadedQnsaResponse || await fetch(restUrl, {
      headers,
    });
    let errText = restRes.ok ? '' : await restRes.text();
    if (!restRes.ok && restRes.status === 400 && /42703|does not exist/i.test(errText)) {
      // Production may temporarily lag the forward view migration. Fall back
      // to the last proven public contract instead of returning an empty 200 or
      // taking the entire Trading Floor offline. Publication gates remain
      // enforced again after row mapping below.
      legacyMarketViewContractDetected = true;
      usedLegacyViewContract = true;
      activeQueryParams = buildLegacyMarketQueryParams({
        pageSize, offset: requestedOffset, imageLane: requestedLane,
        brand, requestedReference, exactDialVariants,
        listingType: databaseListingType, imagesOnly, pricedOnly, search, postedAfter,
      });
      restUrl = `${process.env.SUPABASE_URL}/rest/v1/${activeMarketSourceView}?${activeQueryParams.toString()}`;
      restRes = await fetch(restUrl, { headers });
      errText = restRes.ok ? '' : await restRes.text();
    }
    if (!restRes.ok) {
      throw new Error(`REST query failed: ${restRes.status} ${errText.slice(0, 200)}`);
    }
    const data = await restRes.json();
    // Table-valued PostgreSQL RPCs that expose one JSONB column arrive from
    // PostgREST as [{ row_data: {...} }]. Normalize that envelope here so the
    // same publication gates evaluate the listing rather than its wrapper.
    // View-backed and already-unwrapped RPC responses pass through unchanged.
    const sourceRows = unwrapRpcRowData(data);
    // Retain private lineage only in memory for cross-lane deduplication. The
    // mapped public records intentionally omit message/file lineage fields.
    const privateExactKeysById = new Map(sourceRows
      .filter(row => row?.id)
      .map(row => [String(row.id), overlayExactKeys(row)]));
    const brandRows = sourceRows;
    let rawRows = brandRows.slice(0, pageSize);
    let hasMore = qnsaCandidateCursorMeta
      ? qnsaCandidateCursorMeta.hasMore
      : (brandRows.length > pageSize || (qnsaBroadPage && sourceRows.length >= qnsaBrandScanLimit));
    let nextLane = requestedLane;
    const lastReturnedSourceIndex = qnsaBroadPage && rawRows.length
      ? sourceRows.indexOf(rawRows[rawRows.length - 1]) + 1
      : rawRows.length;
    let nextOffset = requestedOffset + lastReturnedSourceIndex;

    // Fill the final image page from the no-image lane. The two equality lanes
    // preserve one global boundary without a full-view boolean sort or count.
    if (!sixBrandBroadScope && !qnsaUnpartitionedMedia
      && !imagesOnly && requestedLane === 'images' && !hasMore) {
      const remaining = pageSize - rawRows.length;
      nextLane = 'no-images';
      nextOffset = 0;
      if (remaining > 0) {
        const noImageParams = usedLegacyViewContract
          ? buildLegacyMarketQueryParams({
              pageSize: remaining, offset: 0, imageLane: 'no-images',
              brand, requestedReference, exactDialVariants,
              listingType, imagesOnly: false, pricedOnly, search, postedAfter,
            })
          : new URLSearchParams(queryParams);
        if (!usedLegacyViewContract) {
          noImageParams.set('has_exact_source_image', 'eq.false');
          noImageParams.set('order', 'id.desc');
          noImageParams.set('limit', String(remaining + 1));
          noImageParams.set('offset', '0');
        }
        const noImageUrl = `${process.env.SUPABASE_URL}/rest/v1/${activeMarketSourceView}?${noImageParams.toString()}`;
        const noImageRes = await fetch(noImageUrl, { headers });
        const noImageError = noImageRes.ok ? '' : await noImageRes.text();
        if (!noImageRes.ok) {
          throw new Error(`REST no-image query failed: ${noImageRes.status} ${noImageError.slice(0, 200)}`);
        }
        const noImageData = await noImageRes.json();
        const noImageRows = (noImageData || []).slice(0, remaining);
        rawRows = [...rawRows, ...noImageRows];
        hasMore = (noImageData || []).length > remaining;
        nextOffset = noImageRows.length;
      } else {
        hasMore = true;
      }
    }
    const rows = pageWindow.reverse ? [...rawRows].reverse() : rawRows;
    const pageResult = boundedPage(rows, pageSize, false);
    const eligibleRows = usedLegacyViewContract
      ? pageResult.records
      : pageResult.records.filter(row => {
          // The later-brand RPC already enforces WATCH category, immutable
          // lineage, single-item status, duplicate suppression, and release
          // controls. Do not reclassify Cartier as OTHER merely because the
          // maison also produces jewelry; retain the raw cross-brand guard.
          if (laterReviewedBrand && (qnsaBroadPage || fourBrandEffectiveScope)) {
            return !hasObviousCrossBrandConflict(row);
          }
          return isTradingFloorSourceRow(row);
        });
    const effectiveEligibleRows = await loadEffectiveEnrichments(client, eligibleRows);
    const recoveredMarketRecords = await enrichRecordsWithDealerDirectory(
      client,
      (await recoverRecordPrices(effectiveEligibleRows.map(mapReviewedRecord)))
        .map(suppressPublicReferenceTokenPrice),
    );
    let records = recoveredMarketRecords
      .filter(record => (usedLegacyViewContract ? isLegacyReviewedInventoryRecord(record) : true)
        && (!record.multi_listing || record.multi_listing_release_approved === true))
      .filter(record => isPublicTradingIntent(record.listing_type)
        || record.multi_listing_release_approved === true)
      .filter(record => record.item_category === 'WATCH' || record.luxury_identity_eligible === true)
      .filter(record => !listingType || String(record.listing_type || '').toUpperCase() === listingType)
      .filter(record => !requestedModel || cleanExactText(record.model, 120).toLowerCase() === requestedModel.toLowerCase())
      .filter(record => !imagesOnly || record.has_images === true)
      .filter(record => !pricedOnly || hasUsableSourcePrice(record))
      .filter(record => !postedAfter || new Date(record.listing_date || record.created_at || 0).getTime() >= new Date(postedAfter).getTime())
      .filter(record => !requestedDial || cleanExactText(record.dial_color, 40).toLowerCase() === requestedDial.toLowerCase())
      .filter(record => !condition || cleanExactText(record.condition, 80).toLowerCase() === condition.toLowerCase())
      .filter(record => !search || searchTermsMatch(record, search))
      .filter(record => !region || locationMatches(record.location, region))
      .filter(record => ratingMatches(record, rating))
      .filter(record => itemCategory === 'ALL' || record.item_category === itemCategory)
      .sort(compareInventoryForDisplay);
    if (laterReviewedBrand && qnsaBroadPage && records.length === 0 && sourceRows.length > 0) {
      // Later-brand source rows come from a dedicated WATCH-only RPC that has
      // already enforced immutable lineage, single-item status, duplicate and
      // release gates. Preserve those rows if generic cross-category mapping
      // removes the entire Cartier page.
      const effectiveSourceRows = await loadEffectiveEnrichments(client, sourceRows);
      records = (await recoverRecordPrices(effectiveSourceRows.map(mapReviewedRecord)))
        .map(suppressPublicReferenceTokenPrice)
        .filter(record => !record.multi_listing || record.multi_listing_release_approved === true)
        .filter(record => isPublicTradingIntent(record.listing_type)
          || record.multi_listing_release_approved === true)
        .filter(record => !listingType || String(record.listing_type || '').toUpperCase() === listingType)
        .filter(record => !requestedModel || cleanExactText(record.model, 120).toLowerCase() === requestedModel.toLowerCase())
        .filter(record => !imagesOnly || record.has_images === true)
        .filter(record => !pricedOnly || hasUsableSourcePrice(record))
        .filter(record => !postedAfter || new Date(record.listing_date || record.created_at || 0).getTime() >= new Date(postedAfter).getTime())
        .filter(record => !requestedDial || cleanExactText(record.dial_color, 40).toLowerCase() === requestedDial.toLowerCase())
        .filter(record => !condition || cleanExactText(record.condition, 80).toLowerCase() === condition.toLowerCase())
        .filter(record => !search || searchTermsMatch(record, search))
        .filter(record => !region || locationMatches(record.location, region))
        .filter(record => ratingMatches(record, rating))
        .filter(record => itemCategory === 'ALL' || record.item_category === itemCategory)
        .sort(compareInventoryForDisplay)
        .slice(0, pageSize);
    }
    // Cursor offsets belong to the ordered database source, not to the number
    // of cards that survive Node-side presentation filters. Advancing by the
    // rendered count re-reads filtered source rows on the next request, which
    // repeated exact IDs across RM11-03 and WSSA0018 cursor pages. The bounded
    // RPC returns one lookahead row, so rawRows is the exact consumed window.
    let consumedSourceRecordCount = sourceCursorAdvance(rawRows);
    if (firstPageOfLane && !sixBrandBroadScope) {
      const { data: directRows, error: directError } = await directRowsPromise;
      if (!directError) {
        const directRecords = (await enrichRecordsWithDealerDirectory(
          client,
          (directRows || []).map(mapDealerSubmission),
        ))
          .filter(record => directSubmissionMatchesImageLane(record, requestedLane))
          .filter(record => !record.multi_listing && directSubmissionMatches(record, {
            imagesOnly, pricedOnly, listingType, brand, model: requestedModel, reference, dial: requestedDial, condition, search, itemCategory, region,
            rating, postedAfter,
          }));
        const directRecordIds = new Set(directRecords.map(record => String(record.id)));
        records = [...directRecords, ...records]
          .sort(compareInventoryForDisplay)
          .slice(0, pageSize);
        // The cursor advances only past database rows actually shown. Direct
        // submissions are merged on the first page and must not cause unseen
        // source rows to be skipped on the next cursor page.
        if (directRecords.length > 0) {
          consumedSourceRecordCount = sourceCursorAdvance(
            rawRows,
            directRecords.length,
            records.filter(record => !directRecordIds.has(String(record.id))).length,
          );
        }
      }
    }
    if (sixBrandBroadScope && qnsaCandidateCursorMeta
      && !imagesOnly && requestedLane === 'images' && !hasMore) {
      // Start the no-image lane only after every independently paged image
      // stream is exhausted and no fetched row remains buffered.
      nextLane = 'no-images';
      nextOffset = 0;
      qnsaCandidateCursorMeta.nextBrandKeysets = {};
      hasMore = true;
    }
    if (pagination === 'cursor') {
      nextOffset = qnsaCandidateCursorMeta?.nextOffset !== undefined
        ? qnsaCandidateCursorMeta.nextOffset
        : requestedOffset + consumedSourceRecordCount;
    }
    const canonicalBaseHasMore = hasMore;
    const canonicalBaseRecordsAvailable = records.length > 0;
    let reviewedOverlayRecords = [];
    let reviewedOverlayTotal = 0;
    let reviewedOverlaySingleTotal = 0;
    let reviewedOverlayMultiParentTotal = 0;
    let reviewedOverlayDuplicateCount = 0;
    let reviewedOverlayConsumed = 0;
    let reviewedOverlayHasMore = false;
    let reviewedOverlayLaneActive = false;
    const reviewedOverlayBrands = activeMarketSourceView === 'qnsa_rolex_patek_trading_floor_source'
      ? (isRolexPatekOverlayBrand(brand)
        ? [brand]
        : !brand && ['ALL', 'WATCH'].includes(itemCategory)
          ? ['Rolex', 'Patek Philippe'].filter(candidate => !requestedBrands.length || requestedBrands.includes(candidate))
          : [])
      : [];
    if (reviewedOverlayBrands.length) {
      try {
        const overlayListingTypes = listingType === 'MULTI'
          ? ['MULTI']
          : ['WTS', 'WTB', 'OTHER', 'UNKNOWN', ...(listingType ? [] : ['MULTI'])];
        const overlayReferences = requestedReference
          ? listEquivalentReferences(requestedReference, brand || reviewedOverlayBrands[0])
          : [];
        const overlayIncludeMissingIntent = listingType !== 'MULTI';
        const overlayRequest = (overlayBrand, limit, offset, count) =>
          loadRolexPatekOverlayRows(client, {
            brand: overlayBrand,
            references: requestedReference ? listEquivalentReferences(requestedReference, overlayBrand) : overlayReferences,
            listingTypes: overlayListingTypes,
            includeMissingIntent: overlayIncludeMissingIntent,
            includeMultiParents: true,
            limit, offset, count,
          });
        // Count each independent brand stream first, then translate the one
        // public delta offset into a deterministic concatenated-brand offset.
        // This prevents a sparse Patek stream from being skipped while a large
        // Rolex page is returned and keeps database reads page-bounded.
        const overlayCounts = await Promise.all(reviewedOverlayBrands.map(overlayBrand =>
          overlayRequest(overlayBrand, 1, 0, true)));
        reviewedOverlayTotal = overlayCounts.reduce((sum, result) => sum + Number(result.count || 0), 0);
        reviewedOverlaySingleTotal = overlayCounts.reduce((sum, result) => sum + Number(result.singleCount || 0), 0);
        reviewedOverlayMultiParentTotal = overlayCounts.reduce((sum, result) => sum + Number(result.multiParentCount || 0), 0);
        reviewedOverlayLaneActive = requestedDeltaOffset < reviewedOverlayTotal;
        // The reviewed delta is its own deterministic cursor lane. Serve it
        // first so a large canonical base feed cannot make the additions
        // practically unreachable or cause them to be skipped while advancing
        // the base cursor. The canonical base cursor remains frozen until the
        // reviewed lane is exhausted.
        const overlayCapacity = reviewedOverlayLaneActive ? pageSize : 0;
        let remainingGlobalOffset = requestedDeltaOffset;
        let remainingCapacity = overlayCapacity;
        const overlayPlans = [];
        for (let index = 0; index < reviewedOverlayBrands.length && remainingCapacity > 0; index += 1) {
          const brandCount = Number(overlayCounts[index].count || 0);
          if (remainingGlobalOffset >= brandCount) {
            remainingGlobalOffset -= brandCount;
            continue;
          }
          const available = brandCount - remainingGlobalOffset;
          const take = Math.min(remainingCapacity, available);
          overlayPlans.push({ brand: reviewedOverlayBrands[index], offset: remainingGlobalOffset, limit: take });
          remainingCapacity -= take;
          remainingGlobalOffset = 0;
        }
        const overlayResults = await Promise.all(overlayPlans.map(plan =>
          overlayRequest(plan.brand, plan.limit, plan.offset, false)));
        const overlaySourceRows = overlayResults.flatMap(result => result.rows);
        reviewedOverlayConsumed = overlaySourceRows.length;
        if (reviewedOverlayLaneActive && reviewedOverlayConsumed === 0) {
          throw new Error('Reviewed overlay cursor did not advance.');
        }
        const mappedOverlay = await enrichRecordsWithDealerDirectory(
          client,
          overlaySourceRows.map(mapReviewedRecord),
        );
        const filteredOverlay = mappedOverlay
          .filter(record => isPublicTradingIntent(record.listing_type)
            || record.multi_listing_release_approved === true)
          .filter(record => !listingType || String(record.listing_type || '').toUpperCase() === listingType)
          .filter(record => !imagesOnly || record.has_images === true)
          .filter(record => !pricedOnly || hasUsableSourcePrice(record))
          .filter(record => !requestedDial || cleanExactText(record.dial_color, 40).toLowerCase() === requestedDial.toLowerCase())
          .filter(record => !condition || cleanExactText(record.condition, 80).toLowerCase() === condition.toLowerCase())
          .filter(record => !search || searchTermsMatch(record, search))
          .filter(record => !region || locationMatches(record.location, region))
          .filter(record => ratingMatches(record, rating))
          .filter(record => itemCategory === 'ALL' || record.item_category === itemCategory)
          .sort(compareInventoryForDisplay);
        // The reviewed lane is served first, so the hidden frozen base page
        // must not suppress its overlay copy. Deduplicate only within the
        // reviewed page here; matching base rows are removed later when their
        // canonical page is actually served.
        const overlayMerge = mergeByExactLineage([], filteredOverlay);
        reviewedOverlayDuplicateCount = overlayMerge.overlay_duplicate_count;
        reviewedOverlayRecords = boundReviewedOverlayPage(
          [],
          overlayMerge.rows,
          pageSize,
        );
        reviewedOverlayHasMore = requestedDeltaOffset + reviewedOverlayConsumed < reviewedOverlayTotal;
        // Once the reviewed lane is exhausted, every canonical base page is
        // checked against the complete bounded overlay lineage set. This
        // prevents an exact source from reappearing on a later base page.
        if (!reviewedOverlayLaneActive && records.length > 0) {
          const exactKeySets = await Promise.all(reviewedOverlayBrands.map(overlayBrand =>
            loadRolexPatekOverlayExactKeys(client, {
              brand: overlayBrand,
              references: requestedReference ? listEquivalentReferences(requestedReference, overlayBrand) : [],
              listingTypes: overlayListingTypes,
              includeMissingIntent: overlayIncludeMissingIntent,
              includeMultiParents: true,
            })));
          const reviewedExactKeys = new Set(exactKeySets.flatMap(keySet => [...keySet]));
          const deduplicatedBaseRecords = excludeReviewedOverlayExactLineage(
            records,
            reviewedExactKeys,
            privateExactKeysById,
          );
          reviewedOverlayDuplicateCount += records.length - deduplicatedBaseRecords.length;
          records = deduplicatedBaseRecords;
        }
      } catch (overlayError) {
        // Overlay failure must never take the established QNSA feed offline.
        console.warn('[reviewed-market-inventory] Rolex/Patek reviewed overlay unavailable:', overlayError.message);
      }
    }
    const reviewedCursorState = reviewedOverlayCursorState({
      requestedDeltaOffset,
      reviewedOverlayTotal,
      reviewedOverlayConsumed,
      canonicalBaseHasMore,
      canonicalBaseRecordCount: canonicalBaseRecordsAvailable ? 1 : 0,
    });
    reviewedOverlayLaneActive = reviewedCursorState.laneActive;
    reviewedOverlayHasMore = reviewedCursorState.overlayHasMore;
    hasMore = reviewedCursorState.hasMore;
    const reviewedOverlayCountHasUnsupportedFilter = Boolean(
      imagesOnly || pricedOnly || requestedDial || condition || search || region || rating || postedAfter,
    );
    const nextCursor = hasMore
      ? encodeInventoryCursor({
          lane: reviewedOverlayLaneActive ? requestedLane : nextLane,
          offset: reviewedOverlayLaneActive ? requestedOffset : nextOffset,
          deltaOffset: requestedDeltaOffset + reviewedOverlayConsumed,
          page: page + 1,
          brandKeysets: sixBrandKeysetCursor
            ? reviewedOverlayLaneActive
              ? inventoryCursor?.brandKeysets || {}
              : qnsaCandidateCursorMeta?.nextBrandKeysets || {}
            : null,
          brandScope: sixBrandKeysetCursor ? sixBrandScope : null,
        })
      : null;
    const publicationBrands = publicationBrandsFromSummary(summary);
    const publicBaseRecords = (reviewedOverlayLaneActive ? [] : records)
      .map(applyConfirmedFiveWatchPublication);
    const deduplicatedPage = deduplicateRecordsById([...publicBaseRecords, ...reviewedOverlayRecords]);
    const combinedPageRecords = deduplicatedPage.records;
    const combinedPageDuplicateCount = deduplicatedPage.duplicateCount;
    // Serialize the cohort-wide count after the bounded page has been fetched,
    // mapped and filtered. Running both cold scans in parallel caused avoidable
    // database contention; count metadata remains advisory and fail-open.
    if (fourBrandCountOptions) {
      try {
        publicInventoryTotal = await loadEffectiveCount(client, fourBrandCountOptions);
      } catch (effectiveCountError) {
        console.warn('[reviewed-market-inventory] four-brand exact count unavailable; total withheld:', effectiveCountError.message);
        publicInventoryTotal = null;
      }
    }
    const combinedInventoryTotal = combineInventoryTotal(
      publicInventoryTotal,
      reviewedOverlayTotal,
      reviewedOverlayCountHasUnsupportedFilter || reviewedOverlayDuplicateCount > 0 || combinedPageDuplicateCount > 0,
    );

    return res.status(200).json({
      status: 'ok',
      count: combinedPageRecords.length,
      total: combinedInventoryTotal,
      page,
      pageSize,
      totalIsEstimate: false,
      totalStatus: combinedInventoryTotal === null ? 'withheld_for_unsupported_filter' : 'available_from_market_feed_plus_reviewed_overlay_counts',
      hasMore,
      nextCursor,
      records: combinedPageRecords,
      reviewedOverlayRecords,
      reviewedOverlay: {
        source: 'reviewed_workbook_inventory',
        tier: 'QNSA_ROLEX_PATEK_REVIEWED_DELTA_V1',
        total: reviewedOverlayCountHasUnsupportedFilter ? null : reviewedOverlayTotal,
        total_status: reviewedOverlayCountHasUnsupportedFilter
          ? 'withheld_for_client_filtered_overlay'
          : 'exact_approved_overlay_count',
        returned: reviewedOverlayRecords.length,
        reviewed_single_total: reviewedOverlayCountHasUnsupportedFilter ? null : reviewedOverlaySingleTotal,
        structured_multi_parent_total: reviewedOverlayCountHasUnsupportedFilter ? null : reviewedOverlayMultiParentTotal,
        exact_lineage_duplicates_held: reviewedOverlayDuplicateCount,
        exact_listing_id_duplicates_held: combinedPageDuplicateCount,
      },
      summary,
      publicationBrands,
      evidenceContract: EVIDENCE_CONTRACT,
      coverage: summarizeCoverage(combinedPageRecords),
      displayPolicy: {
        unpriced_listings_visible: true,
        unpriced_listings_count_toward_activity: true,
        unpriced_listings_excluded_from_price_analytics: true,
        within_reference_order: 'SUPPLIED_PRICE_FIRST_THEN_PRICE_NOT_SUPPLIED',
      },
      viewContract: usedLegacyViewContract ? 'legacy-compatible' : 'strict',
    });
  } catch (error) {
    console.error('[reviewed-market-inventory] error:', error.message);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(503).json({
      status: 'error',
      error: error.stack,
    });
  }
};

module.exports.EXPLICIT_USD_STATUS = EXPLICIT_USD_STATUS;
module.exports.MULTI_PARENT_VERIFICATION_STATUS = MULTI_PARENT_VERIFICATION_STATUS;
module.exports.MULTI_PARENT_PUBLICATION_LANE = MULTI_PARENT_PUBLICATION_LANE;
module.exports.combineInventoryTotal = combineInventoryTotal;
module.exports.boundReviewedOverlayPage = boundReviewedOverlayPage;
module.exports.reviewedOverlayCursorState = reviewedOverlayCursorState;
module.exports.excludeReviewedOverlayExactLineage = excludeReviewedOverlayExactLineage;
module.exports.MARKET_SOURCE_VIEW = MARKET_SOURCE_VIEW;
module.exports.MULTIPLE_LISTING_IDENTITY_VALUES = MULTIPLE_LISTING_IDENTITY_VALUES;
module.exports.EVIDENCE_CONTRACT = EVIDENCE_CONTRACT;
module.exports.exactHttpUrl = exactHttpUrl;
module.exports.referenceComparisonKey = referenceComparisonKey;
module.exports.referenceIsPriceToken = referenceIsPriceToken;
module.exports.rmReferenceIsMyrPriceArtifact = rmReferenceIsMyrPriceArtifact;
module.exports.suppressPublicReferenceTokenPrice = suppressPublicReferenceTokenPrice;
module.exports.recordEvidenceCoverage = recordEvidenceCoverage;
module.exports.mapDealerSubmission = mapDealerSubmission;
module.exports.directSubmissionMatches = directSubmissionMatches;
module.exports.directSubmissionMatchesImageLane = directSubmissionMatchesImageLane;
module.exports.enrichRecordsWithDealerDirectory = enrichRecordsWithDealerDirectory;
module.exports.summarizeCoverage = summarizeCoverage;
module.exports.hasUsableSourcePrice = hasUsableSourcePrice;
module.exports.hasExactSourceImage = hasExactSourceImage;
module.exports.dealerEvidenceRank = dealerEvidenceRank;
module.exports.hasVerifiedExplicitPrice = hasVerifiedExplicitPrice;
module.exports.listingCompletenessScore = listingCompletenessScore;
module.exports.isExplicitlyReleasedMultiListing = isExplicitlyReleasedMultiListing;
module.exports.inventoryIdentityKey = inventoryIdentityKey;
module.exports.compareInventoryForDisplay = compareInventoryForDisplay;
module.exports.inventoryIntentRank = inventoryIntentRank;
module.exports.isApprovedInventoryRecord = isApprovedInventoryRecord;
module.exports.isTradingFloorSourceRow = isTradingFloorSourceRow;
module.exports.unwrapRpcRowData = unwrapRpcRowData;
module.exports.normalizeItemCategory = normalizeItemCategory;
module.exports.effectiveItemCategory = effectiveItemCategory;
module.exports.hasObviousCrossBrandConflict = hasObviousCrossBrandConflict;
module.exports.isLegacyReviewedInventoryRecord = isLegacyReviewedInventoryRecord;
module.exports.mapReviewedRecord = mapReviewedRecord;
module.exports.isNormalizedWorkbookSummary = isNormalizedWorkbookSummary;
module.exports.isMultiListing = isMultiListing;
module.exports.isAuditedRolexPatekDeltaSingle = isAuditedRolexPatekDeltaSingle;
module.exports.isAuditedFourBrandEffectiveSingle = isAuditedFourBrandEffectiveSingle;
module.exports.safeSearchTerm = safeSearchTerm;
module.exports.locationSearchPattern = locationSearchPattern;
module.exports.locationMatches = locationMatches;
module.exports.postingCountryName = postingCountryName;
module.exports.databasePostingCountryToken = databasePostingCountryToken;
module.exports.deduplicateRecordsById = deduplicateRecordsById;
module.exports.dateWindowStart = dateWindowStart;
module.exports.isSourceBackedRatedDealer = isSourceBackedRatedDealer;
module.exports.ratingMatches = ratingMatches;
module.exports.isPriorityHumanReviewBrand = isPriorityHumanReviewBrand;
module.exports.searchTermsMatch = searchTermsMatch;
module.exports.parseCursorPage = parseCursorPage;
module.exports.parseInventoryCursor = parseInventoryCursor;
module.exports.encodeInventoryCursor = encodeInventoryCursor;
module.exports.sixBrandRowKeyset = sixBrandRowKeyset;
module.exports.compareSixBrandKeysets = compareSixBrandKeysets;
module.exports.compareSixBrandRows = compareSixBrandRows;
module.exports.parseSixBrandEnvelope = parseSixBrandEnvelope;
module.exports.parseSixBrandKeyset = parseSixBrandKeyset;
module.exports.validateSixBrandStreamEnvelope = validateSixBrandStreamEnvelope;
module.exports.refillSixBrandStream = refillSixBrandStream;
module.exports.mergeSixBrandEnvelopes = mergeSixBrandEnvelopes;
module.exports.publicationBrandsFromSummary = publicationBrandsFromSummary;
module.exports.boundedPage = boundedPage;
module.exports.sortPageWithoutMovingLookahead = sortPageWithoutMovingLookahead;
module.exports.sourceCursorAdvance = sourceCursorAdvance;
module.exports.shouldFallbackLaterBrandCandidate = shouldFallbackLaterBrandCandidate;
module.exports.buildLegacyMarketQueryParams = buildLegacyMarketQueryParams;
