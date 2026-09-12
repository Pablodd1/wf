'use strict';

// Isolated parser for the five new brands. It deliberately does not consult a
// catalog or a reference-to-brand inference table: brand context must be in
// the raw source payload or an exact raw heading.
const crypto = require('node:crypto');
const {
  extractPriceCandidates,
  extractReference,
  explicitIntent,
  splitMessageLines,
} = require('../../api/_lib/normalization-v4.cjs');

const BRANDS = ['IWC', 'Hublot', 'Seiko', 'Bell & Ross', 'Tissot'];
const BRAND_HEADERS = [
  ['IWC', /^iwc$/],
  ['Hublot', /^hublot$/],
  ['Seiko', /^seiko$/],
  ['Bell & Ross', /^(?:bell\s*(?:&|and)?\s*ross|bellross)$/],
  ['Tissot', /^tissot$/],
];

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

function referenceKey(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeFiveBrand(value) {
  const key = String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (key === 'iwc') return 'IWC';
  if (key === 'hublot') return 'Hublot';
  if (key === 'seiko') return 'Seiko';
  if (/^(?:bell|bell ross|bell and ross|bellross)$/.test(key)) return 'Bell & Ross';
  if (key === 'tissot') return 'Tissot';
  return null;
}

function explicitFiveBrand(value) {
  const text = String(value ?? '');
  if (/(?:^|[^\p{L}\p{N}])iwc(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'IWC';
  if (/(?:^|[^\p{L}\p{N}])hublot(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Hublot';
  if (/(?:^|[^\p{L}\p{N}])seiko(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Seiko';
  if (/(?:^|[^\p{L}\p{N}])(?:bell\s*(?:&|and)?\s*ross|bellross)(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Bell & Ross';
  if (/(?:^|[^\p{L}\p{N}])tissot(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Tissot';
  return null;
}

function brandHeader(value) {
  const key = String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return BRAND_HEADERS.find(([, pattern]) => pattern.test(key))?.[0] || null;
}

function observedReference(value) {
  const text = clean(value);
  if (!text || /^(?:unknown|null|n\/?a|none|[-–—])$/i.test(text)) return null;
  return text;
}

function observedReferenceForBrand(value, brand) {
  const text = String(value ?? '');
  const rules = {
    Seiko: /(?<![A-Z0-9])(?:S(?:BG|B[DG]|R[EG]|P[BR]|SC|S[EK]|A[SR])[A-Z0-9-]{3,12})(?![A-Z0-9])/i,
    'Bell & Ross': /(?<![A-Z0-9])(?:BR\s?\d{2,3}(?:-\d{2})?(?:-[A-Z0-9]{1,10})?)(?![A-Z0-9])/i,
    Tissot: /(?<![A-Z0-9])(?:T\d{3}(?:\.\d{2,3}){2,4})(?![A-Z0-9])/i,
  };
  const exact = rules[brand]?.exec(text)?.[0];
  return observedReference(exact || extractReference(text));
}

function normalizedIntent(rawData, text, inherited = null) {
  const sourceType = String(rawData?.type ?? '').trim().toLowerCase();
  if (['search', 'wtb', 'ntq'].includes(sourceType)) return 'WTB';
  if (['sale', 'wts'].includes(sourceType)) return 'WTS';
  return explicitIntent(text) || inherited;
}

function priceEvidence(rawLine, context = {}) {
  const candidates = extractPriceCandidates(String(rawLine ?? ''), context);
  const approved = candidates.filter(item => item.evidence_status === 'AUTO_APPROVED');
  if (approved.length !== 1) {
    return { source_price_amount: null, source_price_text: null, source_currency: null,
      price_evidence_status: candidates.length ? 'PRICE_MAPPING_REVIEW_REQUIRED' : 'PRICE_NOT_EXPLICIT',
      price_review_reasons: [...new Set(candidates.map(item => item.review_reason).filter(Boolean))] };
  }
  const price = approved[0];
  return { source_price_amount: Number(price.amount_original) > 0 ? Number(price.amount_original) : null,
    source_price_text: clean(price.raw), source_currency: clean(price.currency_original)?.toUpperCase() || null,
    price_evidence_status: price.evidence_status, currency_evidence: clean(price.currency_evidence),
    price_review_reasons: [] };
}

function normalizedCountry(value) {
  const source = clean(value);
  if (!source) return { location_raw: null, country_code: null, country_name: null };
  const rules = [
    [/\b(?:hong\s*kong|h\.k\.|hk)\b/i, 'HK', 'Hong Kong'],
    [/\b(?:united\s+states|u\.s\.a\.?|usa|new\s+york|miami|los\s+angeles)\b/i, 'US', 'United States'],
    [/\b(?:united\s+kingdom|u\.k\.|uk|london)\b/i, 'GB', 'United Kingdom'],
    [/\b(?:singapore|sg)\b/i, 'SG', 'Singapore'],
    [/\b(?:switzerland|zurich|geneva|ch)\b/i, 'CH', 'Switzerland'],
    [/\b(?:united\s+arab\s+emirates|uae|dubai|abu\s+dhabi)\b/i, 'AE', 'United Arab Emirates'],
    [/\b(?:japan|tokyo|jp)\b/i, 'JP', 'Japan'],
    [/\b(?:canada|toronto|vancouver|ca)\b/i, 'CA', 'Canada'],
    [/\b(?:australia|sydney|melbourne|au)\b/i, 'AU', 'Australia'],
    [/\b(?:france|paris|fr)\b/i, 'FR', 'France'],
    [/\b(?:germany|berlin|munich|de)\b/i, 'DE', 'Germany'],
    [/\b(?:italy|milan|rome|it)\b/i, 'IT', 'Italy'],
  ];
  const match = rules.find(([pattern]) => pattern.test(source));
  return { location_raw: source, country_code: match?.[1] || null, country_name: match?.[2] || null };
}

function contextOnly(line) {
  const text = String(line ?? '').trim();
  return !text || /^(?:wts|wtb|sale|search|new|used|unworn|prices?\s+in\s+[a-z$]+|iwc|hublot|seiko|bell\s*(?:&|and)?\s*ross|bellross|tissot)\s*:?[\s-]*$/i.test(text);
}

function parentFrom(row) {
  const rawData = row.raw_data || {};
  const rawText = String(row.raw_text ?? '');
  const isMulti = rawData.is_bundle === true || /\b(?:bundle|multiple\s+watches|lot\s+of\s+\d+)\b/i.test(rawText);
  return { raw_message_id: row.raw_message_id, raw_message_version_id: row.id,
    source_record_id: row.source_record_id, source_hash: row.source_hash,
    source_created_on: row.source_created_on, observed_at: row.observed_at,
    source_platform: row.source_platform, source_account: normalizePhone(rawData.from_number || row.sender_phone),
    source_sender_name: clean(rawData.from_name), source_group: clean(row.group_id || rawData.region),
    raw_message_source: row.raw_message_source, raw_text: rawText, raw_text_sha256: sha256(rawText),
    raw_data: rawData, raw_data_sha256: sha256(JSON.stringify(rawData)), media: row.media || [],
    has_source_media: Boolean((Array.isArray(row.media) && row.media.length) || clean(rawData.front_image)),
    is_multi: isMulti, intent: normalizedIntent(rawData, rawText) };
}

function childFromLine(line, brand, parent, index, dealer, country) {
  const rawData = parent.raw_data;
  const reference = observedReferenceForBrand(line, brand);
  if (!reference) return null;
  const image = parent.is_multi ? null : clean(rawData.front_image);
  return { child_key: sha256(`${parent.raw_message_version_id}|${index}|${line}`), child_index: index,
    brand, observed_reference: reference, observed_reference_key: referenceKey(reference) || null,
    model_as_posted: clean(rawData.model), intent: normalizedIntent(rawData, line, parent.intent),
    raw_child_text: line, raw_child_sha256: sha256(line), source_image: image,
    source_image_status: image ? 'EXACT_SINGLE_SOURCE_IMAGE' : parent.is_multi && parent.has_source_media
      ? 'PARENT_MEDIA_NOT_SAFELY_ASSIGNABLE' : 'SOURCE_IMAGE_UNAVAILABLE',
    dealer_id: dealer?.dealer_id || null, verified_source_identity: dealer?.source_identity || null,
    dealer_link_status: dealer ? 'EXACT_VERIFIED_SOURCE_IDENTITY' : 'DEALER_IDENTITY_UNRESOLVED',
    ...country, ...priceEvidence(line, { brand_context: brand, intent_context: parent.intent }) };
}

function classifyRawOnlyFiveBrandPost(row, options = {}) {
  const targetBrands = new Set(options.targetBrands || BRANDS);
  const parent = parentFrom(row);
  const dealer = parent.source_account ? options.dealerByPhone?.get(parent.source_account) || null : null;
  const country = normalizedCountry(parent.raw_data.region || row.group_id);
  let contextBrand = normalizeFiveBrand(parent.raw_data.brand) || explicitFiveBrand(parent.raw_text);
  const children = [];
  for (const line of splitMessageLines(parent.raw_text)) {
    const header = brandHeader(line);
    if (header) { contextBrand = header; continue; }
    if (!targetBrands.has(contextBrand)) continue;
    const child = childFromLine(line, contextBrand, parent, children.length + 1, dealer, country);
    if (child) children.push(child);
  }
  if (!children.length && contextBrand && targetBrands.has(contextBrand) && !parent.is_multi) {
    const child = childFromLine(parent.raw_text, contextBrand, parent, 1, dealer, country);
    if (child) children.push(child);
  }
  const unresolvedLines = parent.is_multi ? splitMessageLines(parent.raw_text).filter(line => {
    if (contextOnly(line) || brandHeader(line)) return false;
    return !children.some(child => child.raw_child_text === line);
  }) : [];
  return { parent, brand: new Set(children.map(child => child.brand)).size === 1 ? children[0]?.brand || null : null,
    brands: [...new Set(children.map(child => child.brand))], children,
    classification: !children.length ? 'MULTI_WATCH_UNSPLITTABLE'
      : parent.is_multi || children.length > 1 ? (unresolvedLines.length ? 'MULTI_WATCH_PARTIALLY_SPLITTABLE' : 'MULTI_WATCH_SAFE_TO_SPLIT')
        : 'SINGLE_WATCH',
    review_reasons: !children.length ? ['NO_EXACT_TARGET_CHILD_BOUNDARIES']
      : unresolvedLines.length ? ['UNMAPPED_MULTI_WATCH_TEXT'] : [],
    unresolved_fragments: unresolvedLines.map(text => ({ text, sha256: sha256(text) })) };
}

function withdrawn(rawData, rawText) {
  const status = String(rawData?.status ?? '').trim().toUpperCase();
  return ['WITHDRAWN', 'DELETED', 'ARCHIVED', 'CANCELLED', 'CANCELED'].includes(status)
    || /\b(?:withdrawn|listing\s+withdrawn)\b/i.test(String(rawText ?? ''));
}

module.exports = { BRANDS, classifyRawOnlyFiveBrandPost, normalizePhone, referenceKey, sha256, withdrawn };
