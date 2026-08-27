'use strict';

const crypto = require('node:crypto');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const { normalizeCanonicalModel } = require('../../api/_lib/catalog-taxonomy.js');

const BRANDS = new Set(['Rolex', 'Patek Philippe']);
const DIRECT_USD_CURRENCIES = new Set(['USD', 'USDT']);
const ECB_CURRENCIES = new Set([
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'DKK', 'EUR', 'GBP', 'HKD', 'IDR', 'INR',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'SEK', 'SGD', 'THB', 'USD', 'ZAR',
]);

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function referenceKey(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function claimKey(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function stripBrandPrefix(model, brand) {
  const value = clean(model);
  const prefix = clean(brand);
  if (!value || !prefix) return value;
  return value.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
    ? clean(value.slice(prefix.length + 1)) : value;
}

function frozenModelClaim(row) {
  const search = clean(row?.search_text);
  const prefix = [clean(row?.brand), clean(row?.observed_reference)].filter(Boolean).join(' ');
  if (!search || !prefix || (search !== prefix && !search.startsWith(`${prefix} `))) return null;
  let claim = search.slice(prefix.length).trim();
  const dial = clean(row?.dial_or_color ?? row?.dial_or_color_as_observed);
  if (dial && claim === dial) claim = '';
  else if (dial && claim.endsWith(` ${dial}`)) claim = claim.slice(0, -(dial.length + 1)).trim();
  return clean(claim);
}

function buildCatalogIndex() {
  const catalogByBrand = new Map();
  const allowedModels = new Map();
  for (const brand of BRANDS) {
    const byReference = new Map();
    const allowed = new Map();
    for (const entry of listCanonicalCatalogReferences(brand)) {
      const model = clean(entry.model);
      if (!model || model === 'Reference-only listings') continue;
      byReference.set(referenceKey(entry.reference), model);
      allowed.set(claimKey(model), model);
      const normalized = normalizeCanonicalModel(model, brand);
      allowed.set(claimKey(normalized), normalized);
    }
    catalogByBrand.set(brand, byReference);
    allowedModels.set(brand, allowed);
  }
  return { catalogByBrand, allowedModels };
}

const CATALOG_INDEX = buildCatalogIndex();

function resolveModelEvidence(row) {
  const brand = clean(row?.brand);
  if (!BRANDS.has(brand)) return { decision: 'REVIEW_REQUIRED', reason: 'BRAND_OUT_OF_SCOPE' };
  const rawClaim = frozenModelClaim(row);
  if (rawClaim) {
    const stripped = stripBrandPrefix(rawClaim, brand);
    const normalized = normalizeCanonicalModel(stripped, brand);
    const allowed = CATALOG_INDEX.allowedModels.get(brand);
    const model = allowed?.get(claimKey(normalized)) || allowed?.get(claimKey(stripped)) || null;
    if (model) {
      return {
        decision: 'VERIFIED', model, model_evidence_type: 'FROZEN_SOURCE_MODEL_AS_POSTED',
        source_model_claim: rawClaim,
      };
    }
  }
  const model = CATALOG_INDEX.catalogByBrand.get(brand)?.get(referenceKey(row?.observed_reference)) || null;
  if (model) {
    return {
      decision: 'VERIFIED', model, model_evidence_type: 'CATALOG_EXACT_BRAND_REFERENCE',
      source_model_claim: rawClaim,
    };
  }
  return {
    decision: 'REVIEW_REQUIRED', model: null, model_evidence_type: null,
    source_model_claim: rawClaim, reason: rawClaim ? 'SOURCE_MODEL_NOT_IN_SAME_BRAND_TAXONOMY' : 'MODEL_UNRESOLVED',
  };
}

function canonicalCurrent(row) {
  return BRANDS.has(clean(row?.brand))
    && ['CURRENT_ACTIVE', 'CURRENT_LATEST_STATE', 'CONFIRMED_CURRENT', 'LATEST_OBSERVED']
      .includes(clean(row?.current_status))
    && row?.disposition?.duplicate !== true;
}

function buildModelEvidence(row, evidenceVersion = 'card-model-evidence-v1') {
  if (!canonicalCurrent(row)) return null;
  const resolution = resolveModelEvidence(row);
  if (resolution.decision !== 'VERIFIED') return null;
  const evidence = {
    run_id: clean(row.run_id), current_listing_key: clean(row.current_listing_key),
    latest_raw_occurrence_key: clean(row.latest_raw_occurrence_key ?? row.raw_occurrence_key),
    exact_child_text_sha256: clean(row.exact_child_text_sha256), brand: clean(row.brand),
    observed_reference_key: clean(row.observed_reference_key), model: resolution.model,
    model_evidence_type: resolution.model_evidence_type, evidence_version: evidenceVersion,
    source_artifact_id: clean(row.source_artifact_id), source_artifact_sha256: clean(row.source_artifact_sha256),
  };
  evidence.evidence_checksum = sha256(JSON.stringify(evidence));
  return evidence;
}

function isValidFxEvidence(fx, currency, applicableDate) {
  if (!fx || !ECB_CURRENCIES.has(currency)) return false;
  const rate = Number(fx.usd_per_source_unit);
  const lookback = Number(fx.lookback_days);
  return fx.provider === 'ECB'
    && fx.rate_direction === 'USD_PER_SOURCE_UNIT'
    && clean(fx.applicable_date) === applicableDate
    && /^https:\/\/data-api\.ecb\.europa\.eu\//.test(String(fx.source_url || ''))
    && Number.isFinite(rate) && rate > 0
    && Number.isInteger(lookback) && lookback >= 0 && lookback <= 7
    && Boolean(clean(fx.effective_date));
}

function buildPriceEvidence(row, fx = null, evidenceVersion = 'card-price-evidence-v1') {
  if (!canonicalCurrent(row)) return null;
  const amount = Number(row?.source_price_amount);
  const currency = clean(row?.source_currency)?.toUpperCase() || null;
  const sourceClassification = clean(row?.price_evidence_classification)?.toUpperCase() || null;
  const applicableDate = clean(row?.source_timestamp)?.slice(0, 10) || null;
  if (!['AUTO_APPROVED', 'SOURCE_EXPLICIT_USD_MATCH', 'SOURCE_EXPLICIT_USD_USDT', 'DATED_VERIFIED_FX']
    .includes(sourceClassification)
    || !Number.isFinite(amount) || amount <= 0 || !currency || !applicableDate) return null;

  let classification = null;
  let normalizedUsd = null;
  if (DIRECT_USD_CURRENCIES.has(currency)) {
    classification = currency === 'USDT' ? 'SOURCE_EXPLICIT_USD_USDT' : 'SOURCE_EXPLICIT_USD_MATCH';
    normalizedUsd = amount;
  } else if (isValidFxEvidence(fx, currency, applicableDate)) {
    classification = 'DATED_VERIFIED_FX';
    normalizedUsd = Math.round(amount * Number(fx.usd_per_source_unit) * 100) / 100;
  } else {
    return null;
  }

  const evidence = {
    run_id: clean(row.run_id), current_listing_key: clean(row.current_listing_key),
    offer_state_key: clean(row.offer_state_key),
    latest_raw_occurrence_key: clean(row.latest_raw_occurrence_key ?? row.raw_occurrence_key),
    exact_child_text_sha256: clean(row.exact_child_text_sha256), evidence_version: evidenceVersion,
    source_price_amount: amount, source_currency: currency,
    normalized_usd_amount: normalizedUsd, price_evidence_classification: classification,
    display_price_verified: true,
    price_research_eligible: row.intent === 'WTS' && Boolean(clean(row.observed_reference_key)),
    fx_provider: classification === 'DATED_VERIFIED_FX' ? fx.provider : null,
    fx_source_url: classification === 'DATED_VERIFIED_FX' ? fx.source_url : null,
    fx_applicable_date: classification === 'DATED_VERIFIED_FX' ? fx.applicable_date : null,
    fx_effective_date: classification === 'DATED_VERIFIED_FX' ? fx.effective_date : null,
    fx_lookback_days: classification === 'DATED_VERIFIED_FX' ? fx.lookback_days : null,
    fx_rate_direction: classification === 'DATED_VERIFIED_FX' ? fx.rate_direction : null,
    fx_rate: classification === 'DATED_VERIFIED_FX' ? Number(fx.usd_per_source_unit) : null,
  };
  evidence.evidence_checksum = sha256(JSON.stringify(evidence));
  return evidence;
}

module.exports = {
  BRANDS, DIRECT_USD_CURRENCIES, ECB_CURRENCIES, buildModelEvidence, buildPriceEvidence,
  canonicalCurrent, frozenModelClaim, isValidFxEvidence, referenceKey, resolveModelEvidence,
  sha256, stripBrandPrefix,
};
