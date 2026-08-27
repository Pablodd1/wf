'use strict';

const crypto = require('node:crypto');
const { extractPriceCandidates, splitMessageLines } = require('../../api/_lib/normalization-v4.cjs');

const CONTRACT = 'curated-luxury-rolex-evidence-restoration-v1';
const EVIDENCE_VERSION = 'rolex-price-image-evidence-v1';
const DIRECT_USD = new Set(['USD', 'USDT']);
const CURRENT_STATUSES = new Set(['CURRENT_ACTIVE', 'CURRENT_LATEST_STATE']);
const SAFE_IMAGE_EVIDENCE = 'SELLER_LISTING_IMAGE';

function clean(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function canonicalDuplicateKey(row) {
  return clean(row?.offer_state_key) || clean(row?.unique_observation_key) || null;
}

function isCanonicalCurrent(row) {
  return row?.brand === 'Rolex'
    && CURRENT_STATUSES.has(clean(row?.current_status))
    && row?.is_canonical_survivor !== false;
}

function exactChildText(row) {
  const raw = String(row?.raw_message ?? '');
  const childHash = clean(row?.exact_child_text_sha256).toLowerCase();
  const parentHash = clean(row?.parent_raw_text_sha256).toLowerCase();
  if (!raw || !/^[0-9a-f]{64}$/.test(childHash)) {
    return { text: null, reason: 'MISSING_EXACT_CHILD_LINEAGE' };
  }
  if (sha256(raw) === childHash || (childHash === parentHash && sha256(raw) === parentHash)) {
    return { text: raw, scope: 'EXACT_SINGLE_SOURCE_MESSAGE', sha256: childHash };
  }
  const candidates = [...new Set([
    ...splitMessageLines(raw),
    ...raw.replace(/_x000D_/gi, '\n').split(/\r?\n/).map(line => line.trim()).filter(Boolean),
  ])].filter(value => sha256(value) === childHash);
  if (candidates.length !== 1) {
    return { text: null, reason: candidates.length ? 'AMBIGUOUS_EXACT_CHILD_TEXT' : 'EXACT_CHILD_TEXT_UNRECOVERED' };
  }
  return { text: candidates[0], scope: 'EXACT_CHILD_SEGMENT', sha256: childHash };
}

function approvedAskPrices(text) {
  const seen = new Set();
  return extractPriceCandidates(text)
    .filter(candidate => candidate.evidence_status === 'AUTO_APPROVED'
      && candidate.price_type === 'ASK_PRICE'
      && candidate.is_primary !== false
      && positiveNumber(candidate.amount_original)
      && clean(candidate.currency_original))
    .filter(candidate => {
      const key = `${candidate.currency_original}|${candidate.amount_original}|${candidate.position?.start}|${candidate.position?.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function reviewEvidence(row, child, reason, extra = {}) {
  const evidence = {
    contract: CONTRACT,
    evidence_version: EVIDENCE_VERSION,
    run_id: row.run_id,
    current_listing_key: row.current_listing_key,
    offer_state_key: row.offer_state_key,
    latest_raw_occurrence_key: row.latest_raw_occurrence_key,
    exact_child_text_sha256: row.exact_child_text_sha256,
    parent_raw_text_sha256: row.parent_raw_text_sha256,
    raw_text_sha256: sha256(row.raw_message || ''),
    child_text_scope: child?.scope || null,
    decision: 'REVIEW_REQUIRED',
    review_reason: reason,
    display_price_verified: false,
    price_research_eligible: false,
    ...extra,
  };
  evidence.evidence_checksum = sha256(JSON.stringify(evidence));
  return evidence;
}

async function buildPriceEvidence(row, resolver) {
  if (!isCanonicalCurrent(row)) return reviewEvidence(row, null, 'NON_CANONICAL_OR_NON_CURRENT');
  const child = exactChildText(row);
  if (!child.text) return reviewEvidence(row, child, child.reason);
  if (child.scope === 'EXACT_SINGLE_SOURCE_MESSAGE'
    && (row.raw_is_bundle === true || Number(row.parent_child_count) !== 1)) {
    return reviewEvidence(row, child, 'NON_SINGLETON_PARENT_PRICE_SCOPE');
  }
  const candidates = approvedAskPrices(child.text);
  if (candidates.length !== 1) {
    return reviewEvidence(row, child, candidates.length ? 'MULTIPLE_EXPLICIT_ASK_PRICES' : 'NO_EXACT_EXPLICIT_PRICE');
  }
  const candidate = candidates[0];
  const sourceAmount = positiveNumber(candidate.amount_original);
  const sourceCurrency = clean(candidate.currency_original).toUpperCase();
  const storedAmount = positiveNumber(row.source_price_amount);
  const storedCurrency = clean(row.source_currency).toUpperCase();
  if ((storedAmount && storedAmount !== sourceAmount) || (storedCurrency && storedCurrency !== sourceCurrency)) {
    return reviewEvidence(row, child, 'STRUCTURED_PRICE_CONFLICTS_WITH_RAW', {
      source_price_text: candidate.raw_price_text,
      source_price_amount: sourceAmount,
      source_currency: sourceCurrency,
    });
  }

  let normalizedUsdAmount = null;
  let classification = null;
  let fx = null;
  if (DIRECT_USD.has(sourceCurrency)) {
    normalizedUsdAmount = sourceAmount;
    classification = sourceCurrency === 'USDT' ? 'SOURCE_EXPLICIT_USD_USDT' : 'SOURCE_EXPLICIT_USD_MATCH';
  } else {
    fx = await resolver?.resolve(sourceCurrency, row.source_timestamp);
    if (!fx) {
      return reviewEvidence(row, child, 'DATED_VERIFIED_FX_UNAVAILABLE', {
        source_price_text: candidate.raw_price_text,
        source_price_amount: sourceAmount,
        source_currency: sourceCurrency,
      });
    }
    normalizedUsdAmount = Math.round(sourceAmount * Number(fx.usd_per_source_unit) * 100) / 100;
    if (!positiveNumber(normalizedUsdAmount)) {
      return reviewEvidence(row, child, 'INVALID_NORMALIZED_USD_AMOUNT');
    }
    classification = 'DATED_VERIFIED_FX';
  }

  const evidence = {
    contract: CONTRACT,
    evidence_version: EVIDENCE_VERSION,
    run_id: row.run_id,
    current_listing_key: row.current_listing_key,
    offer_state_key: row.offer_state_key,
    latest_raw_occurrence_key: row.latest_raw_occurrence_key,
    exact_child_text_sha256: row.exact_child_text_sha256,
    parent_raw_text_sha256: row.parent_raw_text_sha256,
    raw_text_sha256: sha256(row.raw_message || ''),
    child_text_scope: child.scope,
    source_price_text: candidate.raw_price_text,
    source_price_amount: sourceAmount,
    source_currency: sourceCurrency,
    source_span_start: candidate.position?.start ?? null,
    source_span_end: candidate.position?.end ?? null,
    parser_rule: candidate.parser_rule,
    parser_version: candidate.parser_version,
    decision: 'VERIFIED',
    review_reason: null,
    price_evidence_classification: classification,
    normalized_usd_amount: normalizedUsdAmount,
    display_price_verified: true,
    price_research_eligible: row.intent === 'WTS' && Boolean(clean(row.observed_reference_key)),
    fx_contract: fx?.contract || null,
    fx_provider: fx?.provider || null,
    fx_source_url: fx?.source_url || null,
    fx_applicable_date: fx?.applicable_date || null,
    fx_effective_date: fx?.effective_date || null,
    fx_lookback_days: fx?.lookback_days ?? null,
    fx_rate_direction: fx?.rate_direction || null,
    fx_rate: fx?.usd_per_source_unit || null,
  };
  evidence.evidence_checksum = sha256(JSON.stringify(evidence));
  return evidence;
}

function validHttpUrl(value) {
  const url = clean(value);
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function mediaEvidenceType(value) {
  return clean(value?.image_evidence_type || value?.evidence_type || value?.media_type).toUpperCase();
}

function collectMediaUrls(value, found = new Map(), inheritedUnsafe = false, allowDirectString = true) {
  if (typeof value === 'string') {
    const url = validHttpUrl(value);
    if (url && !inheritedUnsafe && allowDirectString) found.set(url, { source_url: url });
    return [...found.values()];
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, found, inheritedUnsafe, true);
    return [...found.values()];
  }
  if (!value || typeof value !== 'object') return [...found.values()];
  const type = mediaEvidenceType(value);
  const unsafe = inheritedUnsafe
    || value.verified_for_child_listing === false
    || /(?:REFERENCE|CATALOG|GENERIC|AMBIGUOUS|BUNDLE)/.test(type);
  if (!unsafe) {
    for (const key of ['source_url', 'public_url', 'url', 'media_url', 'image_url']) {
      const url = validHttpUrl(value[key]);
      if (url) found.set(url, { source_url: url, source_asset_key: clean(value.source_asset_key || value.key || value.id) || null });
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (['source_url', 'public_url', 'url', 'media_url', 'image_url'].includes(key)) continue;
    collectMediaUrls(item, found, unsafe, Array.isArray(item));
  }
  return [...found.values()];
}

function buildImageEvidence(row) {
  if (!isCanonicalCurrent(row)) return [];
  const child = exactChildText(row);
  const singleton = child.text
    && child.scope === 'EXACT_SINGLE_SOURCE_MESSAGE'
    && Number(row.parent_child_count) === 1
    && row.raw_is_bundle !== true;
  if (!singleton) return [];
  const existingKeys = new Set(Array.isArray(row.existing_source_image_keys) ? row.existing_source_image_keys : []);
  const ordinalStart = Number.isInteger(Number(row.next_image_ordinal)) ? Number(row.next_image_ordinal) : 0;
  return collectMediaUrls(row.raw_version_media)
    .filter(media => !existingKeys.has(sha256(media.source_url)))
    .map((media, imageIndex) => {
    const sourceImageKey = sha256(media.source_url);
    const association = {
      run_id: row.run_id,
      current_listing_key: row.current_listing_key,
      raw_occurrence_key: row.latest_raw_occurrence_key,
      source_image_key: sourceImageKey,
      source_url: media.source_url,
      source_asset_key: media.source_asset_key,
      image_ordinal: ordinalStart + imageIndex,
      image_evidence_type: SAFE_IMAGE_EVIDENCE,
      evidence_source: 'RAW_VERSION_CHILD_VERIFIED_MEDIA',
      association_method: 'DETERMINISTIC_SINGLE_WATCH',
      association_evidence_sha256: sha256([
        row.version_key, row.latest_raw_occurrence_key, row.exact_child_text_sha256,
        media.source_url,
      ].join('|')),
    };
    return association;
    });
}

module.exports = {
  CONTRACT,
  CURRENT_STATUSES,
  DIRECT_USD,
  EVIDENCE_VERSION,
  SAFE_IMAGE_EVIDENCE,
  approvedAskPrices,
  buildImageEvidence,
  buildPriceEvidence,
  canonicalDuplicateKey,
  collectMediaUrls,
  exactChildText,
  isCanonicalCurrent,
  positiveNumber,
  sha256,
};
