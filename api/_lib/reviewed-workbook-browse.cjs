'use strict';

const MARKET_SOURCE_VIEW = 'reviewed_workbook_market_source_v2';
const PAGE_SIZE = 1000;
const MAX_ROWS_PER_BRAND = 10000;
const MINIMUM_ANALYTICS_SAMPLE = 5;
const REFERENCE_ONLY_MODEL = 'Reference-only listings';
// These owner-reviewed admissions are intentionally browsed from their
// released workbook evidence rather than from the static catalog. The catalog
// is identity metadata; it cannot supply observed listing/reference counts.
const REVIEWED_WORKBOOK_BROWSE_BRANDS = new Set([
  'a. lange & söhne',
  'bell & ross',
  'blancpain',
  'breguet',
  'breitling',
  'bulgari',
  'chopard',
  'f.p. journe',
  'franck muller',
  'girard-perregaux',
  'glashütte original',
  'grand seiko',
  'h. moser & cie',
  'hublot',
  'iwc',
  'jacob & co',
  'jaeger-lecoultre',
  'longines',
  'tag heuer',
  'ulysse nardin',
]);
const KNOWN_WATCH_BRANDS = [
  'A. Lange & Söhne',
  'Audemars Piguet',
  'Breguet',
  'Bulgari',
  'Cartier',
  'Franck Muller',
  'Girard-Perregaux',
  'Glashütte Original',
  'Grand Seiko',
  'H. Moser & Cie',
  'IWC',
  'Jacob & Co',
  'Omega',
  'Panerai',
  'Patek Philippe',
  'Piaget',
  'Richard Mille',
  'Rolex',
  'TAG Heuer',
  'Tudor',
  'Ulysse Nardin',
  'Vacheron Constantin',
  'Zenith',
];

function clean(value) {
  const text = String(value || '').trim();
  return text && !/^(?:unknown|null|n\/a)$/i.test(text) ? text : '';
}

const { normalizeCanonicalModel } = require('./catalog-taxonomy');
const { listCanonicalCatalogReferences } = require('./catalog');

const TAG_HEUER_MODEL_PATTERN = /^(?:Aquaracer|Autavia|Carrera|Connected|Formula\s*1|Grand\s+Carrera|Heuer[-\s]?0[12]|Heritage|Link|Mikrograph|Monaco|Montreal|Monza|Professional)\b/i;
const TAG_HEUER_UNCATALOGUED_REFERENCE_PATTERN = /^(?:C[A-Z]{1,3}|W[A-Z]{1,3}|S[A-Z]{1,3})\d/i;
const tagReferenceKey = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const TAG_HEUER_CATALOG_BY_REFERENCE = new Map(listCanonicalCatalogReferences('TAG Heuer')
  .map(entry => [tagReferenceKey(entry.reference), entry]));

function rowModel(row) {
  const ownerBrand = clean(row.brand_scope).toLowerCase();
  const reference = rowReference(row);
  if (ownerBrand === 'tag heuer') {
    const catalog = TAG_HEUER_CATALOG_BY_REFERENCE.get(tagReferenceKey(reference));
    if (catalog?.model) {
      return normalizeCanonicalModel(catalog.model, 'TAG Heuer');
    }
  }
  const claimed = clean(row.catalog_model) || clean(row.model);
  if (!claimed || /^\d+$/.test(claimed) || /^\d{4}[/-]\d{1,2}$/.test(claimed)) {
    return REFERENCE_ONLY_MODEL;
  }
  const foreignBrand = KNOWN_WATCH_BRANDS.some(brand => (
    brand.toLowerCase() !== ownerBrand
    && claimed.toLowerCase().includes(brand.toLowerCase())
  ));
  // TAG Heuer's reviewed workbook contains confirmed cross-brand residuals
  // whose claimed models (for example GMT-Master and RM 72-01) do not contain
  // a foreign brand name.  Uncatalogued TAG rows therefore need a positive
  // TAG collection identity before they may enter model/reference browsing.
  if (ownerBrand === 'tag heuer') {
    if (!TAG_HEUER_MODEL_PATTERN.test(claimed)
      || !TAG_HEUER_UNCATALOGUED_REFERENCE_PATTERN.test(reference)) return '';
  }
  const rawResult = foreignBrand ? REFERENCE_ONLY_MODEL : claimed;
  return normalizeCanonicalModel(rawResult, row.brand_scope || row.brand);
}

function rowReference(row) {
  return clean(row.public_reference)
    || clean(row.normalized_reference)
    || clean(row.raw_reference)
    || clean(row.catalog_reference);
}

function isReviewedWorkbookBrowseBrand(value) {
  return REVIEWED_WORKBOOK_BROWSE_BRANDS.has(clean(value).toLowerCase());
}

async function loadReviewedWorkbookBrandRows(client, brand) {
  const admissionSource = isReviewedWorkbookBrowseBrand(brand);
  const sourceTable = admissionSource ? 'reviewed_workbook_inventory' : MARKET_SOURCE_VIEW;
  const rows = [];
  for (let from = 0; from < MAX_ROWS_PER_BRAND; from += PAGE_SIZE) {
    let query = client
      .from(sourceTable)
      .select([
        'id',
        'brand_scope',
        'model',
        'catalog_model',
        'public_reference',
        'raw_reference',
        'normalized_reference',
        'catalog_reference',
        'dial_color',
        'catalog_dial',
        'listing_type',
        'posting_date',
        'price_evidence_status',
        'workbook_price_usd',
        'has_verified_usd_price',
        'verified_price_usd',
      ].filter(column => !admissionSource || !['public_reference', 'has_verified_usd_price', 'verified_price_usd'].includes(column)).join(','))
      .eq('brand_scope', brand);
    query = admissionSource
      ? query.eq('verification_status', 'APPROVED_SINGLE_CANDIDATE').eq('confidence', 100).in('listing_type', ['WTS', 'WTB'])
      : query.eq('has_complete_identity', true);
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []).map(row => admissionSource ? {
      ...row,
      public_reference: row.normalized_reference || row.raw_reference || row.catalog_reference,
      has_verified_usd_price: row.listing_type === 'WTS'
        && row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
        && Number(row.workbook_price_usd) > 0,
      verified_price_usd: row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
        ? Number(row.workbook_price_usd) || null
        : null,
    } : row));
    if (!data || data.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function loadReviewedWorkbookBrandCount(client, brand) {
  if (!isReviewedWorkbookBrowseBrand(brand)) return 0;
  const { count, error } = await client
    .from('reviewed_workbook_inventory')
    .select('id', { count: 'exact', head: true })
    .eq('brand_scope', brand)
    .eq('verification_status', 'APPROVED_SINGLE_CANDIDATE')
    .eq('confidence', 100)
    .in('listing_type', ['WTS', 'WTB']);
  if (error) throw error;
  return Number(count || 0);
}

function summarizeReviewedWorkbookModels(rows) {
  const models = new Map();
  for (const row of rows) {
    const reference = rowReference(row);
    if (!reference) continue;
    const model = rowModel(row);
    if (!model) continue;
    const current = models.get(model) || { references: new Set(), listing_count: 0 };
    current.references.add(reference);
    current.listing_count += 1;
    models.set(model, current);
  }
  return [...models.entries()]
    .map(([model, value]) => ({
      model,
      reference_count: value.references.size,
      listing_count: value.listing_count,
    }))
    .sort((left, right) => right.listing_count - left.listing_count || left.model.localeCompare(right.model));
}

function summarizeReviewedWorkbookReferences(rows, requestedModel, truncated = false) {
  const references = new Map();
  for (const row of rows) {
    if (rowModel(row) !== requestedModel) continue;
    const reference = rowReference(row);
    if (!reference) continue;
    const current = references.get(reference) || { members: 0, eligiblePrices: [], dials: new Map() };
    current.members += 1;
    const verifiedPrice = Number(row.verified_price_usd);
    if (
      String(row.listing_type || '').toUpperCase() === 'WTS'
      && (row.has_verified_usd_price === true
        || ['SOURCE_EXPLICIT_USD_MATCH', 'EXPLICIT_SOURCE_FX_CONVERTED'].includes(row.price_evidence_status))
      && Number.isFinite(verifiedPrice)
      && verifiedPrice > 0
    ) {
      current.eligiblePrices.push(verifiedPrice);
    }
    const dial = clean(row.catalog_dial) || clean(row.dial_color);
    if (dial) current.dials.set(dial, (current.dials.get(dial) || 0) + 1);
    references.set(reference, current);
  }
  return [...references.entries()]
    .map(([reference, value]) => ({
      reference,
      listing_count: value.members,
      eligible_observation_count: value.eligiblePrices.length,
      analytics_ready: value.eligiblePrices.length >= MINIMUM_ANALYTICS_SAMPLE,
      sample_capped: truncated,
      avg_price: value.eligiblePrices.length >= MINIMUM_ANALYTICS_SAMPLE
        ? Math.round(value.eligiblePrices.reduce((sum, price) => sum + price, 0) / value.eligiblePrices.length)
        : null,
      dial_colors: [...value.dials.entries()]
        .map(([dial_color, count]) => ({ dial_color, count }))
        .sort((left, right) => right.count - left.count || left.dial_color.localeCompare(right.dial_color)),
      identity_source: 'OWNER_REVIEWED_WORKBOOK',
    }))
    .sort((left, right) => right.listing_count - left.listing_count || left.reference.localeCompare(right.reference));
}

module.exports = {
  MARKET_SOURCE_VIEW,
  REVIEWED_WORKBOOK_BROWSE_BRANDS,
  isReviewedWorkbookBrowseBrand,
  loadReviewedWorkbookBrandCount,
  loadReviewedWorkbookBrandRows,
  rowModel,
  rowReference,
  summarizeReviewedWorkbookModels,
  summarizeReviewedWorkbookReferences,
};
