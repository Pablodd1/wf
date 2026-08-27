'use strict';

const { parseNumber, segmentDealerMessage } = require('../../api/_lib/normalization-v4.cjs');
const { lookupCatalog } = require('../../api/_lib/catalog.js');
const { comparisonKey, normalizeDialValue, resolveDial } = require('../../api/_lib/dial-normalization.cjs');

const VERSION = 'v4.3-mint-condition';
const USD_PER_UNIT = { USD: 1, USDT: 1, HKD: 1 / 7.8, EUR: 1.08, GBP: 1.27, CHF: 1.12, SGD: 0.74, CNY: 0.138 };

function normalizeText(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s.-]/g, '');
}

function sourcePriceObservation(record) {
  const amount = Number(record.price_raw);
  const currency = String(record.currency || '').trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null;
  const amountUsd = Number(record.price_usd);
  return {
    price_type: 'ASK_PRICE',
    amount_original: amount,
    currency_original: currency,
    amount_usd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : null,
    is_primary: true,
    raw_price_text: null,
    confidence: null,
    // This preserves an already structured source value. It is intentionally
    // not parser evidence and cannot unlock automatic promotion by itself.
    currency_evidence: 'source_record',
  };
}

function sourceCurrencyTextObservation(candidate, record) {
  const currency = String(record.currency || '').trim().toUpperCase();
  const rate = USD_PER_UNIT[currency];
  if (!currency || !rate) return null;

  const match = String(candidate.rawLine || '').match(/\$\s*([\d][\d.,]*)(?:\s*(k|m|mn|w|\u4e07))?/i);
  if (!match) return null;
  const amount = parseNumber(match[1], match[2]);
  if (!amount) return null;

  return {
    price_type: 'ASK_PRICE',
    amount_original: amount,
    currency_original: currency,
    amount_usd: Math.round(amount * rate),
    is_primary: true,
    raw_price_text: match[0].trim(),
    confidence: 85,
    // The amount is deterministic raw-text evidence. The currency comes from
    // the structured source record, so promotion still requires stronger
    // message or section evidence.
    currency_evidence: 'source_record_currency',
  };
}

function applyCurrencyPolicy(price, fxSnapshot = null) {
  if (!price) return price;
  const currency = String(price.currency_original || '').toUpperCase();
  const amount = Number(price.amount_original);
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return price;
  if (currency === 'USD' || currency === 'USDT') {
    return {
      ...price,
      amount_usd: amount,
      conversion_rate: 1,
      conversion_timestamp: null,
      conversion_source: price.currency_evidence === 'usd_defaulted_by_policy'
        ? 'USD_DEFAULTED_BY_POLICY'
        : 'SOURCE_USD_OR_USDT',
    };
  }
  const rate = Number(fxSnapshot?.usd_per_unit?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0 || !fxSnapshot?.observed_at || !fxSnapshot?.source) {
    return {
      ...price,
      amount_usd: null,
      conversion_rate: null,
      conversion_timestamp: null,
      conversion_source: null,
    };
  }
  return {
    ...price,
    amount_usd: Math.round(amount * rate),
    conversion_rate: rate,
    conversion_timestamp: fxSnapshot.observed_at,
    conversion_source: fxSnapshot.source,
  };
}

function analyzeRecord(record, options = {}) {
  const sourceIntent = ['WTB', 'WTS'].includes(String(record.listing_type || '').toUpperCase())
    ? String(record.listing_type).toUpperCase()
    : null;
  const candidates = segmentDealerMessage(
    record.raw_message || '',
    sourceIntent ? { intent_context: sourceIntent } : {},
  );
  const proposed = candidates.map(candidate => {
    let parsedPrices = candidate.prices || [];
    const sourceCurrencyPrice = parsedPrices.length ? null : sourceCurrencyTextObservation(candidate, record);
    if (sourceCurrencyPrice) parsedPrices = [];
    // A collapsed parent price cannot be assigned to an arbitrary child. Only
    // retain a structured source price when the message resolves to one watch.
    const retainedSourcePrice = candidates.length === 1 && !parsedPrices.length && !sourceCurrencyPrice
      ? sourcePriceObservation(record)
      : null;
    const prices = (sourceCurrencyPrice ? [sourceCurrencyPrice] : retainedSourcePrice ? [retainedSourcePrice] : parsedPrices)
      .map(price => applyCurrencyPolicy(price, options.fxSnapshot));
    const primary = prices.find(price => price.is_primary) || prices[0] || null;
    const candidateBrand = candidate.context.brand_context || record.brand || null;
    const candidateReference = candidate.reference || record.reference || null;
    const catalog = candidateReference ? lookupCatalog(candidateReference, candidateBrand) : null;
    const exactCatalog = catalog?.found && ['exact', 'exact_alias', 'exact_inferred_brand', 'collapsed'].includes(catalog.matchType)
      ? catalog
      : null;
    const dial = resolveDial({
      sourceDial: record.dial_color,
      rawText: candidate.rawLine,
      catalogDials: exactCatalog?.dialColors || [],
    });
    return {
      raw_line: candidate.rawLine,
      brand: candidateBrand,
      reference: candidateReference,
      listing_type: candidate.context.intent_context || 'WTS',
      condition: candidate.context.condition_context || null,
      set_status: candidate.context.set_status_context || null,
      listing_status: candidate.context.listing_status_context || null,
      price_raw: primary?.amount_original || null,
      price_usd: primary?.amount_usd || null,
      currency: primary?.currency_original || null,
      currency_evidence: primary?.currency_evidence || null,
      dial_color: dial.value,
      source_dial_color: record.dial_color || null,
      dial_evidence: dial.evidence,
      dial_confidence: dial.confidence,
      dial_ambiguous: dial.ambiguous,
      dial_reason: dial.reason,
      prices,
      price_candidates: candidate.price_candidates || [],
      price_review_reasons: candidate.price_review_reasons || [],
      emoji_price_ambiguous: candidate.emoji_price_ambiguous === true,
    };
  });

  const flags = new Set();
  if (proposed.length === 0) flags.add('NO_CANDIDATE');
  if (proposed.length > 1) flags.add('BUNDLE_SPLIT_REQUIRED');
  if (proposed.length === 1) {
    const next = proposed[0];
    if (next.brand && normalizeText(next.brand) !== normalizeText(record.brand)) flags.add('BRAND_CHANGED');
    if (next.reference && normalizeText(next.reference) !== normalizeText(record.reference)) flags.add('REFERENCE_CHANGED');
    if (next.currency && normalizeText(next.currency) !== normalizeText(record.currency)) flags.add('CURRENCY_CHANGED');
    if (next.listing_type && normalizeText(next.listing_type) !== normalizeText(record.listing_type)) flags.add('INTENT_CHANGED');
    if (next.price_raw && Number(next.price_raw) !== Number(record.price_raw || 0)) flags.add('PRICE_CHANGED');
    const sourceDial = normalizeDialValue(record.dial_color);
    if (next.dial_ambiguous) flags.add('DIAL_AMBIGUOUS');
    if (next.dial_color && comparisonKey(next.dial_color) !== comparisonKey(sourceDial.value)) flags.add('DIAL_CHANGED');

    if (next.price_review_reasons.length) flags.add('PRICE_REVIEW_REQUIRED');
    if (!next.price_raw && record.price_raw != null && !next.price_review_reasons.length) flags.add('PRICE_PARSE_FAILED');
    if (next.listing_type !== 'WTB' && next.emoji_price_ambiguous) flags.add('EMOJI_PRICE_AMBIGUOUS');
  }
  const changeFlags = [...flags];

  return {
    source_record_id: record.id,
    normalization_version: VERSION,
    source_parser_version: record.parser_version || null,
    source_brand: record.brand || null,
    source_reference: record.reference || null,
    source_price_raw: record.price_raw || null,
    source_price_usd: record.price_usd || null,
    source_currency: record.currency || null,
    source_listing_type: record.listing_type || null,
    source_dial_color: record.dial_color || null,
    candidate_count: proposed.length,
    proposed_candidates: proposed,
    change_flags: changeFlags,
    review_status: changeFlags.length ? 'PENDING' : 'NO_CHANGE',
    analyzed_at: new Date().toISOString(),
  };
}

async function apiFetch(baseUrl, key, path, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function run() {
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new Error('SUPABASE_URL and a server key are required');

  const jobName = process.env.JOB_NAME || 'normalization-v4-production';
  const batchSize = Math.max(10, Math.min(Number(process.env.BATCH_SIZE || 250), 1000));
  const maxRows = Math.max(1, Number(process.env.MAX_ROWS || 10000));
  const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

  const checkpoints = await apiFetch(baseUrl, key,
    `normalization_shadow_checkpoints?job_name=eq.${encodeURIComponent(jobName)}&select=last_source_record_id,rows_analyzed&limit=1`);
  let lastId = checkpoints?.[0]?.last_source_record_id || '';
  let total = 0;

  while (total < maxRows) {
    const limit = Math.min(batchSize, maxRows - total);
    const params = new URLSearchParams({
      select: 'id,raw_message,brand,reference,price_raw,price_usd,currency,listing_type,dial_color,parser_version',
      raw_message: 'not.is.null',
      order: 'id.asc',
      limit: String(limit),
    });
    if (lastId) params.set('id', `gt.${lastId}`);

    const records = await apiFetch(baseUrl, key, `watch_records?${params.toString()}`);
    if (!records?.length) break;
    const shadowRows = records.map(analyzeRecord);
    lastId = records[records.length - 1].id;
    total += records.length;

    if (!dryRun) {
      await apiFetch(baseUrl, key, 'normalization_shadow_v4?on_conflict=source_record_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(shadowRows),
      });
      await apiFetch(baseUrl, key, 'normalization_shadow_checkpoints?on_conflict=job_name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          job_name: jobName,
          last_source_record_id: lastId,
          rows_analyzed: (checkpoints?.[0]?.rows_analyzed || 0) + total,
          updated_at: new Date().toISOString(),
        }]),
      });
    }

    const changed = shadowRows.filter(row => row.change_flags.length > 0).length;
    console.log(JSON.stringify({ total, batch: records.length, changed, lastId, dryRun }));
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { analyzeRecord, applyCurrencyPolicy };

