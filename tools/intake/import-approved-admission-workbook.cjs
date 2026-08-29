'use strict';

// Strict admission-workbook importer for the existing service-only reviewed
// workbook inventory. Dry-run is the default. Apply mode is deliberately
// allowlisted, resumable, and never writes to watch_records or staging.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const { multiItemRisk } = require('../../api/_lib/unsplit-bundle-filter.cjs');
const {
  confirmCatalogCandidate,
  rawSupportsExactReference,
  rawSupportsReferenceToken,
} = require('../../api/_lib/catalog-confirmation.cjs');
const { assessReferenceQuality } = require('../../api/_lib/reference-quality.cjs');
const {
  comparisonKey,
  extractDialFromText,
  normalizeDialValue,
} = require('../../api/_lib/dial-normalization.cjs');
const {
  SOURCE_HEADERS,
  DECISION_HEADERS,
  admissionIntent,
  classifyRow,
  normalizeReference,
} = require('./prepare-franck-muller-admission.cjs');

const INVENTORY_TABLE = 'reviewed_workbook_inventory';
const CHECKPOINT_TABLE = 'reviewed_workbook_import_checkpoints';
const SOURCE_SHEET = 'Trading Floor & Price Research';
const MULTI_PARENT_LISTING_TYPE = 'MULTI';
const MULTI_PARENT_VERIFICATION_STATUS = 'APPROVED_MULTI_PARENT_TRADING_FLOOR_ONLY';
const MULTI_PARENT_VERIFICATION_TIER = 'OWNER_MULTI_PARENT_SOURCE_LINEAGE_V1';
const OWNER_UNBUNDLED_BRANDS = new Set([
  'A. Lange & Söhne',
  'Audemars Piguet',
  'Bell & Ross',
  'Blancpain',
  'Breguet',
  'Breitling',
  'Bulgari',
  'Cartier',
  'Chopard',
  'F.P. Journe',
  'Franck Muller',
  'Girard-Perregaux',
  'Glashütte Original',
  'Grand Seiko',
  'H. Moser & Cie',
  'Hublot',
  'IWC',
  'Jacob & Co',
  'Jaeger-LeCoultre',
  'Longines',
  'Omega',
  'Ulysse Nardin',
  'Zenith',
]);
const POSITIVE_IDENTITY_REQUIRED_BRANDS = new Set(OWNER_UNBUNDLED_BRANDS);
POSITIVE_IDENTITY_REQUIRED_BRANDS.add('TAG Heuer');
const PRICE_RESEARCH_ONLY_REASONS = new Set([
  'PRICE_RESEARCH_EVIDENCE_INCOMPLETE',
  'RAW_SELL_SIDE_LANGUAGE_MISSING',
  'WTB_DEMAND_EXCLUDED_FROM_WTS_ANALYTICS',
]);
const EXPLICIT_BRAND_PATTERNS = [
  ['Rolex', /\b(?:rolex|daytona|datejust|submariner|day[- ]?date|sky[- ]?dweller)\b/i],
  ['Patek Philippe', /\b(?:patek(?:\s+philippe)?|nautilus|aquanaut)\b/i],
  ['Audemars Piguet', /\b(?:audemars(?:\s+piguet)?|royal\s+oak)\b/i],
  ['Richard Mille', /\b(?:richard\s+mille|RM\s?\d{2,3})\b/i],
  ['Cartier', /\b(?:cartier|santos)\b/i],
  ['Zenith', /\bzenith\b/i],
  ['TAG Heuer', /\b(?:tag\s*heuer|tagheuer)\b/i],
  ['Breguet', /\bbreguet\b/i],
  ['Franck Muller', /\bfranck\s+muller\b/i],
  ['Blancpain', /\bblancpain\b/i],
  ['Bulgari', /\b(?:bulgari|bvlgari)\b/i],
  ['Chopard', /\bchopard\b/i],
  ['Girard-Perregaux', /\bgirard[- ]perregaux\b/i],
  ['Glashütte Original', /\bglash.{0,2}tte(?:\s+original)?\b/i],
  ['Grand Seiko', /\bgrand\s+seiko\b/i],
  ['H. Moser & Cie', /\bmoser\b/i],
  ['Jacob & Co', /\bjacob\s*(?:&|and)\s*co\b/i],
  ['Ulysse Nardin', /\bulysse\s+nardin\b/i],
  ['Omega', /\b(?:omega|seamaster|speedmaster)\b/i],
  ['Panerai', /\b(?:panerai|PAM\d{3,4})\b/i],
  ['Hublot', /\b(?:hublot|big\s+bang)\b/i],
  ['IWC', /\b(?:IWC|IW\d{4,6})\b/i],
  ['Breitling', /\b(?:breitling|navitimer|chronomat)\b/i],
  ['Vacheron Constantin', /\b(?:vacheron(?:\s+constantin)?|overseas|patrimony)\b/i],
  ['Tudor', /\btudor\b/i],
  ['A. Lange & Söhne', /\b(?:a\.?\s*lange|lange\s*(?:&|und)\s*s[oö]hne)\b/i],
  ['F.P. Journe', /\b(?:f\.?\s*p\.?\s*journe|fpj)\b/i],
  ['Piaget', /\bpiaget\b/i],
  ['Montblanc', /\bmontblanc\b/i],
  ['Jaeger-LeCoultre', /\b(?:jaeger[- ]lecoultre|reverso)\b/i],
  ['Bell & Ross', /\bbell\s*(?:&|and)\s*ross\b/i],
  ['MB&F', /\bMB\s*(?:&|and)\s*F\b/i],
];
// Admission quarantine uses brand names only. Collection names such as
// "Overseas" and "Santos" are intentionally excluded because they also occur
// in shipping/location/person text and are unsafe production hold evidence.
const STRICT_EXPLICIT_BRAND_PATTERNS = [
  ['Rolex', /\brolex\b/i],
  ['Patek Philippe', /\bpatek(?:\s+philippe)?\b/i],
  ['Audemars Piguet', /\b(?:audemars\s+piguet|audemars)\b/i],
  ['Richard Mille', /\brichard\s+mille\b/i],
  ['Cartier', /\bcartier\b/i],
  ['Zenith', /\bzenith\b/i],
  ['TAG Heuer', /\b(?:tag\s*heuer|tagheuer)\b/i],
  ['Breguet', /\bbreguet\b/i],
  ['Franck Muller', /\bfranck\s+muller\b/i],
  ['Blancpain', /\bblancpain\b/i],
  ['Bulgari', /\b(?:bulgari|bvlgari)\b/i],
  ['Chopard', /\bchopard\b/i],
  ['Girard-Perregaux', /\bgirard[- ]perregaux\b/i],
  ['Glashütte Original', /\bglash.{0,2}tte(?:\s+original)?\b/i],
  ['Grand Seiko', /\bgrand\s+seiko\b/i],
  ['H. Moser & Cie', /\bmoser\b/i],
  ['Jacob & Co', /\bjacob\s*(?:&|and)\s*co\b/i],
  ['Ulysse Nardin', /\bulysse\s+nardin\b/i],
  ['Omega', /\bomega\b/i],
  ['Panerai', /\bpanerai\b/i],
  ['Hublot', /\bhublot\b/i],
  ['IWC', /\bIWC\b/i],
  ['Breitling', /\bbreitling\b/i],
  ['Vacheron Constantin', /\b(?:vacheron\s+constantin|vacheron)\b/i],
  ['Tudor', /\btudor\b/i],
  ['A. Lange & Söhne', /\b(?:a\.?\s*lange|lange\s*(?:&|und)\s*s[oö]hne)\b/i],
  ['F.P. Journe', /\b(?:f\.?\s*p\.?\s*journe|fpj)\b/i],
  ['Piaget', /\bpiaget\b/i],
  ['Montblanc', /\bmontblanc\b/i],
  ['Jaeger-LeCoultre', /\bjaeger[- ]lecoultre\b/i],
  ['Bell & Ross', /\bbell\s*(?:&|and)\s*ross\b/i],
  ['MB&F', /\bMB\s*(?:&|and)\s*F\b/i],
];

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function explicitBrandsInRaw(rawMessage) {
  return EXPLICIT_BRAND_PATTERNS
    .filter(([, pattern]) => pattern.test(String(rawMessage || '')))
    .map(([brand]) => brand);
}

function strictExplicitBrandsInRaw(rawMessage) {
  return STRICT_EXPLICIT_BRAND_PATTERNS
    .filter(([, pattern]) => pattern.test(String(rawMessage || '')))
    .map(([brand]) => brand);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isoDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function requireHeaders(rows, required, sheetName) {
  const headers = Object.keys(rows[0] || {});
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`${sheetName} is missing required headers: ${missing.join(', ')}`);
}

function readAdmissionWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const decisionSheetName = workbook.SheetNames.find(
    name => name !== SOURCE_SHEET && /admission/i.test(name),
  );
  if (!workbook.Sheets[SOURCE_SHEET] || !decisionSheetName) {
    throw new Error(`required admission worksheets missing; found: ${workbook.SheetNames.join(', ')}`);
  }
  const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[SOURCE_SHEET], {
    defval: null,
    raw: true,
  }).filter(row => Object.values(row).some(value => text(value)));
  const decisionRows = XLSX.utils.sheet_to_json(workbook.Sheets[decisionSheetName], {
    defval: null,
    raw: true,
  }).filter(row => Object.values(row).some(value => text(value)));
  requireHeaders(sourceRows, SOURCE_HEADERS, SOURCE_SHEET);
  requireHeaders(decisionRows, DECISION_HEADERS, decisionSheetName);
  const decisions = new Map();
  for (const decision of decisionRows) {
    const listingId = text(decision.listing_id);
    if (!listingId || decisions.has(listingId)) {
      throw new Error(`decision ledger has missing or duplicate listing_id: ${listingId || '(blank)'}`);
    }
    decisions.set(listingId, decision);
  }
  if (sourceRows.length !== decisionRows.length) {
    throw new Error(`source/decision row count mismatch: ${sourceRows.length}/${decisionRows.length}`);
  }
  return {
    fileSha256: sha256(buffer),
    sourceRows,
    decisions,
    decisionSheetName,
  };
}

function firstExactImage(value) {
  const candidates = text(value).split(/[\r\n,;|]+/).map(item => item.trim()).filter(Boolean);
  return candidates.find(item => /^https?:\/\/[^\s]+$/i.test(item)) || null;
}

function sourcePriceEvidence(source, options = {}) {
  const currency = text(source.source_currency).toUpperCase() || null;
  const normalizedUsd = Number(source.normalized_price_usd);
  const observations = extractPriceObservations(text(source.raw_message), {});
  const primary = observations.find(item => item.is_primary) || observations[0] || null;
  const sourceAmount = primary && Number(primary.amount_original) > 0
    ? Number(primary.amount_original)
    : null;
  const sourceText = text(source.asking_price_raw) || primary?.raw_price_text || null;
  if (options.rawExplicitUsdOnly) {
    const explicitUsd = observations.find(item => (
      ['USD', 'USDT'].includes(String(item.currency_original || '').toUpperCase())
      && Number(item.amount_original) > 0
      && item.currency_evidence === 'explicit_line_currency'
    ));
    if (explicitUsd) {
      return {
        workbookPriceUsd: Number(explicitUsd.amount_original),
        sourceAmount: Number(explicitUsd.amount_original),
        sourceText: explicitUsd.raw_price_text || null,
        currency: String(explicitUsd.currency_original).toUpperCase(),
        status: 'SOURCE_EXPLICIT_USD_MATCH',
        reextractedFromRaw: Number(normalizedUsd) !== Number(explicitUsd.amount_original),
      };
    }
    return {
      workbookPriceUsd: null,
      sourceAmount: null,
      sourceText: null,
      currency: null,
      status: 'PRICE_NOT_SUPPLIED',
      reextractedFromRaw: false,
    };
  }
  if (
    ['USD', 'USDT'].includes(currency)
    && currency === text(primary?.currency_original).toUpperCase()
    && sourceAmount !== null
    && Number.isFinite(normalizedUsd)
    && normalizedUsd > 0
    && Math.abs(sourceAmount - normalizedUsd) <= 0.01
    && primary?.currency_evidence === 'explicit_line_currency'
  ) {
    return {
      workbookPriceUsd: normalizedUsd,
      sourceAmount,
      sourceText,
      currency,
      status: 'SOURCE_EXPLICIT_USD_MATCH',
    };
  }
  if (
    currency
    && currency === text(primary?.currency_original).toUpperCase()
    && sourceAmount !== null
    && Number.isFinite(normalizedUsd)
    && normalizedUsd > 0
    && text(source.fx_source)
    && text(source.fx_rate_date)
  ) {
    return {
      workbookPriceUsd: normalizedUsd,
      sourceAmount,
      sourceText,
      currency,
      // The existing inventory schema has no named FX source/date columns.
      // Retain the normalized amount for review, but fail closed for analytics.
      status: 'DATED_FX_PROVENANCE_REQUIRES_EXISTING_SIDECAR',
    };
  }
  return {
    workbookPriceUsd: Number.isFinite(normalizedUsd) && normalizedUsd > 0 ? normalizedUsd : null,
    sourceAmount,
    sourceText,
    currency,
    status: sourceAmount === null ? 'PRICE_NOT_SUPPLIED' : 'PRICE_EVIDENCE_INCOMPLETE',
  };
}

function additionalImportReasons(source, options = {}) {
  const reasons = [];
  if (!isoDate(source.source_posted_at)) reasons.push('SOURCE_POSTING_TIME_INVALID');
  if (!options.allowNoImage && !firstExactImage(source.image_urls_source)) reasons.push('EXACT_SOURCE_IMAGE_URL_MISSING');
  if (multiItemRisk(source.raw_message).is_multi) reasons.push('RAW_MULTI_ITEM_RISK');
  if (!['WTS', 'WTB'].includes(resolvedListingType(source, options.ownerUnbundled === true))) {
    reasons.push('LISTING_TYPE_UNRESOLVED');
  }
  return reasons;
}

function admissionIdentityConflictReasons(source, decision, expectedBrand) {
  const reasons = [];
  const rawMessage = text(source.raw_message);
  const reference = normalizeReference(decision.final_reference);
  const explicitBrands = strictExplicitBrandsInRaw(rawMessage);
  const conflictingBrands = explicitBrands.filter(brand => brand !== expectedBrand);
  if (conflictingBrands.length) reasons.push('RAW_BRAND_SCOPE_CONFLICT');
  if (/^(?:19|20)\d{2}$/.test(reference || '')) reasons.push('REFERENCE_IS_YEAR_TOKEN');

  const expectedBrandExplicit = explicitBrands.includes(expectedBrand);
  const catalog = confirmCatalogCandidate({ brand: expectedBrand, reference });
  if (
    !expectedBrandExplicit
    && catalog.reason === 'CATALOG_BRAND_CONFLICT'
    && rawSupportsReferenceToken(rawMessage, reference)
  ) {
    reasons.push('CATALOG_BRAND_SCOPE_CONFLICT');
  }
  return reasons;
}

function admissionIdentityGateReasons(source, decision, expectedBrand) {
  const conflicts = admissionIdentityConflictReasons(source, decision, expectedBrand);
  if (conflicts.length || !POSITIVE_IDENTITY_REQUIRED_BRANDS.has(expectedBrand)) return conflicts;
  const rawMessage = text(source.raw_message);
  const reference = normalizeReference(decision.final_reference);
  const exactReferenceInRaw = rawSupportsReferenceToken(rawMessage, reference);
  const explicitExpectedBrand = strictExplicitBrandsInRaw(rawMessage).includes(expectedBrand);
  const catalog = confirmCatalogCandidate({ brand: expectedBrand, reference });
  const exactCatalogMatch = catalog.confirmed && catalog.match?.brand === expectedBrand;
  return exactReferenceInRaw && (explicitExpectedBrand || exactCatalogMatch)
    ? []
    : ['POSITIVE_BRAND_IDENTITY_EVIDENCE_MISSING'];
}

function listingType(value) {
  const normalized = text(value).toUpperCase();
  return ['WTS', 'WTB'].includes(normalized) ? normalized : 'OTHER';
}

function strictReferenceFromRaw(rawMessage, brand, claimedReference = null, priceRaw = null) {
  const raw = text(rawMessage);
  const claimed = normalizeReference(claimedReference);
  const comparableBrand = text(brand).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const comparableClaim = text(claimed).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const patterns = {
    'Glashütte Original': /\b(?:\d-)?\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\b/i,
    'H. Moser & Cie': /\b\d{4}-\d{4}\b/i,
    'Girard-Perregaux': /\b\d{5}-[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/i,
    'Ulysse Nardin': /\b\d{3,4}-\d{2,4}(?:[-/][A-Z0-9]+){1,4}\b/i,
    Blancpain: /\b\d{4}(?:[- ][A-Z0-9]{2,6}){2,4}\b/i,
    Zenith: /\b\d{2}\.\d{4}\.\d{3,4}\/[0-9A-Z]+(?:\.[0-9A-Z]+)*\b/i,
    Bulgari: /\b10\d{4}\b/i,
    'Grand Seiko': /\b(?:SBGA|SBGC|SBGE|SBGH|SBGJ|SBGM|SBGP|SBGW|SLGA|SLGC|SLGH|STGF)[A-Z0-9]{2,6}\b/i,
    Chopard: /\b(?:16|17|20|27|83)\d{2,4}(?:-[A-Z0-9]+){0,3}\b/i,
    'Jacob & Co': /\b[A-Z]{1,4}\d{2,4}(?:\.[A-Z0-9]+){2,6}\b/i,
  };
  const match = patterns[brand] ? raw.match(patterns[brand]) : null;
  if (match) return normalizeReference(match[0]);
  if (comparableClaim && comparableBrand.includes(comparableClaim) && comparableClaim.length < 8) {
    return null;
  }

  // The brand-specific evidence auditor covers the broader watch set and is
  // still fail-closed: it rejects price-like, non-watch, multi-watch, and
  // wrong-brand candidates. The reviewed workbook claim is accepted only
  // when that exact token is recoverable from this child's immutable segment.
  const assessment = assessReferenceQuality({
    brand,
    reference: claimed,
    rawLine: raw,
    priceRaw,
  });
  const blockingReasons = new Set([
    'ACCESSORY_NOT_WATCH',
    'NON_WATCH_OR_WRONG_CATEGORY',
    'MULTI_WATCH_STOCK_LIST',
    'REFERENCE_IS_PRICE_OR_LISTING_TEXT',
    'REFERENCE_IS_BRAND_ONLY',
    'WRONG_BRAND_SUSPECT',
    'NEEDS_MANUAL_REVIEW',
  ]);
  if (assessment.reasons.some(reason => blockingReasons.has(reason))) return null;
  const candidate = assessment.proposed_reference
    || assessment.extracted_reference
    || claimed;
  const candidateText = text(candidate).toUpperCase();
  const candidateCatalog = confirmCatalogCandidate({ brand, reference: candidate });
  if (!/\d/.test(candidateText)
    && (!candidateCatalog.confirmed || candidateCatalog.match?.brand !== brand)) return null;
  if (/^(?:19|20)\d{2}(?:YEAR)?$/.test(candidateText)
    || /^\d{1,3}[,.]\d{2}$/.test(candidateText)
    || /^[A-Z]{2,20}$/.test(candidateText)
    || /(?:YEAR|PRICE|USD|USDT|HKD|GOOD|LIKE|UNIQUE|MASTER|LEGEND)/.test(candidateText)) {
    if (!candidateCatalog.confirmed || candidateCatalog.match?.brand !== brand) return null;
  }
  return candidate && (
    rawSupportsExactReference(raw, candidate) || rawSupportsReferenceToken(raw, candidate)
  )
    ? normalizeReference(candidate)
    : null;
}

function ownerUnbundledIdentitySupported({ rawMessage, brand, reference }) {
  if (!reference) return false;
  if (strictExplicitBrandsInRaw(rawMessage).includes(brand)) return true;
  const catalog = confirmCatalogCandidate({ brand, reference });
  return catalog.confirmed && catalog.match?.brand === brand;
}

function rawSupportsModel(rawMessage, model) {
  const parts = text(model).match(/[A-Z0-9]+/gi) || [];
  if (!parts.length) return false;
  const pattern = parts
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^A-Z0-9]+');
  return new RegExp(`(?<![A-Z0-9])${pattern}(?![A-Z0-9])`, 'i').test(text(rawMessage));
}

function verifiedOwnerUnbundledModel({ rawMessage, brand, reference, claimedModel }) {
  const claimed = text(claimedModel);
  if (claimed && rawSupportsModel(rawMessage, claimed)) {
    return { model: claimed, catalogModel: null, evidence: 'EXACT_CHILD_RAW_MODEL' };
  }
  const catalog = confirmCatalogCandidate({ brand, reference });
  if (!catalog.confirmed || catalog.match?.brand !== brand) {
    return { model: null, catalogModel: null, evidence: null };
  }
  const catalogModel = text(catalog.match?.model || catalog.match?.collection) || null;
  return {
    model: catalogModel,
    catalogModel,
    evidence: catalogModel ? 'EXACT_CATALOG_REFERENCE_MODEL' : null,
  };
}

function classifyOwnerUnbundledRow(source, decision, expectedBrand) {
  const reasons = [];
  if (text(decision.final_brand) !== expectedBrand) reasons.push('BRAND_SCOPE_MISMATCH');
  if (text(source.category).toUpperCase() !== 'WATCH') reasons.push('NON_WATCH_ROUTE_LUXURY_RESEARCH');
  if (text(decision.identity_status) !== 'VERIFIED') reasons.push('IDENTITY_REVIEW_REQUIRED');
  if (text(decision.bundle_status) !== 'SINGLE_CANDIDATE') reasons.push('BUNDLE_PENDING_SEPARATION');
  if (text(decision.duplicate_decision) !== 'COUNT') reasons.push('REPOST_OR_DUPLICATE_EXCLUDED');
  if (text(decision.trading_floor_status).toUpperCase() !== 'PUBLISH') reasons.push('NOT_APPROVED_FOR_TRADING_FLOOR');
  if (!/\bUNBUNDLED_STANDALONE_PASSED\b/.test(text(decision.review_reason))) reasons.push('OWNER_UNBUNDLE_REVIEW_MISSING');
  if (!text(decision.final_model)) reasons.push('MODEL_UNRESOLVED');
  if (!text(source.listing_id) || !text(source.source_message_id) || !text(source.raw_message)) reasons.push('IMMUTABLE_SOURCE_LINEAGE_MISSING');
  if (!isoDate(source.source_posted_at)) reasons.push('SOURCE_POSTING_TIME_INVALID');
  if (!text(source.seller_source_id) || !text(source.seller_name_source)) reasons.push('SELLER_IDENTITY_MISSING');
  if (!['WTS', 'WTB'].includes(resolvedListingType(source, true))) reasons.push('LISTING_TYPE_UNRESOLVED');
  return { trading_floor_candidate: reasons.length === 0, price_research_candidate: false, reasons };
}

function verifiedOwnerUnbundledDial({ rawMessage, brand, reference, claimedDial }) {
  const claimed = normalizeDialValue(claimedDial);
  if (!claimed.known || !reference) return null;
  const rawDial = extractDialFromText(rawMessage, []);
  if (rawDial && comparisonKey(rawDial) === comparisonKey(claimed.value)) {
    return rawDial;
  }
  const catalog = confirmCatalogCandidate({
    brand,
    reference,
    dial_color: claimed.value,
  });
  return catalog.confirmed && catalog.dialConfirmed
    ? catalog.canonicalDial || claimed.value
    : null;
}

function resolvedListingType(source, ownerUnbundled) {
  const evidence = admissionIntent(source.raw_message, source.intent);
  if (evidence.intent === 'WTS' || evidence.intent === 'WTB') return evidence.intent;
  return ownerUnbundled ? 'OTHER' : listingType(source.intent);
}

function rowForImport({
  source, decision, expectedBrand, fileName, fileSha256, rowNumber, runId,
  ownerUnbundled = false, retainIdentityConflictsForAudit = false,
}) {
  const admission = ownerUnbundled
    ? classifyOwnerUnbundledRow(source, decision, expectedBrand)
    : classifyRow(source, decision, expectedBrand);
  if (!admission.trading_floor_candidate || additionalImportReasons(source, {
    allowNoImage: ownerUnbundled,
    ownerUnbundled,
  }).length || (
    !retainIdentityConflictsForAudit
    && admissionIdentityGateReasons(source, decision, expectedBrand).length
  )) return null;
  const rawMessage = text(source.raw_message);
  const listingId = text(source.listing_id);
  const sourceMessageId = text(source.source_message_id);
  const reference = ownerUnbundled
    ? strictReferenceFromRaw(
      rawMessage,
      expectedBrand,
      decision.final_reference,
      source.asking_price_raw,
    )
    : normalizeReference(decision.final_reference);
  const image = ownerUnbundled ? null : firstExactImage(source.image_urls_source);
  const resolvedType = resolvedListingType(source, ownerUnbundled);
  const ownerDial = ownerUnbundled ? verifiedOwnerUnbundledDial({
    rawMessage,
    brand: expectedBrand,
    reference,
    claimedDial: decision.dial_normalized,
  }) : null;
  const ownerModel = ownerUnbundled ? verifiedOwnerUnbundledModel({
    rawMessage,
    brand: expectedBrand,
    reference,
    claimedModel: decision.final_model,
  }) : null;
  const extractedPrice = sourcePriceEvidence(source, { rawExplicitUsdOnly: ownerUnbundled });
  const intentEvidence = admissionIntent(rawMessage, source.intent);
  const priceResearchCandidate = ownerUnbundled
    ? resolvedType === 'WTS'
      && intentEvidence.raw_sell_side
      && extractedPrice.status === 'SOURCE_EXPLICIT_USD_MATCH'
      && Boolean(reference)
      && Boolean(ownerDial)
      && ownerUnbundledIdentitySupported({ rawMessage, brand: expectedBrand, reference })
    : admission.price_research_candidate;
  const price = priceResearchCandidate
    ? extractedPrice
    : resolvedType !== 'WTS'
      ? {
        workbookPriceUsd: null,
        sourceAmount: null,
        sourceText: null,
        currency: null,
        status: 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
        reextractedFromRaw: false,
      }
    : {
      ...extractedPrice,
      status: extractedPrice.status === 'PRICE_NOT_SUPPLIED'
        ? extractedPrice.status
        : 'PRICE_RESEARCH_ADMISSION_NOT_ELIGIBLE',
    };
  const contentHash = sha256([
    expectedBrand,
    listingId,
    sourceMessageId,
    rawMessage,
    reference,
  ].join('|'));
  return {
    id: `admission_${contentHash}`,
    content_hash: contentHash,
    import_run_id: runId,
    source_file: fileName,
    source_file_sha256: fileSha256,
    source_worksheet: SOURCE_SHEET,
    source_row_number: rowNumber,
    source_record_id: listingId,
    source_platform: ownerUnbundled ? text(source.source_platform) || null : null,
    source_group_id: ownerUnbundled ? text(source.source_group_id) || null : null,
    source_message_id: ownerUnbundled ? sourceMessageId : null,
    parent_source_message_id: ownerUnbundled
      ? sourceMessageId.replace(/_item_\d+$/i, '')
      : null,
    source_payload_sha256: sha256(JSON.stringify({ source, decision })),
    posting_date: isoDate(source.source_posted_at),
    posted_by: text(source.seller_name_source) || null,
    phone_number: null,
    raw_message: rawMessage,
    listing_type: resolvedType,
    brand_scope: expectedBrand,
    supplied_brand: expectedBrand,
    canonical_brand: expectedBrand,
    model: ownerUnbundled ? ownerModel.model : text(decision.final_model),
    // Owner-unbundled workbook reference cells are only review hints. When
    // strict child evidence rejects the hint, keep it solely in the immutable
    // raw message rather than letting the public mapper fall back to it.
    raw_reference: ownerUnbundled ? reference : text(source.source_reference_text) || reference,
    normalized_reference: reference,
    catalog_reference: reference,
    catalog_model: ownerUnbundled ? ownerModel.catalogModel : text(decision.final_model),
    dial_color: ownerUnbundled ? ownerDial : text(decision.dial_normalized) || null,
    catalog_dial: ownerUnbundled ? ownerDial : text(decision.dial_normalized) || null,
    condition: text(source.source_condition_text) || null,
    workbook_price_usd: price.workbookPriceUsd,
    source_price_amount: price.sourceAmount,
    source_price_text: price.sourceText,
    source_currency: price.currency,
    price_evidence_status: price.status,
    verification_tier: ownerUnbundled ? 'OWNER_UNBUNDLED_ADMISSION_LEDGER' : 'OWNER_ADMISSION_LEDGER',
    confidence: 100,
    verification_status: 'APPROVED_SINGLE_CANDIDATE',
    user_image_url: image,
    catalog_image_url: null,
    final_image_url: image,
    display_image_url: image,
    image_evidence_type: image ? 'SELLER_LISTING_IMAGE' : null,
    review_reasons: [
      ...(ownerUnbundled && !image ? ['UNBUNDLED_CHILD_NO_IMAGE_APPROVED'] : []),
      ...(ownerUnbundled && !reference ? ['EXACT_REFERENCE_NOT_RECOVERED_FROM_CHILD_RAW'] : []),
      ...(ownerUnbundled && text(decision.dial_normalized) && !ownerDial
        ? ['UNBUNDLED_CHILD_DIAL_UNVERIFIED'] : []),
      ...(ownerUnbundled && text(decision.final_model) && !ownerModel.model
        ? ['UNBUNDLED_CHILD_MODEL_UNVERIFIED'] : []),
      ...(price.status === 'SOURCE_EXPLICIT_USD_MATCH' ? [] : [price.status]),
      ...(price.reextractedFromRaw ? ['RAW_USD_REEXTRACTED_OVERRIDES_WORKBOOK_VALUE'] : []),
    ],
    contact_publication_approved: false,
    contact_publication_basis: null,
    updated_at: new Date().toISOString(),
  };
}

function consistentValue(entries, selector) {
  const values = [...new Set(entries.map(selector).map(text).filter(Boolean))];
  return values.length === 1 ? values[0] : null;
}

function hasExplicitMultiParentEvidence(group) {
  const distinctChildren = new Set(group.map(entry => text(entry.source?.listing_id)).filter(Boolean));
  return distinctChildren.size > 1;
}

function hasLedgerMultiParentStatus(group) {
  return group.some(entry => [
    'BUNDLE_PARENT',
    'BUNDLE_PENDING',
    'MULTI',
    'MULTI_LISTING',
    'MULTI_PENDING',
  ].includes(text(entry.decision?.bundle_status).toUpperCase()));
}

function buildMultiParentRows({ entries, expectedBrand, fileName, fileSha256, runId }) {
  const groups = new Map();
  for (const entry of entries) {
    const sourceMessageId = text(entry.source?.source_message_id);
    if (!sourceMessageId) continue;
    const group = groups.get(sourceMessageId) || [];
    group.push(entry);
    groups.set(sourceMessageId, group);
  }

  const parents = [];
  const held = [];
  for (const [sourceMessageId, group] of groups) {
    const distinctChildren = new Set(group.map(entry => text(entry.source?.listing_id)).filter(Boolean));
    if (!hasExplicitMultiParentEvidence(group)) {
      if (hasLedgerMultiParentStatus(group)) {
        held.push({
          sourceMessageId,
          childCount: distinctChildren.size,
          reasons: ['MULTI_PARENT_DISTINCT_CHILD_PROOF_MISSING'],
        });
      }
      continue;
    }
    const ordered = [...group].sort((left, right) => (
      Number(left.itemSequence || left.rowNumber) - Number(right.itemSequence || right.rowNumber)
      || text(left.fileName || fileName).localeCompare(text(right.fileName || fileName))
      || text(left.source?.listing_id).localeCompare(text(right.source?.listing_id))
      || left.rowNumber - right.rowNumber
    ));
    const rawSegments = [];
    const seenRawSegments = new Set();
    for (const entry of ordered) {
      const raw = entry.source?.raw_message === null || entry.source?.raw_message === undefined
        ? ''
        : String(entry.source.raw_message);
      if (!raw.trim() || seenRawSegments.has(raw)) continue;
      seenRawSegments.add(raw);
      rawSegments.push(raw);
    }
    const sellerId = consistentValue(ordered, entry => entry.source?.seller_source_id);
    const sellerName = consistentValue(ordered, entry => entry.source?.seller_name_source);
    const postingDates = ordered.map(entry => isoDate(entry.source?.source_posted_at)).filter(Boolean);
    const reasons = [];
    if (!rawSegments.length) reasons.push('MULTI_PARENT_RAW_SEGMENT_MISSING');
    if (!sellerId || !sellerName) reasons.push('MULTI_PARENT_SELLER_CONFLICT_OR_MISSING');
    if (!postingDates.length) reasons.push('SOURCE_POSTING_TIME_INVALID');
    if (ordered.some(entry => text(entry.source?.category).toUpperCase() !== 'WATCH')) {
      reasons.push('MULTI_PARENT_NON_WATCH_MEMBER');
    }
    if (reasons.length) {
      held.push({ sourceMessageId, childCount: distinctChildren.size, reasons });
      continue;
    }

    const brands = [...new Set(ordered.map(entry => text(entry.expectedBrand || expectedBrand)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (!brands.length) reasons.push('MULTI_PARENT_BRAND_ROUTE_MISSING');
    if (reasons.length) {
      held.push({ sourceMessageId, childCount: distinctChildren.size, reasons });
      continue;
    }
    const routingBrand = brands[0];
    const displayBrand = brands.length > 1 ? 'Multiple brands' : routingBrand;
    const rawMessage = rawSegments.join('\n');
    const conflictingRawBrands = explicitBrandsInRaw(rawMessage)
      .filter(brand => !brands.includes(brand));
    if (conflictingRawBrands.length) {
      held.push({
        sourceMessageId,
        childCount: distinctChildren.size,
        reasons: ['MULTI_PARENT_RAW_BRAND_CONFLICT'],
      });
      continue;
    }
    const sourcePayload = ordered.map(entry => ({
      source: entry.source,
      decision: entry.decision,
      source_row_number: entry.rowNumber,
    }));
    const identityHash = sha256(sourceMessageId);
    const sourceFiles = [...new Set(ordered.map(entry => text(entry.fileName || fileName)).filter(Boolean))].sort();
    const sourceFileHashes = [...new Set(ordered.map(entry => text(entry.fileSha256 || fileSha256)).filter(Boolean))].sort();
    const contentHash = sha256(JSON.stringify({ sourceMessageId, brands, sourcePayload }));
    parents.push({
      id: `admission_multi_${identityHash}`,
      content_hash: contentHash,
      import_run_id: runId,
      source_file: sourceFiles.join(' | '),
      source_file_sha256: sourceFileHashes.length === 1
        ? sourceFileHashes[0]
        : sha256(sourceFileHashes.join('|')),
      source_worksheet: SOURCE_SHEET,
      source_row_number: ordered[0].rowNumber,
      source_record_id: sourceMessageId,
      source_payload_sha256: sha256(JSON.stringify(sourcePayload)),
      posting_date: postingDates.sort()[0],
      posted_by: sellerName,
      phone_number: null,
      raw_message: rawMessage,
      listing_type: MULTI_PARENT_LISTING_TYPE,
      brand_scope: routingBrand,
      supplied_brand: displayBrand,
      canonical_brand: displayBrand,
      model: 'Multiple listings',
      raw_reference: null,
      normalized_reference: null,
      catalog_reference: null,
      catalog_model: 'Multiple listings',
      dial_color: null,
      catalog_dial: null,
      condition: null,
      workbook_price_usd: null,
      source_price_amount: null,
      source_price_text: null,
      source_currency: null,
      price_evidence_status: 'MULTI_PARENT_PRICE_WITHHELD',
      verification_tier: MULTI_PARENT_VERIFICATION_TIER,
      confidence: 100,
      verification_status: MULTI_PARENT_VERIFICATION_STATUS,
      user_image_url: null,
      catalog_image_url: null,
      final_image_url: null,
      display_image_url: null,
      image_evidence_type: null,
      review_reasons: [
        'MULTI_PARENT_TRADING_FLOOR_ONLY',
        'PRICE_RESEARCH_EXCLUDED',
        'UNASSIGNED_MEDIA_WITHHELD',
        'CONTACT_WITHHELD',
        `SOURCE_SEGMENT_COUNT_${ordered.length}`,
        `SOURCE_BRAND_COUNT_${brands.length}`,
      ],
      contact_publication_approved: false,
      contact_publication_basis: null,
    });
  }
  parents.sort((left, right) => (
    left.source_row_number - right.source_row_number || left.id.localeCompare(right.id)
  ));
  return { parents, held };
}

function exactDuplicateKey(row) {
  return sha256([
    text(row.brand_scope).toLowerCase(),
    text(row.posted_by).toLowerCase(),
    text(row.raw_message).toLowerCase().replace(/\s+/g, ' '),
    text(row.model).toLowerCase(),
    text(row.normalized_reference).toUpperCase(),
    text(row.dial_color).toLowerCase(),
    text(row.listing_type).toUpperCase(),
  ].join('|'));
}

function canonicalizeExactDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = exactDuplicateKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const canonical = [];
  const excluded = [];
  for (const [duplicateKey, group] of groups) {
    group.sort((left, right) => (
      Date.parse(left.posting_date || '') - Date.parse(right.posting_date || '')
      || Number(left.source_row_number) - Number(right.source_row_number)
      || String(left.id).localeCompare(String(right.id))
    ));
    canonical.push(group[0]);
    for (const duplicate of group.slice(1)) {
      excluded.push({
        disposition: 'DUPLICATE/REPOST',
        evidence_basis: 'EXACT_NORMALIZED_SOURCE_SIGNATURE',
        duplicate_key_sha256: duplicateKey,
        canonical_id: group[0].id,
        excluded_id: duplicate.id,
        source_file_sha256: duplicate.source_file_sha256,
        source_row_number: duplicate.source_row_number,
        source_payload_sha256: duplicate.source_payload_sha256,
      });
    }
  }
  canonical.sort((left, right) => left.source_row_number - right.source_row_number);
  return { canonical, excluded };
}

function ledgerDuplicateEvidence({ source, decision, fileSha256, rowNumber }) {
  return {
    disposition: 'DUPLICATE/REPOST',
    evidence_basis: `ADMISSION_LEDGER_${text(decision.duplicate_decision).toUpperCase() || 'EXCLUDED'}`,
    canonical_id: null,
    source_file_sha256: fileSha256,
    source_row_number: rowNumber,
    source_record_id_sha256: sha256(text(source.listing_id)),
    source_message_id_sha256: sha256(text(source.source_message_id)),
    source_payload_sha256: sha256(JSON.stringify({ source, decision })),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    values[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.input || !values.brand) throw new Error('--input and --brand are required');
  const maxRows = Number.parseInt(values['max-rows'] || '0', 10);
  const batchSize = Number.parseInt(values['batch-size'] || '100', 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('--batch-size must be 1 through 500');
  }
  return {
    input: path.resolve(values.input),
    brand: text(values.brand),
    outputDir: path.resolve(values['output-dir'] || path.join(
      'audit-output', `approved-admission-canary-${Date.now()}`,
    )),
    maxRows: Number.isInteger(maxRows) && maxRows > 0 ? maxRows : null,
    batchSize,
    runId: text(values['run-id']) || `approved_admission_${Date.now()}`,
    ownerUnbundled: values['unbundled-no-image'] === 'true',
    includeMultiParents: values['include-multi-parents'] === 'true',
    replaceExisting: values['replace-existing-exact'] === 'true',
    apply: process.env.APPLY_APPROVED_ADMISSION_IMPORT === 'true',
  };
}

async function upsertBatch(client, rows, options = {}) {
  const { data, error } = await client
    .from(INVENTORY_TABLE)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: options.replaceExisting !== true })
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

const IMPORT_READBACK_COLUMNS = [
  'id', 'content_hash', 'source_payload_sha256', 'source_record_id',
  'source_platform', 'source_group_id', 'source_message_id', 'parent_source_message_id',
  'listing_type', 'brand_scope', 'model', 'normalized_reference', 'dial_color',
  'workbook_price_usd', 'source_price_amount', 'source_price_text',
  'source_currency', 'price_evidence_status', 'verification_status', 'verification_tier',
  'user_image_url', 'catalog_image_url', 'final_image_url', 'display_image_url',
  'image_evidence_type', 'phone_number', 'contact_publication_approved',
].join(',');

function comparableImportValue(field, value) {
  if (value === undefined || value === '') return null;
  if (['workbook_price_usd', 'source_price_amount'].includes(field)) {
    return value === null ? null : Number(value);
  }
  return value;
}

function compareImportedRows(expectedRows, actualRows, options = {}) {
  const lineageReady = options.lineageReady !== false;
  const actualById = new Map((actualRows || []).map(row => [text(row.id), row]));
  const compareFields = [
    'content_hash', 'source_payload_sha256', 'source_record_id',
    ...(lineageReady ? ['source_platform', 'source_group_id', 'source_message_id', 'parent_source_message_id'] : []),
    'listing_type', 'brand_scope', 'model', 'normalized_reference', 'dial_color',
    'workbook_price_usd', 'source_price_amount', 'source_price_text',
    'source_currency', 'price_evidence_status', 'verification_status', 'verification_tier',
  ];
  const missingIds = [];
  const drift = [];
  let exact = 0;
  for (const expected of expectedRows) {
    const actual = actualById.get(text(expected.id));
    if (!actual) {
      missingIds.push(expected.id);
      continue;
    }
    const fields = [];
    for (const field of compareFields) {
      const expectedValue = comparableImportValue(field, expected[field]);
      const actualValue = comparableImportValue(field, actual[field]);
      if (expectedValue !== actualValue) fields.push(field);
    }
    const mediaOrContactLeak = [
      'user_image_url', 'catalog_image_url', 'final_image_url',
      'display_image_url', 'image_evidence_type', 'phone_number',
    ].filter(field => actual[field] !== null && actual[field] !== undefined && actual[field] !== '');
    if (actual.contact_publication_approved !== false) mediaOrContactLeak.push('contact_publication_approved');
    const expectedPriceReady = expected.listing_type === 'WTS'
      && expected.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH';
    const actualPriceReady = actual.listing_type === 'WTS'
      && actual.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH'
      && Number(actual.workbook_price_usd) > 0
      && Boolean(text(actual.normalized_reference));
    if (expectedPriceReady !== actualPriceReady) fields.push('price_research_status');
    if (expected.listing_type === 'WTB' && actual.workbook_price_usd !== null) {
      fields.push('wtb_price_must_be_null');
    }
    if (mediaOrContactLeak.length) fields.push(...mediaOrContactLeak);
    const uniqueFields = [...new Set(fields)];
    if (uniqueFields.length) drift.push({ id: expected.id, fields: uniqueFields });
    else exact += 1;
  }
  return {
    expected: expectedRows.length,
    found: expectedRows.length - missingIds.length,
    exact,
    missing_ids: missingIds,
    drift,
    lineage_schema_ready: lineageReady,
    lineage_verified: lineageReady,
    ok: lineageReady && missingIds.length === 0 && drift.length === 0,
  };
}

async function verifyImportedRows(client, expectedRows, options = {}) {
  const lineageReady = options.lineageReady !== false;
  const readbackColumns = lineageReady
    ? IMPORT_READBACK_COLUMNS
    : IMPORT_READBACK_COLUMNS.split(',').filter(field => ![
      'source_platform', 'source_group_id', 'source_message_id', 'parent_source_message_id',
    ].includes(field)).join(',');
  const actualRows = [];
  for (let start = 0; start < expectedRows.length; start += 100) {
    const ids = expectedRows.slice(start, start + 100).map(row => row.id);
    const { data, error } = await client.from(INVENTORY_TABLE)
      .select(readbackColumns)
      .in('id', ids);
    if (error) throw error;
    actualRows.push(...(data || []));
  }
  return compareImportedRows(expectedRows, actualRows, { lineageReady });
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.replaceExisting && (
    !options.ownerUnbundled
    || options.includeMultiParents
    || process.env.REPLACE_APPROVED_ADMISSION_EXISTING !== 'true'
  )) {
    throw new Error('exact replacement is restricted to explicitly authorized owner-unbundled rows');
  }
  if (options.ownerUnbundled && !OWNER_UNBUNDLED_BRANDS.has(options.brand)) {
    throw new Error(`--unbundled-no-image is not allowlisted for ${options.brand}`);
  }
  const workbook = readAdmissionWorkbook(options.input);
  const fileName = path.basename(options.input);
  const candidates = [];
  const excludedDuplicateEvidence = [];
  const heldReasons = {};
  const analyticsHeldReasons = {};
  let missingDecisions = 0;
  const sourceEntries = [];
  workbook.sourceRows.forEach((source, index) => {
    const decision = workbook.decisions.get(text(source.listing_id));
    if (!decision) {
      missingDecisions += 1;
      return;
    }
    const itemSequenceMatch = text(source.listing_id).match(/_item_(\d+)$/i);
    sourceEntries.push({
      source,
      decision,
      rowNumber: index + 2,
      itemSequence: itemSequenceMatch ? Number(itemSequenceMatch[1]) : index + 2,
      expectedBrand: options.brand,
      fileName,
      fileSha256: workbook.fileSha256,
    });
    const admission = options.ownerUnbundled
      ? classifyOwnerUnbundledRow(source, decision, options.brand)
      : classifyRow(source, decision, options.brand);
    const priceOnlyReasons = admission.reasons.filter(
      reason => PRICE_RESEARCH_ONLY_REASONS.has(reason),
    );
    for (const reason of priceOnlyReasons) {
      analyticsHeldReasons[reason] = (analyticsHeldReasons[reason] || 0) + 1;
    }
    const importReasons = [
      ...admission.reasons.filter(reason => !PRICE_RESEARCH_ONLY_REASONS.has(reason)),
      ...additionalImportReasons(source, {
        allowNoImage: options.ownerUnbundled,
        ownerUnbundled: options.ownerUnbundled,
      }),
      ...admissionIdentityGateReasons(source, decision, options.brand),
    ];
    if (!admission.trading_floor_candidate || importReasons.length) {
      for (const reason of importReasons) heldReasons[reason] = (heldReasons[reason] || 0) + 1;
      if (importReasons.includes('REPOST_OR_DUPLICATE_EXCLUDED')) {
        excludedDuplicateEvidence.push(ledgerDuplicateEvidence({
          source,
          decision,
          fileSha256: workbook.fileSha256,
          rowNumber: index + 2,
        }));
      }
      return;
    }
    candidates.push(rowForImport({
      source,
      decision,
      expectedBrand: options.brand,
      fileName,
      fileSha256: workbook.fileSha256,
      rowNumber: index + 2,
      runId: options.runId,
      ownerUnbundled: options.ownerUnbundled,
    }));
  });
  const duplicateResolution = canonicalizeExactDuplicates(candidates);
  const uniqueCandidates = duplicateResolution.canonical;
  excludedDuplicateEvidence.push(...duplicateResolution.excluded);
  const multiParentResolution = options.includeMultiParents
    ? buildMultiParentRows({
      entries: sourceEntries,
      expectedBrand: options.brand,
      fileName,
      fileSha256: workbook.fileSha256,
      runId: options.runId,
    })
    : { parents: [], held: [] };
  const allCandidates = [...uniqueCandidates, ...multiParentResolution.parents];
  const limit = options.maxRows || allCandidates.length;
  const selected = allCandidates.slice(0, limit);
  let resumeAt = 0;
  let inserted = 0;
  let duplicates = 0;
  let client = null;
  const readback = { expected: 0, found: 0, exact: 0 };
  if (options.apply) {
    if (process.env.REVIEWED_WORKBOOK_INVENTORY_TABLE !== INVENTORY_TABLE) {
      throw new Error(`REVIEWED_WORKBOOK_INVENTORY_TABLE must equal ${INVENTORY_TABLE}`);
    }
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)) {
      throw new Error('Supabase server credentials are required for apply mode');
    }
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false } },
    );
    const { data: checkpoint, error } = await client.from(CHECKPOINT_TABLE)
      .select('rows_scanned,rows_inserted,rows_duplicate_held,rows_errors')
      .eq('source_file_sha256', workbook.fileSha256)
      .maybeSingle();
    if (error) throw error;
    resumeAt = options.replaceExisting
      ? 0
      : Math.min(Number(checkpoint?.rows_scanned || 0), selected.length);
    inserted = options.replaceExisting ? 0 : Number(checkpoint?.rows_inserted || 0);
    duplicates = options.replaceExisting ? 0 : Number(checkpoint?.rows_duplicate_held || 0);
  }
  for (let start = resumeAt; start < selected.length; start += options.batchSize) {
    const batch = selected.slice(start, start + options.batchSize);
    if (options.apply) {
      const batchInserted = await upsertBatch(client, batch, {
        replaceExisting: options.replaceExisting,
      });
      const batchReadback = await verifyImportedRows(client, batch);
      if (!batchReadback.ok) {
        throw new Error(`approved admission readback failed: ${JSON.stringify(batchReadback)}`);
      }
      readback.expected += batchReadback.expected;
      readback.found += batchReadback.found;
      readback.exact += batchReadback.exact;
      inserted += batchInserted;
      duplicates += batch.length - batchInserted;
      const scanned = start + batch.length;
      const { error } = await client.from(CHECKPOINT_TABLE).upsert({
        source_file_sha256: workbook.fileSha256,
        import_run_id: options.runId,
        source_file: fileName,
        brand_scope: options.brand,
        expected_rows: allCandidates.length,
        rows_scanned: scanned,
        rows_inserted: inserted,
        rows_duplicate_held: duplicates,
        rows_errors: 0,
        status: scanned === allCandidates.length ? 'COMPLETE' : 'RUNNING',
        started_at: new Date().toISOString(),
        completed_at: scanned === allCandidates.length ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_file_sha256' });
      if (error) throw error;
    }
  }
  const priceReady = uniqueCandidates.filter(
    row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' && row.listing_type === 'WTS',
  ).length;
  const selectedPriceReady = selected.filter(
    row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH' && row.listing_type === 'WTS',
  ).length;
  const report = {
    mode: options.apply ? 'SERVICE_ONLY_APPLY' : 'LOCAL_DRY_RUN',
    source_file: fileName,
    source_sha256: workbook.fileSha256,
    expected_brand: options.brand,
    source_rows: workbook.sourceRows.length,
    strict_trading_floor_candidates: allCandidates.length,
    approved_single_candidates: uniqueCandidates.length,
    approved_multi_parent_candidates: multiParentResolution.parents.length,
    multi_parent_groups_held: multiParentResolution.held.length,
    selected_rows: selected.length,
    strict_price_research_candidates_supported_by_current_schema: priceReady,
    selected_price_research_candidates_supported_by_current_schema: selectedPriceReady,
    held_rows: workbook.sourceRows.length - uniqueCandidates.length,
    held_reasons: heldReasons,
    price_research_held_reasons: analyticsHeldReasons,
    missing_decisions: missingDecisions,
    contact_publication_approved_rows: selected.filter(row => row.contact_publication_approved).length,
    bundle_rows_selected: selected.filter(row => /BUNDLE|MULTI/i.test(row.listing_type)).length,
    duplicate_or_repost_evidence_rows: excludedDuplicateEvidence.length,
    exact_duplicate_candidates_excluded: duplicateResolution.excluded.length,
    unbundled_no_image_policy: options.ownerUnbundled,
    multi_parent_trading_floor_only_policy: options.includeMultiParents,
    rows_with_images: selected.filter(row => row.final_image_url).length,
    rows_with_exact_raw_usd: selected.filter(row => row.price_evidence_status === 'SOURCE_EXPLICIT_USD_MATCH').length,
    rows_without_exact_reference: selected.filter(row => !row.normalized_reference).length,
    target_table: options.apply ? INVENTORY_TABLE : null,
    forbidden_targets: ['watch_records', 'staging.listings', 'public release views'],
    database_writes: options.apply ? inserted : 0,
    exact_id_readback: options.apply ? readback : null,
    blockers: [
      'reviewed_workbook_market_source_v2 currently projects staging.listings, not reviewed_workbook_inventory',
      'reviewed_workbook_inventory has no named FX source/date columns; non-USD rows fail closed for analytics',
    ],
  };
  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(path.join(options.outputDir, 'canary-manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(options.outputDir, 'excluded-duplicate-evidence.json'),
    `${JSON.stringify(excludedDuplicateEvidence, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHECKPOINT_TABLE,
  INVENTORY_TABLE,
  OWNER_UNBUNDLED_BRANDS,
  MULTI_PARENT_LISTING_TYPE,
  MULTI_PARENT_VERIFICATION_STATUS,
  MULTI_PARENT_VERIFICATION_TIER,
  PRICE_RESEARCH_ONLY_REASONS,
  firstExactImage,
  additionalImportReasons,
  admissionIdentityConflictReasons,
  admissionIdentityGateReasons,
  canonicalizeExactDuplicates,
  buildMultiParentRows,
  explicitBrandsInRaw,
  strictExplicitBrandsInRaw,
  hasExplicitMultiParentEvidence,
  exactDuplicateKey,
  ledgerDuplicateEvidence,
  classifyOwnerUnbundledRow,
  listingType,
  readAdmissionWorkbook,
  rowForImport,
  run,
  sourcePriceEvidence,
  strictReferenceFromRaw,
  compareImportedRows,
  upsertBatch,
  verifyImportedRows,
  verifiedOwnerUnbundledDial,
  ownerUnbundledIdentitySupported,
  verifiedOwnerUnbundledModel,
};
