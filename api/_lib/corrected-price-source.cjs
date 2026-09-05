'use strict';

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Resolve the effective public price from a reviewed source row.
 *
 * The database sidecar is exposed through the existing reviewed views. This
 * adapter deliberately has no independent table/query path: that keeps the
 * inventory census, publication gates, pagination, and immutable lineage in
 * one place. A correction is usable only when the view explicitly marks it
 * qualified and supplies complete audit provenance.
 */
function resolveEffectivePrice(row) {
  const basePrice = row?.has_verified_usd_price === true
    ? positiveNumber(row?.verified_price_usd)
    : null;
  const correctedPrice = positiveNumber(row?.corrected_price_usd);
  const correctionStatus = clean(row?.price_correction_status)?.toUpperCase();
  const correctionId = clean(row?.price_correction_id);
  const correctionKey = clean(row?.price_correction_key);
  const sourceCurrency = clean(row?.corrected_source_currency)?.toUpperCase();
  const sourceAmount = positiveNumber(row?.corrected_source_amount);
  const fxSource = clean(row?.corrected_fx_source);
  const fxDate = clean(row?.corrected_fx_date);
  const fxRate = positiveNumber(row?.corrected_fx_rate);
  const directUsd = ['USD', 'USDT'].includes(sourceCurrency);
  const completeFx = directUsd || Boolean(fxSource && fxDate && fxRate);
  const correctionQualified = correctionStatus === 'QUALIFIED'
    && Boolean(correctionId && correctionKey)
    && correctedPrice !== null
    && sourceAmount !== null
    && Boolean(sourceCurrency)
    && completeFx;

  if (correctionQualified) {
    return {
      price_usd: correctedPrice,
      has_verified_usd_price: true,
      source: 'SIDECAR_CORRECTION',
      correction_applied: true,
      correction_id: correctionId,
      correction_key: correctionKey,
      source_amount: sourceAmount,
      source_currency: sourceCurrency,
      fx_rate: directUsd ? 1 : fxRate,
      fx_source: directUsd ? (fxSource || 'DIRECT_USD_SOURCE') : fxSource,
      fx_date: fxDate,
    };
  }

  return {
    price_usd: basePrice,
    has_verified_usd_price: basePrice !== null,
    source: basePrice !== null ? 'BASE_VERIFIED_PRICE' : 'NO_VERIFIED_PRICE',
    correction_applied: false,
    correction_id: null,
    correction_key: null,
    source_amount: positiveNumber(row?.source_price_amount),
    source_currency: clean(row?.source_currency)?.toUpperCase() || null,
    fx_rate: null,
    fx_source: null,
    fx_date: null,
  };
}

function applyEffectivePrice(row) {
  const effective = resolveEffectivePrice(row);
  return {
    ...row,
    verified_price_usd: effective.price_usd,
    has_verified_usd_price: effective.has_verified_usd_price,
    effective_price_source: effective.source,
    price_correction_applied: effective.correction_applied,
    price_correction_id: effective.correction_id,
    price_correction_key: effective.correction_key,
    effective_source_amount: effective.source_amount,
    effective_source_currency: effective.source_currency,
    effective_fx_rate: effective.fx_rate,
    effective_fx_source: effective.fx_source,
    effective_fx_date: effective.fx_date,
  };
}

module.exports = { applyEffectivePrice, positiveNumber, resolveEffectivePrice };
