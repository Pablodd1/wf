'use strict';

const { sha256, stableJson } = require('./lib.cjs');
const { normalizeSourceRecord } = require('./normalize-local.cjs');
const { normalizedPrice } = require('./publication-review.cjs');
const { extractPriceObservations } = require('../../api/_lib/normalization-v4.cjs');
const { applyCurrencyPolicy } = require('../shadow-reprocess/shadow-reprocess.cjs');
const {
  RECOGNIZED_WITHHELD_CURRENCIES,
  SUPPORTED_CURRENCIES,
} = require('../../api/_lib/fx-rates.cjs');

const TARGET_BRANDS = new Set(['Rolex', 'Patek Philippe', 'Audemars Piguet']);
const PRICE_CURRENCIES = new Set([...SUPPORTED_CURRENCIES, 'USDT']);

function exactIdentity(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validateFxSnapshot(snapshot) {
  if (snapshot?.contract !== 'wf-dated-fx-snapshot-v1'
    || snapshot?.base !== 'USD'
    || !snapshot?.observed_at
    || !Number.isFinite(Date.parse(snapshot.observed_at))
    || !snapshot?.source
    || !snapshot?.source_url
    || !snapshot?.usd_per_unit) {
    throw new Error('A dated, named wf-dated-fx-snapshot-v1 snapshot is required');
  }
  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = Number(snapshot.usd_per_unit[currency]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`FX snapshot is missing ${currency}`);
  }
  if (JSON.stringify(snapshot.recognized_but_withheld) !== JSON.stringify(RECOGNIZED_WITHHELD_CURRENCIES)) {
    throw new Error('FX snapshot withheld-currency contract does not match');
  }
  if (Number(snapshot.usd_per_unit.USD) !== 1) throw new Error('FX snapshot USD rate must equal one');
  return snapshot;
}

function mentionedTargetBrands(rawMessage) {
  const raw = String(rawMessage || '');
  const brands = new Set();
  if (/\brolex\b/i.test(raw)) brands.add('Rolex');
  if (/\b(?:patek(?:\s+philippe)?|pp)\b/i.test(raw)) brands.add('Patek Philippe');
  if (/\b(?:audemars(?:\s+piguet)?|ap)\b/i.test(raw)) brands.add('Audemars Piguet');
  return brands;
}

function hasConflictingTargetBrand(rawMessage, canonicalBrand) {
  return [...mentionedTargetBrands(rawMessage)].some(brand => brand !== canonicalBrand);
}

function recoveredLineagedPrice(source, fxSnapshot) {
  const observations = extractPriceObservations(source?.raw_message || '', {});
  if (!observations.length) return null;
  const converted = observations
    .map(observation => applyCurrencyPolicy(observation, fxSnapshot))
    .filter(price => price?.amount_original > 0 && price?.amount_usd > 0
      && PRICE_CURRENCIES.has(price?.currency_original)
      && price?.conversion_rate > 0 && price?.conversion_source);
  if (!converted.length) return null;
  const suppliedUsd = converted.find(price => ['USD', 'USDT'].includes(price.currency_original));
  if (suppliedUsd) return normalizedPrice({ prices: [suppliedUsd] });
  if (converted.length === 1) return normalizedPrice({ prices: converted });
  const usdValues = converted.map(price => Number(price.amount_usd)).filter(Number.isFinite);
  const low = Math.min(...usdValues);
  const high = Math.max(...usdValues);
  return low > 0 && high / low <= 1.05 ? normalizedPrice({ prices: [converted[0]] }) : null;
}

function correctionRecord(row, fxSnapshot) {
  validateFxSnapshot(fxSnapshot);
  const source = row?.raw_payload;
  if (!source || typeof source !== 'object') return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(row.listing_id || ''))) return null;
  if (source.source_record_id !== row.source_record_id || source.raw_sha256 !== row.source_hash) return null;
  if (!TARGET_BRANDS.has(row.canonical_brand)) return null;
  if (hasConflictingTargetBrand(source.raw_message, row.canonical_brand)) return null;
  const proposal = normalizeSourceRecord(source, { fxSnapshot });
  const candidates = proposal.normalization?.proposed_candidates || [];
  const candidate = proposal.bundle_status === 'SINGLE_CANDIDATE' && candidates.length === 1
    && candidates[0].brand === row.canonical_brand
    && exactIdentity(candidates[0].reference) === exactIdentity(row.normalized_reference)
    ? candidates[0]
    : null;
  const price = normalizedPrice(candidate) || (proposal.bundle_status !== 'BUNDLE_SPLIT_REQUIRED'
    ? recoveredLineagedPrice(source, fxSnapshot)
    : null);
  if (!price?.amount_original || !price?.amount_usd || !PRICE_CURRENCIES.has(price?.currency_original)
    || !price?.conversion_rate || !price?.conversion_source) return null;
  if (!['USD', 'USDT'].includes(price.currency_original)
    && (price.conversion_timestamp !== fxSnapshot.observed_at
      || price.conversion_source !== fxSnapshot.source
      || Math.abs(Number(price.conversion_rate) - Number(fxSnapshot.usd_per_unit[price.currency_original])) > 1e-12)) return null;
  return {
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    source_hash: row.source_hash,
    candidate: { brand: row.canonical_brand, reference: row.normalized_reference, price },
  };
}

function buildCorrectionPage(rows, fxSnapshot, options = {}) {
  validateFxSnapshot(fxSnapshot);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
    throw new Error('Correction page must contain between 1 and 500 scanned rows');
  }
  const normalizationRunKey = String(options.normalizationRunKey || '');
  const correctionRunKey = String(options.correctionRunKey || '');
  if (![normalizationRunKey, correctionRunKey].every(key => /^[A-Za-z0-9._:-]{1,100}$/.test(key))) {
    throw new Error('run keys are invalid');
  }
  const seenListings = new Set();
  const seenSources = new Set();
  const records = [];
  const skipped = {};
  for (const row of rows) {
    const listingId = String(row?.listing_id || '');
    const sourceId = String(row?.source_record_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(listingId) || seenListings.has(listingId) || seenSources.has(sourceId)) {
      throw new Error('Correction page contains duplicate or invalid exact lineage');
    }
    seenListings.add(listingId);
    seenSources.add(sourceId);
    const record = correctionRecord(row, fxSnapshot);
    if (record) records.push(record);
    else skipped.NOT_EXACTLY_REPARSABLE = (skipped.NOT_EXACTLY_REPARSABLE || 0) + 1;
  }
  const previousCursor = options.previousCursor || null;
  const nextCursor = rows.at(-1).listing_id;
  const batchToken = records.length ? sha256(stableJson({
    contract: 'wf-three-brand-global-price-correction-v1',
    correction_run_key: correctionRunKey,
    normalization_run_key: normalizationRunKey,
    fx_contract: fxSnapshot.contract,
    fx_observed_at: fxSnapshot.observed_at,
    previous_cursor: previousCursor,
    next_cursor: nextCursor,
    records,
  })) : null;
  return {
    contract: 'wf-three-brand-global-price-correction-v1',
    correction_run_key: correctionRunKey,
    normalization_run_key: normalizationRunKey,
    previous_cursor: previousCursor,
    next_cursor: nextCursor,
    scanned_rows: rows.length,
    corrected_rows: records.length,
    skipped_rows: rows.length - records.length,
    skipped_by_reason: skipped,
    batch_token: batchToken,
    records,
  };
}

module.exports = {
  PRICE_CURRENCIES, TARGET_BRANDS, buildCorrectionPage, correctionRecord,
  exactIdentity, hasConflictingTargetBrand, mentionedTargetBrands,
  recoveredLineagedPrice, validateFxSnapshot,
};
