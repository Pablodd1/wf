'use strict';

const crypto = require('node:crypto');
const {
  extractPriceCandidates,
  extractReference,
  explicitIntent,
  inferBrandFromReference,
  segmentDealerMessage,
  splitMessageLines,
} = require('../../api/_lib/normalization-v4.cjs');

const BRANDS = ['Rolex', 'Patek Philippe'];
const GENERIC_WATCH_BRANDS = ['Rolex', 'Patek Philippe', 'Tudor', 'Zenith', 'Cartier', 'TAG Heuer'];
const BRAND_HEADER_ALIASES = [
  ['Patek Philippe', /^(?:patek(?: philippe)?|philippe patek|pp)$/],
  ['Audemars Piguet', /^(?:audemars(?: piguet)?|ap)$/],
  ['Vacheron Constantin', /^(?:vacheron(?: constantin)?|vc)$/],
  ['Richard Mille', /^(?:richard mille|rm)$/],
  ['Rolex', /^rolex$/], ['Tudor', /^tudor$/], ['Zenith', /^zenith$/],
  ['Cartier', /^cartier$/], ['TAG Heuer', /^(?:tag heuer|tagheuer|heuer)$/],
  ['Omega', /^omega$/], ['Hublot', /^hublot$/], ['Chopard', /^chopard$/],
  ['Panerai', /^panerai$/], ['IWC', /^iwc$/], ['Jaeger-LeCoultre', /^(?:jlc|jaeger lecoultre)$/],
];
const POST_CLASSES = [
  'SINGLE_WATCH',
  'MULTI_WATCH_SAFE_TO_SPLIT',
  'MULTI_WATCH_PARTIALLY_SPLITTABLE',
  'MULTI_WATCH_UNSPLITTABLE',
  'NOT_A_WATCH_LISTING',
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

function normalizeBrand(value) {
  const key = String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/^rolex$/.test(key)) return 'Rolex';
  if (/^(?:patek|patek philippe|philippe patek)$/.test(key)) return 'Patek Philippe';
  if (/^tudor$/.test(key)) return 'Tudor';
  if (/^zenith$/.test(key)) return 'Zenith';
  if (/^cartier$/.test(key)) return 'Cartier';
  if (/^(?:tag|tag heuer|heuer)$/.test(key)) return 'TAG Heuer';
  return null;
}

function explicitBrandInText(value) {
  const text = String(value ?? '');
  if (/(?:^|[^\p{L}\p{N}])rolex(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Rolex';
  if (/(?:^|[^\p{L}\p{N}])(?:patek(?:\s+philippe)?|philippe\s+patek)(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Patek Philippe';
  if (/(?:^|[^\p{L}\p{N}])tudor(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Tudor';
  if (/(?:^|[^\p{L}\p{N}])zenith(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Zenith';
  if (/(?:^|[^\p{L}\p{N}])cartier(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'Cartier';
  if (/(?:^|[^\p{L}\p{N}])(?:tag\s+heuer|tagheuer|heuer)(?:$|[^\p{L}\p{N}])/iu.test(text)) return 'TAG Heuer';
  return null;
}

function observedBrand(rawData, rawText) {
  return normalizeBrand(rawData?.brand) || explicitBrandInText(rawText);
}

function observedReference(value) {
  const text = clean(value);
  if (!text || /^(?:unknown|null|n\/?a|none|[-–—])$/i.test(text)) return null;
  return text;
}

function brandHeaderForLine(value) {
  const key = String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return BRAND_HEADER_ALIASES.find(([, pattern]) => pattern.test(key))?.[0] || null;
}

function observedReferenceForBrand(value, brand) {
  const text = String(value ?? '');
  if (brand === 'Zenith') {
    const match = text.match(/(?<![A-Z0-9])(?:\d{2}\.\d{4}\.\d{3,4}(?:\/[A-Z0-9.]+)?)(?![A-Z0-9])/i);
    if (match) return match[0];
  }
  if (brand === 'TAG Heuer') {
    const match = text.match(/(?<![A-Z0-9])(?:[A-Z]{2,5}\d[A-Z0-9]{2,7}(?:[.-][A-Z0-9]{2,10})+)(?![A-Z0-9])/i);
    if (match) return match[0];
  }
  return observedReference(extractReference(text));
}

function referenceKey(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizedIntent(rawData, rawText, inherited = null) {
  const sourceType = String(rawData?.type ?? '').trim().toLowerCase();
  if (sourceType === 'search' || sourceType === 'wtb' || sourceType === 'ntq') return 'WTB';
  if (sourceType === 'sale' || sourceType === 'wts') return 'WTS';
  return explicitIntent(rawText) || inherited;
}

function withdrawn(rawData, rawText) {
  const status = String(rawData?.status ?? '').trim().toUpperCase();
  return ['WITHDRAWN', 'DELETED', 'ARCHIVED', 'CANCELLED', 'CANCELED'].includes(status)
    || /\b(?:withdrawn|listing\s+withdrawn)\b/i.test(String(rawText ?? ''));
}

function likelyNonListing(rawData, rawText) {
  const status = String(rawData?.status ?? '').trim().toUpperCase();
  const category = Number(rawData?.category_id);
  const text = String(rawText ?? '').trim();
  if (['REJECTED', 'IGNORED', 'NON_WATCH'].includes(status)) return true;
  if (Number.isFinite(category) && category > 0 && !observedBrand(rawData, rawText)
    && !explicitBrandInText(text)) return true;
  return !observedBrand(rawData, rawText) && !text;
}

function priceEvidence(rawLine, context = {}) {
  const candidates = extractPriceCandidates(String(rawLine ?? ''), context);
  const approved = candidates.filter(item => item.evidence_status === 'AUTO_APPROVED');
  if (approved.length !== 1) {
    return {
      source_price_amount: null,
      source_price_text: null,
      source_currency: null,
      price_evidence_status: candidates.length ? 'PRICE_MAPPING_REVIEW_REQUIRED' : 'PRICE_NOT_EXPLICIT',
      price_review_reasons: [...new Set(candidates.map(item => item.review_reason).filter(Boolean))],
    };
  }
  const price = approved[0];
  return {
    source_price_amount: Number(price.amount_original) > 0 ? Number(price.amount_original) : null,
    source_price_text: clean(price.raw),
    source_currency: clean(price.currency_original)?.toUpperCase() || null,
    price_evidence_status: price.evidence_status,
    currency_evidence: clean(price.currency_evidence),
    price_review_reasons: [],
  };
}

function normalizedCountry(value) {
  const source = clean(value);
  if (!source) return { location_raw: null, country_code: null, country_name: null };
  const key = source.normalize('NFKC').toLowerCase();
  const rules = [
    [/\b(?:hong\s*kong|h\.k\.|hk)\b/, 'HK', 'Hong Kong'],
    [/\b(?:united\s+states|u\.s\.a\.?|usa|new\s+york|miami|los\s+angeles)\b/, 'US', 'United States'],
    [/\b(?:united\s+kingdom|u\.k\.|uk|london)\b/, 'GB', 'United Kingdom'],
    [/\b(?:singapore|sg)\b/, 'SG', 'Singapore'],
    [/\b(?:switzerland|zurich|geneva|ch)\b/, 'CH', 'Switzerland'],
    [/\b(?:united\s+arab\s+emirates|uae|dubai|abu\s+dhabi)\b/, 'AE', 'United Arab Emirates'],
    [/\b(?:japan|tokyo|jp)\b/, 'JP', 'Japan'],
    [/\b(?:canada|toronto|vancouver|ca)\b/, 'CA', 'Canada'],
    [/\b(?:australia|sydney|melbourne|au)\b/, 'AU', 'Australia'],
    [/\b(?:france|paris|fr)\b/, 'FR', 'France'],
    [/\b(?:germany|berlin|munich|de)\b/, 'DE', 'Germany'],
    [/\b(?:italy|milan|rome|it)\b/, 'IT', 'Italy'],
  ];
  const match = rules.find(([pattern]) => pattern.test(key));
  return {
    location_raw: source,
    country_code: match?.[1] || null,
    country_name: match?.[2] || null,
  };
}

function lineIsContextOnly(line) {
  const text = String(line ?? '').trim();
  if (!text) return true;
  if (/^(?:wts|wtb|sale|search|new|used|unworn|prices?\s+in\s+[a-z$]+|rolex|patek(?:\s+philippe)?|tudor|zenith|cartier|tag\s*heuer|heuer)\s*:?[\s-]*$/i.test(text)) return true;
  return !extractReference(text) && text.length <= 30 && /^(?:[\p{L}\s:/$-]+)$/u.test(text);
}

function childFromCandidate(candidate, brand, parent, index, dealer, country) {
  const ref = observedReference(candidate.reference);
  const inferred = normalizeBrand(candidate.context?.brand_context)
    || normalizeBrand(inferBrandFromReference(ref)) || brand;
  const price = priceEvidence(candidate.rawLine, candidate.context || {});
  const image = parent.is_multi ? null : clean(parent.raw_data?.front_image);
  return {
    child_key: sha256(`${parent.raw_message_version_id}|${index}|${candidate.rawLine}`),
    child_index: index,
    brand: inferred,
    observed_reference: ref,
    observed_reference_key: referenceKey(ref) || null,
    model_as_posted: clean(parent.raw_data?.model),
    intent: normalizedIntent(parent.raw_data, candidate.rawLine, candidate.context?.intent_context || parent.intent),
    condition_as_posted: clean(candidate.context?.condition_context) || clean(parent.raw_data?.condition_id),
    dial_as_posted: clean(parent.raw_data?.dial_color),
    box_as_posted: clean(parent.raw_data?.box),
    papers_as_posted: clean(parent.raw_data?.papers),
    raw_child_text: candidate.rawLine,
    raw_child_sha256: sha256(candidate.rawLine),
    source_image: image,
    source_image_status: image ? 'EXACT_SINGLE_SOURCE_IMAGE' : parent.is_multi && parent.has_source_media
      ? 'PARENT_MEDIA_NOT_SAFELY_ASSIGNABLE' : 'SOURCE_IMAGE_UNAVAILABLE',
    dealer_id: dealer?.dealer_id || null,
    verified_source_identity: dealer?.source_identity || null,
    dealer_link_status: dealer ? 'EXACT_VERIFIED_SOURCE_IDENTITY' : 'DEALER_IDENTITY_UNRESOLVED',
    ...country,
    ...price,
  };
}

function singleCandidate(parent, brand, dealer, country) {
  const rawReference = observedReference(parent.raw_data?.reference)
    || observedReference(extractReference(parent.raw_text));
  const context = {
    brand_context: brand,
    intent_context: parent.intent,
  };
  return childFromCandidate({ rawLine: parent.raw_text, reference: rawReference, context }, brand, parent, 1, dealer, country);
}

function classifyRawPost(row, options = {}) {
  const rawData = row.raw_data || {};
  const rawText = String(row.raw_text ?? '');
  const brand = observedBrand(rawData, rawText);
  const sourcePhone = normalizePhone(rawData.from_number || row.sender_phone);
  const dealer = sourcePhone ? options.dealerByPhone?.get(sourcePhone) || null : null;
  const country = normalizedCountry(rawData.region || row.group_id);
  const isMulti = rawData.is_bundle === true || /\b(?:bundle|multiple\s+watches|lot\s+of\s+\d+)\b/i.test(rawText);
  const parent = {
    raw_message_id: row.raw_message_id,
    raw_message_version_id: row.id,
    source_record_id: row.source_record_id,
    source_hash: row.source_hash,
    source_created_on: row.source_created_on,
    observed_at: row.observed_at,
    source_platform: row.source_platform,
    source_account: sourcePhone,
    source_sender_name: clean(rawData.from_name),
    source_group: clean(row.group_id || rawData.region),
    raw_message_source: row.raw_message_source,
    raw_text: rawText,
    raw_text_sha256: sha256(rawText),
    raw_data: rawData,
    raw_data_sha256: sha256(JSON.stringify(rawData)),
    media: row.media || [],
    has_source_media: Boolean((Array.isArray(row.media) && row.media.length) || clean(rawData.front_image)),
    is_multi: isMulti,
    intent: normalizedIntent(rawData, rawText),
  };

  if (likelyNonListing(rawData, rawText)) {
    return { parent, brand, classification: 'NOT_A_WATCH_LISTING', children: [], review_reasons: [] };
  }

  if (!isMulti) {
    return {
      parent,
      brand,
      classification: 'SINGLE_WATCH',
      children: [singleCandidate(parent, brand, dealer, country)],
      review_reasons: brand ? [] : ['BRAND_UNRESOLVED'],
    };
  }

  const segmented = segmentDealerMessage(rawText, parent.intent ? { intent_context: parent.intent } : {});
  const children = segmented.map((candidate, index) => childFromCandidate(
    candidate, brand, parent, index + 1, dealer, country,
  ));
  if (!children.length) {
    return {
      parent,
      brand,
      classification: 'MULTI_WATCH_UNSPLITTABLE',
      children,
      review_reasons: ['NO_EXACT_CHILD_BOUNDARIES'],
    };
  }
  const candidateLines = new Set(segmented.map(item => item.rawLine.trim()));
  const unexplained = splitMessageLines(rawText)
    .filter(line => !candidateLines.has(line.trim()) && !lineIsContextOnly(line));
  const safe = children.length >= 2 && unexplained.length === 0;
  return {
    parent,
    brand,
    classification: safe ? 'MULTI_WATCH_SAFE_TO_SPLIT' : 'MULTI_WATCH_PARTIALLY_SPLITTABLE',
    children,
    review_reasons: safe ? [] : ['UNMAPPED_MULTI_WATCH_TEXT'],
    unresolved_fragments: unexplained.map(text => ({ text, sha256: sha256(text) })),
  };
}

function classifyRawPostGeneric(row, options = {}) {
  const targetBrands = new Set(options.targetBrands || GENERIC_WATCH_BRANDS);
  const base = classifyRawPost(row, options);
  const rawData = row.raw_data || {};
  const sourcePhone = normalizePhone(rawData.from_number || row.sender_phone);
  const dealer = sourcePhone ? options.dealerByPhone?.get(sourcePhone) || null : null;
  const country = normalizedCountry(rawData.region || row.group_id);
  let contextBrand = normalizeBrand(rawData.brand);
  let index = 0;
  const children = [];
  for (const line of splitMessageLines(row.raw_text)) {
    const header = brandHeaderForLine(line);
    if (header) {
      contextBrand = header;
      continue;
    }
    if (!targetBrands.has(contextBrand)) continue;
    const reference = observedReferenceForBrand(line, contextBrand);
    if (!reference) continue;
    index += 1;
    children.push(childFromCandidate({ rawLine: line, reference,
      context: { brand_context: contextBrand, intent_context: base.parent.intent } },
    contextBrand, base.parent, index, dealer, country));
  }
  if (!children.length && targetBrands.has(normalizeBrand(rawData.brand)) && !base.parent.is_multi) {
    const child = singleCandidate(base.parent, normalizeBrand(rawData.brand), dealer, country);
    children.push(child);
  }
  const headerBrands = splitMessageLines(row.raw_text).map(brandHeaderForLine)
    .filter(brand => targetBrands.has(brand));
  const rawBrand = normalizeBrand(rawData.brand);
  const brands = [...new Set([...children.map(child => child.brand), ...headerBrands,
    targetBrands.has(rawBrand) ? rawBrand : null].filter(brand => targetBrands.has(brand)))];
  return {
    parent: base.parent,
    brand: brands.length === 1 ? brands[0] : null,
    brands,
    classification: children.length ? (children.length === 1 && !base.parent.is_multi
      ? 'SINGLE_WATCH' : 'MULTI_WATCH_SAFE_TO_SPLIT') : 'MULTI_WATCH_UNSPLITTABLE',
    children,
    review_reasons: children.length ? [] : ['NO_EXACT_TARGET_CHILD_BOUNDARIES'],
  };
}

function priceResearchEligible(child, disposition = {}) {
  if (child.intent !== 'WTS' || !child.observed_reference_key) return false;
  if (disposition.duplicate || disposition.withdrawn || disposition.superseded) return false;
  if (!(Number(child.source_price_amount) > 0) || !child.source_currency) return false;
  return ['USD', 'USDT'].includes(child.source_currency) && child.price_evidence_status === 'AUTO_APPROVED';
}

module.exports = {
  BRANDS,
  GENERIC_WATCH_BRANDS,
  POST_CLASSES,
  brandHeaderForLine,
  classifyRawPost,
  classifyRawPostGeneric,
  clean,
  explicitBrandInText,
  normalizeBrand,
  normalizePhone,
  normalizedCountry,
  observedBrand,
  observedReference,
  observedReferenceForBrand,
  priceEvidence,
  priceResearchEligible,
  referenceKey,
  sha256,
  withdrawn,
};
