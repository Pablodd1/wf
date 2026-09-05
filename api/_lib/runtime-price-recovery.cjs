'use strict';

const { extractPriceObservations } = require('./normalization-v4.cjs');
const { parseEcbRates, SUPPORTED_CURRENCIES } = require('./fx-rates.cjs');

const CACHE_MS = 6 * 60 * 60 * 1000;
const ECB_SOURCE = 'European Central Bank reference rates';
const ECB_SOURCE_URL = 'https://data.ecb.europa.eu/data/datasets/EXR';
let cachedSnapshot = null;

function explicitObservation(rawMessage) {
  const observations = extractPriceObservations(String(rawMessage || ''))
    .filter(item => item?.currency_evidence === 'explicit_line_currency')
    .filter(item => Number(item?.amount_original) > 0 && item?.currency_original);
  if (!observations.length) return null;
  return observations.find(item => ['USD', 'USDT'].includes(String(item.currency_original).toUpperCase()))
    || observations.find(item => item.is_primary)
    || observations[0];
}

async function loadLatestFxSnapshot(options = {}) {
  const now = options.now || new Date();
  if (cachedSnapshot && now.getTime() - cachedSnapshot.fetched_at_ms < CACHE_MS) return cachedSnapshot;
  const fetchImpl = options.fetchImpl || fetch;
  const start = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const currencies = SUPPORTED_CURRENCIES.filter(code => code !== 'EUR').join('+');
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies}.EUR.SP00.A?startPeriod=${start}&format=csvdata`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`ECB returned ${response.status}`);
  const parsed = await parseEcbRates(await response.text());
  const observedAt = Date.parse(parsed.observedAt);
  const ageDays = (now.getTime() - observedAt) / 86_400_000;
  if (!Number.isFinite(observedAt) || ageDays < -1 || ageDays > 10) {
    throw new Error(`ECB rate snapshot is stale or invalid (${parsed.observedAt || 'unknown'})`);
  }
  const usdPerUnit = {};
  for (const [currency, unitsPerUsd] of Object.entries(parsed.rates || {})) {
    const quote = Number(unitsPerUsd);
    if (Number.isFinite(quote) && quote > 0) usdPerUnit[currency] = 1 / quote;
  }
  usdPerUnit.USD = 1;
  cachedSnapshot = {
    fetched_at_ms: now.getTime(),
    observed_at: `${parsed.observedAt}T00:00:00Z`,
    source: ECB_SOURCE,
    source_url: ECB_SOURCE_URL,
    usd_per_unit: usdPerUnit,
  };
  return cachedSnapshot;
}

function recoverObservation(observation, snapshot = null) {
  if (!observation) return null;
  const currency = String(observation.currency_original || '').toUpperCase();
  const amount = Number(observation.amount_original);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (['USD', 'USDT'].includes(currency)) {
    return {
      price_usd: Math.round(amount), source_amount: amount, source_currency: currency,
      fx_rate: 1, fx_source: 'DIRECT_EXPLICIT_USD_SOURCE', fx_date: null,
      raw_price_text: observation.raw_price_text,
    };
  }
  const rate = Number(snapshot?.usd_per_unit?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0 || !snapshot?.observed_at || !snapshot?.source) return null;
  return {
    price_usd: Math.round(amount * rate), source_amount: amount, source_currency: currency,
    fx_rate: rate, fx_source: snapshot.source, fx_date: snapshot.observed_at,
    raw_price_text: observation.raw_price_text,
  };
}

function rmReferenceIsMyrPriceArtifact(record) {
  const currency = String(record?.source_currency || record?.currency || '').trim().toUpperCase();
  if (currency !== 'MYR') return false;
  const reference = String(record?.reference || record?.normalized_reference || record?.raw_reference || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const match = reference.match(/^RM0*([1-9][0-9]{0,3})$/);
  const amount = Number(record?.source_price_amount ?? record?.price_raw);
  if (!match || !Number.isFinite(amount) || amount !== Number(match[1])) return false;
  const raw = String(record?.raw_message || '');
  const explicitMyrAmount = /\bMYR\b\s*[:=$-]?\s*\d[\d,.]*/i.test(raw)
    || /\d[\d,.]*\s*\bMYR\b/i.test(raw);
  return !explicitMyrAmount;
}

function suppressReferenceTokenPrice(record) {
  if (!rmReferenceIsMyrPriceArtifact(record)) return record;
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
  };
}

async function recoverRecordPrices(records, options = {}) {
  const prepared = (records || []).map(inputRecord => {
    const record = suppressReferenceTokenPrice(inputRecord);
    return {
    record,
    // A prior identity/price collision decision is authoritative. In
    // particular, references such as "RM 001" must never be reparsed as a
    // Malaysian-ringgit amount by this later recovery pass.
    observation: ['REFERENCE_TOKEN_AS_PRICE', 'REFERENCE_PRICE_COLLISION_WITHHELD']
      .includes(String(record?.price_evidence_status || '').toUpperCase())
      || String(record?.workbook_price_review_reason || '').trim()
      ? null
      : explicitObservation(record?.raw_message),
  };
  });
  const needsFx = prepared.some(({ record, observation }) => (
    !Number(record?.price_usd)
    && observation
    && !['USD', 'USDT'].includes(String(observation.currency_original).toUpperCase())
  ));
  let snapshot = options.snapshot || null;
  if (needsFx && !snapshot) {
    try {
      snapshot = await loadLatestFxSnapshot(options);
    } catch (error) {
      console.warn('[runtime-price-recovery] dated FX unavailable; non-USD rows remain unpriced:', error.message);
    }
  }
  return prepared.map(({ record, observation }) => {
    if (Number(record?.price_usd) > 0 || !observation) return record;
    const recovered = recoverObservation(observation, snapshot);
    if (!recovered) return record;
    return {
      ...record,
      price_usd: recovered.price_usd,
      price_raw: recovered.source_amount,
      currency: recovered.source_currency,
      source_price_amount: recovered.source_amount,
      source_currency: recovered.source_currency,
      source_price_text: recovered.raw_price_text,
      analytics_fx_rate: recovered.fx_rate,
      analytics_fx_source: recovered.fx_source,
      analytics_fx_date: recovered.fx_date,
      effective_price_source: 'RUNTIME_EXPLICIT_SOURCE_EVIDENCE',
      runtime_price_recovery_applied: true,
      // The customer UI admits USD display only from an explicit evidence
      // status. Runtime recovery has already required an explicit currency
      // observation; non-USD rows additionally require a dated, named FX
      // snapshot above. Preserve that proof in the same contract consumed by
      // Trading Floor and Price Research instead of leaving the stale
      // PRICE_NOT_SUPPLIED label attached to a verified conversion.
      price_evidence_status: ['USD', 'USDT'].includes(recovered.source_currency)
        ? 'SOURCE_EXPLICIT_USD_MATCH'
        : 'EXPLICIT_SOURCE_FX_CONVERTED',
    };
  });
}

module.exports = {
  ECB_SOURCE,
  ECB_SOURCE_URL,
  explicitObservation,
  loadLatestFxSnapshot,
  recoverObservation,
  recoverRecordPrices,
  rmReferenceIsMyrPriceArtifact,
  suppressReferenceTokenPrice,
};
