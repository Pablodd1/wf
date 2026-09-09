'use strict';

// This module produces evidence-bound proposals only. It neither writes to a
// database nor decides offer/repost identity, FX valuation or final admission.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifySourceContent } = require('./content-provenance.cjs');
const { stableJson } = require('./lossless-payload-sanitizer.cjs');
const { extractPriceCandidates } = require('../../api/_lib/normalization-v4.cjs');
const { classify } = require('./audit-non-watch.cjs');
const { classifyNonWatch } = require('../../api/_lib/reference-quality.cjs');

const CONTRACT = 'WF_EXPANDED_SOURCE_CANDIDATE_V1';
const PARSER_VERSION = 'expanded-evidence-v6-inventory-section-r2';
const { inventorySaleHeader } = require('./expanded-inventory-section-policy-v6.cjs');
const { urlSpans, additionalReferenceBoundary, taggedIdentifierSpans, puritySpans, supplementalPriceClaims, isDecoratedCondition, affirmativeAvailabilityHeader, sameReferenceTitleRestatement } = require('./expanded-offer-boundary-policy-v5.cjs');
const { nonReferenceAnchors } = require('./expanded-reference-anchor-policy-v2.cjs');
const { extendedReferenceClaim, foreignCurrencyExchangeLine, nonwatchIntentObject, nonIntentFullStickersLine, fullStickerDefinitionSpans } = require('./expanded-source-scope-policy-v3.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const catalogFile = path.resolve(__dirname, '../../public/catalog-source-v1.json');
const brandsFile = path.resolve(__dirname, '../../api/dictionaries/brands.json');
const aliasesFile = path.resolve(__dirname, '../../shared/published-brand-aliases.json');
const catalog = JSON.parse(fs.readFileSync(catalogFile));
const brandDictionary = JSON.parse(fs.readFileSync(brandsFile)).brands;
const aliases = JSON.parse(fs.readFileSync(aliasesFile));
const DEPENDENCY_HASHES = Object.freeze(Object.fromEntries([
  ['inventory_section_policy', path.resolve(__dirname, 'expanded-inventory-section-policy-v6.cjs')],
  ['previous_offer_parser', path.resolve(__dirname, 'expanded-evidence-candidates-v5.cjs')],
  ['catalog', catalogFile], ['brands', brandsFile], ['aliases', aliasesFile],
  ['price_parser', path.resolve(__dirname, '../../api/_lib/normalization-v4.cjs')],
  ['base_parser', path.resolve(__dirname, 'expanded-evidence-candidates.cjs')],
  ['reference_anchor_policy', path.resolve(__dirname, 'expanded-reference-anchor-policy-v2.cjs')],
  ['previous_parser', path.resolve(__dirname, 'expanded-evidence-candidates-v2.cjs')],
  ['source_scope_policy', path.resolve(__dirname, 'expanded-source-scope-policy-v3.cjs')],
  ['previous_scope_parser', path.resolve(__dirname, 'expanded-evidence-candidates-v3.cjs')],
  ['offer_boundary_policy', path.resolve(__dirname, 'expanded-offer-boundary-policy-v5.cjs')],
].map(([key, file]) => [key, sha(fs.readFileSync(file))])));
const canonicalBrand = value => aliases[String(value || '').trim().toLowerCase()] || String(value || '').trim();
const compact = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const refKey = value => String(value || '').replace(/\s/g, '').toUpperCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameBrand = (a, b) => compact(canonicalBrand(a)) === compact(canonicalBrand(b));
const catalogByRef = new Map();
for (const entry of catalog.entries) {
  if (!entry.brand || !entry.reference || !entry.source_files?.length) continue;
  const key = refKey(entry.reference);
  const list = catalogByRef.get(key) || [];
  list.push({ brand: canonicalBrand(entry.brand), reference: entry.reference, model: entry.model || null, source_files: entry.source_files });
  catalogByRef.set(key, list);
}

// Full maker names/orthographic variants and already supported explicit maker
// abbreviations. Model-family aliases are not treated as literal manufacturers.
const shortMakers = new Set(['patek', 'audemars', 'vacheron', 'pp', 'ap', 'rm', 'vc', 'jlc', 'iwc', 'fpj', 'moser']);
const makerTokens = new Map();
for (const [token, target] of Object.entries(brandDictionary)) {
  const brand = canonicalBrand(target);
  if (brand === 'Various') continue;
  if (compact(token) === compact(brand) || shortMakers.has(token.toLowerCase())) makerTokens.set(token.toLowerCase(), brand);
}
for (const brand of Object.values(brandDictionary).map(canonicalBrand)) {
  if (brand && brand !== 'Various') makerTokens.set(brand.toLowerCase(), brand);
}
const makerPattern = new RegExp('(?<![\\p{L}\\p{N}])(?:' + [...makerTokens.keys()].sort((a, b) => b.length - a.length).map(escape).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
const currencyPattern = /^(?:HKD|HDK|USD|USDT|EUR|GBP|AED|CHF|SGD|JPY|CNY|RMB|AUD|CAD|NZD|INR|THB|MYR|KRW|TWD|SAR|QAR|KWD|BHD|ZAR|BRL|MXN|PHP|IDR|VND|TRY|DKK|NOK|SEK)[\s:.$-]*\d[\d.,]*(?:\s*[KM])?$/i;
const currencyHeader = /^[\s*_#:-]*(?:(?:all\s+)?prices?\s*(?:in|:)?\s*)?(USD|USDT|HKD|EUR|GBP|AED|CHF|SGD|JPY|CNY|AUD|CAD|MYR|SAR)[\s*_#:-]*$/i;
const headerCurrencyTokens = /\b(?:USD|USDT|HKD|EUR|GBP|AED|CHF|SGD|JPY|CNY|AUD|CAD|MYR|SAR)\b/gi;
const packagePattern = /\b(?:bundle\s*price|package(?:\s+(?:price|deal))?|take\s+all|sold\s+together|sell\s+together|both\s+for|all\s+for|as\s+a\s+lot|for\s+the\s+pair|pair\s+of\s+watches)\b/i;
const quantityPattern = /\b(?:[2-9]\d*\s*(?:pcs?|pieces?|units?|watches)|qty\s*[:=]?\s*[2-9]\d*)\b|(?:^|\s)[x×]\s*[2-9]\d*\b/i;
const negativeIntent = /\b(?:not\s+for\s+sale|not\s+selling|do\s+not\s+(?:buy|sell)|no\s+(?:WTB|WTS)|sell\s+or\s+trade|sale\s+or\s+trade)\b/i;
const buyPattern = /\b(?:WTB|NTQ|want\s+to\s+buy|looking\s+(?:for|to\s+buy)|seeking|wanted|LF)\b|求购|求購|求收|收购|寻找|尋找|找表|找貨/gi;
const sellPattern = /\b(?:WTS|FS|for\s+sale|want\s+to\s+sell|selling)\b/gi;
const askPattern = /\b(?:asking(?:\s+price)?|ask|sale\s+price|net\s+price|price|yours\s+for|firm|obo)\b/i;
const nonAskPattern = /\b(?:retail|rrp|msrp|list\s+price|budget|paid|cost|trade\s+value|insurance|valuation)\b/i;

// These validate complete source tokens; they never pad digits, append catalog
// suffixes, select a catalog model or supply a missing manufacturer.
const referencePatterns = [
  ['Rolex', /^(?:[12]\d{4,5}|52\d{3})(?:LN|LV|LB|BLRO|BLNR|CHNR|GRNR|VTNR|SARU|SABR|SACO|SATS|SANR|SAFUBL|RBOW|TBR|RBR|TEM|SRBR)?$/],
  ['Patek Philippe', /^[345678]\d{3}[A-Z]?(?:\/\d[A-Z0-9]*)?(?:-\d{3})?$/],
  ['Audemars Piguet', /^(?:15|26|67|77)\d{3}[A-Z]{2}(?:\.[A-Z0-9.]+)?$/],
  ['Richard Mille', /^RM\d{2,3}(?:-\d{2})?$/],
  ['Cartier', /^W[A-Z0-9]{7}$/],
  ['Omega', /^\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{3}$/],
  ['Hublot', /^\d{3}\.[A-Z0-9]{2}\.[A-Z0-9]{4}\.[A-Z0-9]{2}(?:\.[A-Z0-9]{4})?$/],
  ['Vacheron Constantin', /^(?:\d{4}[VH](?:\/\d{3}[A-Z]-[A-Z0-9]+)?|\d{5})$/],
  ['Tudor', /^M?7\d{3,4}[A-Z0-9]*(?:-\d{4})?$/],
  ['Panerai', /^PAM\d{3,5}$/], ['IWC', /^IW\d{6}$/],
  ['Jaeger-LeCoultre', /^Q\d{7}$/], ['Piaget', /^G0A\d{5}$/],
  ['Bvlgari', /^10\d{4}$/], ['Chopard', /^(?:\d{6}-\d{4}|\d{4})$/],
  ['TAG Heuer', /^(?:CAL|WW|CBL|CAZ|WAZ|CAR|CBK)[A-Z0-9.]{4,}$/],
  ['Zenith', /^\d{2}\.\d{4}\.\d{4}\/[A-Z0-9.]+$/],
  ['Blancpain', /^[A-Z0-9]{4}-[A-Z0-9]{4,5}-[A-Z0-9]{3,4}$/],
  ['Ulysse Nardin', /^\d{3,4}-\d{2,4}(?:\/\d{2,3})?$/],
  ['Girard-Perregaux', /^\d{5}-\d{2}-\d{4}-[A-Z0-9]{4}$/],
  ['Grand Seiko', /^SB[A-Z]{2}\d{3}$/],
  ['Longines', /^L\d\.\d{3}\.\d\.\d{2}\.\d$/],
  ['Breitling', /^[A-Z]{2}\d{4}[A-Z0-9]{0,8}$/],
];

function parsingView(original) {
  const points = Array.from(original);
  const starts = [], ends = [];
  let text = '';
  points.forEach((point, index) => {
    const derived = point.normalize('NFKC').replace(/\p{Cf}/gu, '');
    text += derived;
    for (let unit = 0; unit < derived.length; unit++) { starts.push(index); ends.push(index + 1); }
  });
  return { text, points, starts, ends };
}

function sourceLines(text) {
  const lines=[];
  for(const match of text.matchAll(/[^\r\n\u2028\u2029]+/g)){
    let start=match.index;
    for(const part of match[0].split('_x000D_')){const leading=part.length-part.trimStart().length,value=part.trim();if(value)lines.push({text:value,start:start+leading,end:start+leading+value.length});start+=part.length+'_x000D_'.length;}
  }return lines;
}

function span(view, field, fieldHash, start, end, role) {
  const cpStart = view.starts[start] ?? view.points.length;
  const cpEnd = end > start ? view.ends[end - 1] : cpStart;
  const quote = view.points.slice(cpStart, cpEnd).join('');
  return { field, field_sha256: fieldHash, start: cpStart, end: cpEnd, offset_unit: 'UNICODE_CODEPOINT', end_exclusive: true, quote, quote_sha256: sha(quote), role };
}

function sourceField(raw) {
  return ['description', 'title', 'comments'].find(field => typeof raw[field] === 'string' && raw[field].trim()) || null;
}

function literalIntent(text) {
  const evidence = [];
  const stickerSpans=/full\s+stickers?/i.test(text)?sourceLines(text).flatMap(l=>fullStickerDefinitionSpans(l.text).map(s=>({start:l.start+s.start,end:l.start+s.end}))):[];
  for (const [intent, pattern] of [['WTB', buyPattern], ['WTS', sellPattern]]) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      if(stickerSpans.some(s=>m.index>=s.start&&m.index<s.end))continue;
      evidence.push({ intent, start: m.index, end: m.index + m[0].length });
    }
  }
  const spaced = /^[^\p{L}\p{N}]*(W[ \t]+T[ \t]+([BS]))(?=$|[\s:;,!?-])/iu.exec(text);
  if (spaced) evidence.push({ intent: spaced[2].toUpperCase() === 'B' ? 'WTB' : 'WTS', start: spaced.index + spaced[0].indexOf(spaced[1]), end: spaced.index + spaced[0].length });
  const attached = /^[^\p{L}\p{N}]*(NTQ)(?=\d)/iu.exec(text);
  if (attached) evidence.push({ intent: 'WTB', start: attached[0].length - 3, end: attached[0].length });
  const directions = [...new Set(evidence.map(e => e.intent))];
  return { intent: directions.length === 1 ? directions[0] : null, conflict: directions.length > 1 || negativeIntent.test(text), evidence };
}

function makers(text) {
  makerPattern.lastIndex = 0;
  return [...text.matchAll(makerPattern)].filter(m => {
    if (/^(?:pp|ap|rm|vc|lf|fpj)$/i.test(m[0]) && m[0] !== m[0].toUpperCase() && text.replace(m[0], '').replace(/[^\p{L}\p{N}]/gu, '') !== '') return false;
    // RM followed by an amount is a Malaysian currency candidate, not maker evidence.
    if (/^RM$/i.test(m[0]) && /^\s*\d{4,}(?:[.,]|\b)/.test(text.slice(m.index + m[0].length))) return false;
    return true;
  }).map(m => ({ brand: makerTokens.get(m[0].toLowerCase()), start: m.index, end: m.index + m[0].length }));
}

function priceSourceRole(text, start, end) {
  const before=text.slice(Math.max(0,start-80),start);
  const linePrefix=before.split(/[\r\n\u2028\u2029]/).at(-1);
  const after=text.slice(end,end+45).split(/[\r\n\u2028\u2029]/)[0];
  const adjustment=/^[ \t]*[-+~–][ \t]*\d+(?:[.,]\d+)?[ \t]*(?:%|[KM])?/i.exec(after);
  const supplemental=/\+[ \t]*$/.test(linePrefix)||/\b(?:shipping\s*(?:fee|cost)?|deposit|additional|extra|service\s*fee)\s*[:=-]?\s*$/i.test(linePrefix)||/^\s*(?:to\s+make\s+complete|for\s+(?:shipping|box|papers))\b/i.test(after);
  const role=supplemental?'NON_ASK':/\bbudget\b/i.test(linePrefix)?'EXPLICIT_BUDGET':nonAskPattern.test(linePrefix)?'NON_ASK':askPattern.test(linePrefix)||/\b(?:firm|obo)\b/i.test(after.slice(0,16))?'EXPLICIT_ASK':'UNLABELLED';
  return {role,adjustment,explicit_sale_role:/\b(?:asking|sale\s+price|yours\s+for)\b/i.test(linePrefix)};
}

function prices(text, currency = null) {
  // Prevent a following delivery range/date from becoming part of this line's price.
  const claimed = sourceLines(text).flatMap(line => extractPriceCandidates(line.text, currency ? { currency_context: currency } : {}).map(p => ({...p, source_line_start:line.start})));
  const purity = puritySpans(text);
  const supplementalClaims = supplementalPriceClaims(text);
  const positions = new Set();
  const found = [];
  for (const p of claimed) {
    const quote = String(p.raw_price_text || '');
    let position = (p.source_line_start || 0) - 1;
    while (quote && (position = text.indexOf(quote, position + 1)) >= 0 && positions.has(position + ':' + quote)) { /* exact duplicate source occurrence */ }
    if (!quote || position < 0) continue;
    positions.add(position + ':' + quote);
    if (purity.some(s => position >= s.start && position + quote.length <= s.end)) continue;
    if (supplementalClaims.some(s => s.currency && position >= s.start && position + quote.length <= s.end)) continue;
    const {role,adjustment,explicit_sale_role}=priceSourceRole(text,position,position+quote.length);
    const rawNumber = /\d[\d.,]*/.exec(quote)?.[0];
    const hasScale = /(?:^|[\d.,\s])(?:million|mill|mil|mn|m|k)(?=$|[^a-z])/i.test(quote);
    const numeric = exactDecimalAmount(rawNumber, hasScale, quote);
    found.push({ start: position, end: position + quote.length + (adjustment?.[0].length || 0), amount: numeric?.amount || null, currency: p.currency_original || null, numeric_evidence: numeric, rule: p.parser_rule, review_reason: adjustment || p.discount_percent != null ? 'PRICE_ADJUSTMENT_REQUIRES_REVIEW' : numeric ? p.review_reason : 'PRICE_NUMBER_FORMAT_REVIEW', role, explicit_sale_role, uses_currency_context: p.currency_evidence === 'section_currency' });
  }
  // V2 preserves literal price facts that caused a false reference split in V1.
  // Existing price claims win; never duplicate or infer a currency.
  for (const anchor of nonReferenceAnchors(text)) {
    if (!anchor.price_role || found.some(p => anchor.start < p.end && anchor.end > p.start)) continue;
    const numeric = exactDecimalAmount(anchor.raw_number, anchor.had_multiplier, anchor.quote);
    const inheritedCurrency = anchor.ambiguous_dollar && !/^(?:USD|HKD|SGD|CAD|AUD|NZD)$/.test(currency || '') ? null : currency;
    found.push({ start: anchor.start, end: anchor.end, amount: numeric?.amount || null,
      currency: anchor.currency || inheritedCurrency || null, numeric_evidence: numeric,
      rule: anchor.reason, role: anchor.price_role, explicit_sale_role: anchor.explicit_sale_role,
      uses_currency_context: !anchor.currency && Boolean(inheritedCurrency),
      review_reason: !numeric ? 'PRICE_NUMBER_FORMAT_REVIEW' : !anchor.currency && !inheritedCurrency ? anchor.ambiguous_dollar ? 'CURRENCY_AMBIGUOUS' : 'CURRENCY_NOT_DETECTED' : null });
  }
  for (const p of supplementalClaims) {
    const numeric = exactDecimalAmount(p.raw_number, p.had_multiplier, p.quote);
    if (found.some(old => old.start < p.end && old.end > p.start && old.currency===p.currency && old.amount===numeric?.amount)) continue;
    const semantics=priceSourceRole(text,p.start,p.end);
    const role=semantics.role==='UNLABELLED'?p.price_role:semantics.role;
    found.push({start:p.start,end:p.end+(semantics.adjustment?.[0].length||0),amount:numeric?.amount||null,currency:p.currency,numeric_evidence:numeric,rule:p.reason,role,explicit_sale_role:semantics.explicit_sale_role||Boolean(p.explicit_sale_role),uses_currency_context:false,review_reason:semantics.adjustment?'PRICE_ADJUSTMENT_REQUIRES_REVIEW':!numeric?'PRICE_NUMBER_FORMAT_REVIEW':p.currency?null:'CURRENCY_NOT_DETECTED'});
  }
  return found.sort((a, b) => a.start - b.start);
}

function exactDecimalAmount(rawNumber, hadMultiplier, quote) {
  let token = String(rawNumber || '').trim();
  const scaleMatch = /(?:^|[\d.,\s])(million|mill|mil|mn|m|k)(?=$|[^a-z])/i.exec(quote);
  const scale = hadMultiplier ? scaleMatch?.[1].toLowerCase() : null;
  if (hadMultiplier && !scale) return null;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(token) && !scale) token = token.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(token) && !scale) token = token.replace(/\./g, '');
  else if (/^\d+[.,]\d+$/.test(token)) token = token.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(token)) return null;
  const [integer, fraction = ''] = token.split('.');
  const exponent = !scale ? 0 : scale === 'k' ? 3 : 6;
  let digits = (integer + fraction).replace(/^0+(?=\d)/, '');
  const decimals = fraction.length - exponent;
  let amount;
  if (decimals <= 0) amount = digits + '0'.repeat(-decimals);
  else {
    digits = digits.padStart(decimals + 1, '0');
    amount = digits.slice(0, -decimals) + '.' + digits.slice(-decimals);
    amount = amount.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (!/[1-9]/.test(amount) || amount.length > 40) return null;
  return { amount, raw_number: rawNumber, scale_token: scale, decimal_rule: 'EXACT_SOURCE_DECIMAL_AND_EXPLICIT_SCALE_NO_ROUNDING' };
}

function referenceClaims(text, brand, rawReference, priceFacts) {
  const result = [];
  const excludedAnchors = [...nonReferenceAnchors(text), ...urlSpans(text)];
  // Treat explicit whitespace-separated watch suffixes as one source token.
  const tokenPattern = /(?:RM|PAM|G0A)[ \t]+\d[A-Z0-9]*(?:[./-][A-Z0-9]+)*|\d{5,6}[ \t]+(?:LN|LB|LV|BLRO|BLNR|CHNR|GRNR|RBOW)\b|[A-Z0-9]+(?:[./-][A-Z0-9]+)*/gi;
  for (const m of text.matchAll(tokenPattern)) {
    let token = m[0], start = m.index;
    if (/^NTQ\d/i.test(token)) { token = token.slice(3); start += 3; }
    const key = refKey(token);
    if (!/\d/.test(key) || key.length < 3 || key.length > 40 || currencyPattern.test(key) || /^(?:19|20)\d{2}(?:[-/]\d{2,4})?$/.test(key) || /^\d{7,}$/.test(key)) continue;
    if (priceFacts.some(p => start < p.end && start + token.length > p.start)) continue;
    if (excludedAnchors.some(p => start < p.end && start + token.length > p.start)) continue;
    if (/(?:price|asking|ask|stock\s*(?:id|code|no)?|serial\s*(?:id|no)?|s\/n|tel|phone|whatsapp)\s*[:#=-]?\s*$/i.test(text.slice(Math.max(0, start - 24), start))) continue;
    const entries = catalogByRef.get(key) || [];
    const pattern = referencePatterns.find(([name]) => sameBrand(brand, name))?.[1];
    const catalogMatch = entries.length > 0;
    const brandPattern = Boolean(pattern?.test(key));
    const labelled = /\b(?:ref(?:erence)?\.?|model\s*(?:no|number))\s*[:#=-]?\s*$/i.test(text.slice(Math.max(0, start - 25), start));
    const rawExact = rawReference && refKey(rawReference) === key;
    // Generic recognition establishes only a reference claim to review, never maker.
    const generic = /^(?:\d{4,6}[A-Z]{0,12}|RM\d{2,3}[A-Z0-9./-]*|PAM\d{3,5}[A-Z0-9]*)$/.test(key)
      || extendedReferenceClaim(key) || additionalReferenceBoundary(key)
      || referencePatterns.some(([, otherPattern]) => otherPattern.test(key))
      || (sameBrand(brand, 'Richard Mille') && /^\d{2,3}-\d{2}[A-Z0-9]*$/.test(key))
      || (/\d/.test(key) && /^(?:[A-Z0-9]{2,}\.){2,}[A-Z0-9/.-]+$/.test(key));
    if (catalogMatch || brandPattern || labelled || rawExact || generic) result.push({ reference: key, start, end: start + token.length, recognized: catalogMatch || brandPattern, catalog: entries, rule: catalogMatch ? 'EXACT_CATALOG_REFERENCE' : brandPattern ? 'COMPLETE_MAKER_REFERENCE_PATTERN' : 'UNVERIFIED_REFERENCE_CLAIM' });
  }
  return result;
}

function emptyImages() { return { image_key: null, image_url: null, primary_image_key: null, primary_image_url: null, thumbnail: null, thumbnail_url: null, image_urls: [], images: [], gallery: [] }; }

function buildExpandedCandidates(staged) {
  for (const key of ['source_id', 'source_system', 'source_database', 'source_table']) {
    if (typeof staged?.[key] !== 'string' || !staged[key].trim()) throw new Error('EXPANDED_SOURCE_IDENTITY_REQUIRED');
  }
  const proof = verifySourceContent(staged);
  const raw = staged.raw_payload;
  const field = sourceField(raw);
  const original = field ? raw[field] : '';
  const fieldHash = field ? sha(original) : null;
  const envelope = {
    contract: CONTRACT, parser_version: PARSER_VERSION, dependency_hashes: DEPENDENCY_HASHES,
    source_system: staged.source_system, source_database: staged.source_database, source_table: staged.source_table,
    source_id: staged.source_id, source_hash: staged.source_hash, parent_source_field: field, parent_field_hash: fieldHash,
    source_status: raw.status == null ? null : String(raw.status), source_type: raw.type == null ? null : String(raw.type),
    source_dates: Object.fromEntries(['created_on', 'updated_on', 'reposted_at', 'deleted_on'].map(key => [key, raw[key] ?? null])),
    source_date_semantics: 'ORIGINAL_SOURCE_VALUE_TIMEZONE_NOT_ASSUMED',
    is_explicit_bundle: Number(raw.is_bundle) === 1, candidates: [], residuals: [],
  };
  if (proof.lossless || !field) {
    envelope.parent_outcome = 'REVIEW';
    envelope.residuals.push({ reason: proof.lossless ? 'PROVENANCE_LOSSLESS_REVIEW_REQUIRED' : 'MISSING_SOURCE_TEXT', evidence: [] });
    return envelope;
  }
  const view = parsingView(original);
  const makeSpan = (start, end, role) => span(view, field, fieldHash, start, end, role);
  const metadataMaker = raw.brand == null ? null : canonicalBrand(raw.brand);
  const lines = sourceLines(view.text);
  const context = { brand: null, currency: null, intent: null, condition: null, nonwatch_scope: null, availability: null };
  const blocks = [];
  let active = null;
  const finish = () => { if (active) blocks.push(active); active = null; };
  for (const line of lines) {
    const ms = makers(line.text), bs = [...new Set(ms.map(m => m.brand))];
    const li = literalIntent(line.text);
    const curr = currencyHeader.exec(line.text);
    const ps = prices(line.text, context.currency?.value);
    const refs = referenceClaims(line.text, bs.length === 1 ? bs[0] : context.brand?.value || metadataMaker, raw.reference, ps);
    const condition = isDecoratedCondition(line.text);
    if(!refs.length&&!ps.length&&inventorySaleHeader(line.text)){
      // End the preceding request before changing context. A following explicit
      // child or intent header retains its established higher evidence priority.
      finish();
      context.intent={value:'WTS',proof:makeSpan(line.start,line.end,'EXPLICIT_INVENTORY_SALE_SECTION')};
      context.availability=null;
      context.nonwatch_scope=null;
      context.condition=null;
      // Availability changes intent, not the established manufacturer heading.
      continue;
    }
    if(!refs.length&&!ps.length&&affirmativeAvailabilityHeader(line.text)){
      context.availability={value:'AFFIRMATIVE_AVAILABILITY',proof:makeSpan(line.start,line.end,'SOURCE_AFFIRMATIVE_AVAILABILITY_HEADER')};
    }
    const onlyMaker = bs.length === 1 && line.text.replace(line.text.slice(ms[0].start, ms[0].end), '').replace(/[\s*_#:-]/g, '') === '';
    const nonwatchObject=nonwatchIntentObject(line.text.replace(makerPattern,''));
    const foreignCurrencyIntent = !ms.length && foreignCurrencyExchangeLine(line.text);
    if(nonIntentFullStickersLine(line.text)&&!refs.length&&!li.evidence.length){
      if(active)active.end=line.end;else envelope.residuals.push({reason:'FULL_STICKERS_TEXT_NOT_SALE_INTENT',evidence:[makeSpan(line.start,line.end,'FULL_STICKERS_LITERAL_CONTEXT')]});
      continue;
    }
    // A non-watch request is retained as an exact residual. It cannot enter a
    // preceding watch block or replace a genuine prior watch-intent header.
    if (!refs.length && (foreignCurrencyIntent || nonwatchObject)) {
      finish();
      const proof=makeSpan(line.start,line.end,nonwatchObject==='NONWATCH_ACCESSORY_REQUEST'?'NONWATCH_ACCESSORY_SECTION':'NONWATCH_INTENT_CONTEXT');
      if(nonwatchObject==='NONWATCH_ACCESSORY_REQUEST')context.nonwatch_scope={value:'NONWATCH_ACCESSORY_SECTION',proof};
      envelope.residuals.push({ reason: foreignCurrencyIntent ? 'NONWATCH_CURRENCY_EXCHANGE_INTENT_LINE' : nonwatchObject, evidence: [proof] });
      continue;
    }
    const onlyIntent = !li.conflict && li.intent && line.text.length < 80 && !/\d/.test(line.text) && !nonAskPattern.test(line.text);
    const currencies = [...new Set((line.text.match(headerCurrencyTokens) || []).map(t => t.toUpperCase()))];
    const residue = line.text.replace(makerPattern, '').replace(buyPattern, '').replace(sellPattern, '').replace(headerCurrencyTokens, '').replace(/\b(?:all|prices?|in|stock|watches|list|condition|brand\s+new|unworn|used|pre[- ]owned|new)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, '');
    const structured = !refs.length && !ps.length && !residue && (ms.length || currencies.length || li.evidence.length || condition);
    if (!refs.length && (onlyMaker || curr || condition || onlyIntent || structured)) {
      finish();
      if (onlyMaker || (structured && bs.length === 1)) context.brand = { value: bs[0], proof: makeSpan(line.start + ms[0].start, line.start + ms[0].end, 'SECTION_MAKER') };
      if (structured && bs.length > 1) context.brand = { value: null, conflict: true, proof: makeSpan(line.start, line.end, 'AMBIGUOUS_SECTION_MAKER') };
      if (curr || (structured && currencies.length === 1)) context.currency = { value: curr ? curr[1].toUpperCase() : currencies[0], proof: makeSpan(line.start, line.end, 'SECTION_CURRENCY') };
      if (structured && currencies.length > 1) context.currency = { value: null, conflict: true, proof: makeSpan(line.start, line.end, 'AMBIGUOUS_SECTION_CURRENCY') };
      if (condition) context.condition = { value: /^(?:new|brand|unworn)/i.test(condition[1]) ? 'New' : 'Used', proof: makeSpan(line.start, line.end, 'SECTION_CONDITION') };
      if (onlyIntent || (structured && li.intent && !li.conflict)) {context.intent = { value: li.intent, proof: makeSpan(line.start, line.end, 'SECTION_INTENT') };context.nonwatch_scope=null;}
      if (structured && li.conflict) context.intent = { value: null, conflict: true, proof: makeSpan(line.start, line.end, 'AMBIGUOUS_SECTION_INTENT') };
      continue;
    }
    if (refs.length) {
      const previousText = active ? view.text.slice(active.start, active.end) : '';
      const previousRefs = active ? referenceClaims(previousText, context.brand?.value || metadataMaker, raw.reference, prices(previousText,context.currency?.value)) : [];
      if (active && sameReferenceTitleRestatement(previousText,line.text,previousRefs,refs)) active.end=line.end;
      else { finish(); active = { start: line.start, end: line.end, context: { ...context } }; }
    } else if (active) active.end = line.end;
    else envelope.residuals.push({ reason: 'UNASSIGNED_SOURCE_LINE', evidence: [makeSpan(line.start, line.end, 'UNASSIGNED_SOURCE_LINE')] });
  }
  finish();
  const isChild = envelope.is_explicit_bundle || blocks.length > 1;
  const parentPackage = packagePattern.test(view.text);
  for (const [index, block] of blocks.entries()) {
    const text = view.text.slice(block.start, block.end);
    const quote = makeSpan(block.start, block.end, 'OFFER_BLOCK');
    const ev = (start, end, role) => makeSpan(block.start + start, block.start + end, role);
    const reasons = [], warnings = [], fields = {};
    const ms = makers(text), distinctMakers = [...new Set(ms.map(m => m.brand))];
    const tentativeMaker = distinctMakers.length === 1 ? distinctMakers[0] : block.context.brand?.value || metadataMaker;
    const priceFacts = prices(text, block.context.currency?.value);
    const refs = referenceClaims(text, tentativeMaker, raw.reference, priceFacts);
    const distinctRefs = [...new Set(refs.map(r => r.reference))];
    const ref = distinctRefs.length === 1 ? refs[0] : null;
    fields.reference = ref?.reference || null;
    const evidence = { reference: ref ? [ev(ref.start, ref.end, ref.rule)] : refs.map(r => ev(r.start, r.end, 'COMPETING_REFERENCE')), brand: [], intent: [], price: [] };
    evidence.excluded_reference_anchors = nonReferenceAnchors(text).map(a => ev(a.start, a.end, a.reason));
    evidence.excluded_price_roles = puritySpans(text).map(a => ev(a.start,a.end,a.reason));
    if (!ref) reasons.push(distinctRefs.length ? 'MULTIPLE_REFERENCES_IN_ONE_OFFER_BLOCK' : 'REFERENCE_NOT_ESTABLISHED');
    if (ref && !ref.recognized) reasons.push('REFERENCE_FORMAT_UNVERIFIED');
    let brand = distinctMakers.length === 1 ? distinctMakers[0] : null;
    if (distinctMakers.length > 1) reasons.push('CONFLICTING_SOURCE_MANUFACTURERS');
    if (brand) evidence.brand = ms.filter(m => m.brand === brand).map(m => ev(m.start, m.end, 'EXPLICIT_MESSAGE_MAKER'));
    if (!brand && !distinctMakers.length && block.context.brand) { brand = block.context.brand.value; evidence.brand = [block.context.brand.proof]; }
    if (!distinctMakers.length && block.context.brand?.conflict) reasons.push('CONFLICTING_SECTION_MANUFACTURERS');
    if (!brand && !distinctMakers.length && metadataMaker && ref?.catalog.some(entry => sameBrand(entry.brand, metadataMaker))) {
      brand = metadataMaker;
      evidence.brand = [{ field: 'brand', value: raw.brand, value_sha256: sha(stableJson(raw.brand)), role: 'SOURCE_METADATA_CATALOG_CORROBORATED', catalog_sha256: DEPENDENCY_HASHES.catalog, catalog_reference: ref.reference }];
    }
    if (!brand) reasons.push('MANUFACTURER_NOT_ESTABLISHED');
    if (brand && metadataMaker && !sameBrand(brand, metadataMaker)) {
      if (isChild && evidence.brand.some(e => ['EXPLICIT_MESSAGE_MAKER', 'SECTION_MAKER'].includes(e.role))) warnings.push('PARENT_METADATA_MAKER_NOT_APPLIED_TO_CHILD');
      else reasons.push('SOURCE_METADATA_MANUFACTURER_CONFLICT');
    }
    if (ref?.catalog.length && brand && !ref.catalog.some(entry => sameBrand(entry.brand, brand))) reasons.push('CATALOG_MANUFACTURER_REFERENCE_CONFLICT');
    if (brand && ref && !ref.catalog.length && !referencePatterns.some(([name, pattern]) => sameBrand(name, brand) && pattern.test(ref.reference))) reasons.push('MAKER_REFERENCE_RELATIONSHIP_UNVERIFIED');
    fields.brand = brand;
    fields.model = null;
    if (raw.model && typeof raw.model === 'string') {
      const match = new RegExp('(?<![A-Z0-9])' + escape(raw.model) + '(?![A-Z0-9])', 'i').exec(text);
      if (match) { fields.model = raw.model; evidence.model = [ev(match.index, match.index + match[0].length, 'EXPLICIT_MESSAGE_MODEL')]; }
    }
    const li = literalIntent(text);
    const metaIntent = raw.type === 'sale' ? 'WTS' : raw.type === 'search' ? 'WTB' : null;
    let intent = li.intent, tier = intent ? 'EXPLICIT_MESSAGE' : null;
    evidence.intent = li.evidence.map(item => ev(item.start, item.end, 'EXPLICIT_MESSAGE_' + item.intent));
    if (li.conflict) { intent = null; tier = null; reasons.push('CONFLICTING_MESSAGE_INTENT'); }
    else if (!intent && block.context.intent) { intent = block.context.intent.value; tier = 'EXPLICIT_SECTION'; evidence.intent = [block.context.intent.proof]; }
    const unresolvedSectionIntent = !li.intent && block.context.intent?.conflict;
    if (unresolvedSectionIntent) reasons.push('CONFLICTING_SECTION_INTENT');
    if (intent && metaIntent && intent !== metaIntent) warnings.push('SOURCE_TYPE_CONFLICT_OVERRIDDEN_BY_EXPLICIT_MESSAGE');
    if (li.intent && block.context.intent && li.intent !== block.context.intent.value) warnings.push('SECTION_INTENT_OVERRIDDEN_BY_EXPLICIT_CHILD_MESSAGE');
    const offers = priceFacts.filter(p => !['NON_ASK', 'EXPLICIT_BUDGET'].includes(p.role));
    if (!intent && !li.conflict && !unresolvedSectionIntent && metaIntent) { intent = metaIntent; tier = 'NONCONFLICTING_SOURCE_TYPE'; evidence.intent = [{ field: 'type', value: raw.type, value_sha256: sha(stableJson(raw.type)), role: tier }]; }
    if (!intent && !li.conflict && !unresolvedSectionIntent && offers.length === 1 && offers[0].role === 'EXPLICIT_ASK') { intent = 'WTS'; tier = 'CLEAR_ASKING_PRICE_INFERENCE'; evidence.intent = [ev(offers[0].start, offers[0].end, tier)]; }
    if(tier==='NONCONFLICTING_SOURCE_TYPE'&&intent==='WTB'&&block.context.availability){
      reasons.push('SOURCE_TYPE_AVAILABILITY_CONTEXT_CONFLICT');
      evidence.intent.push({...block.context.availability.proof,role:'SOURCE_TYPE_AVAILABILITY_CONTEXT_CONFLICT'});
      intent=null;tier=null;
    }
    fields.intent = intent;
    if (intent === 'WTB' && offers.some(p => p.explicit_sale_role)) reasons.push('INTENT_PRICE_ROLE_CONFLICT');
    if (!intent && !li.conflict) reasons.push('INTENT_NOT_ESTABLISHED');
    const accessoryObject=nonwatchIntentObject(text.replace(makerPattern,''));
    if(block.context.nonwatch_scope)reasons.push(block.context.nonwatch_scope.value);
    if(accessoryObject==='NONWATCH_ACCESSORY_REQUEST'){reasons.push(accessoryObject);evidence.accessory_scope=[ev(0,text.length,'NONWATCH_ACCESSORY_REQUEST')];}
    if (parentPackage) reasons.push('PACKAGE_SCOPE_OR_TOTAL_REQUIRES_REVIEW');
    if (quantityPattern.test(text)) reasons.push('QUANTITY_NOT_INDIVIDUAL_OFFER_IDENTITY');
    if (/\b(?:sell|sale)\b[\s\S]{0,20}\btrade\b|\btrade\b[\s\S]{0,20}\b(?:sell|sale)\b/i.test(text)) reasons.push('SALE_TRADE_SCOPE_REQUIRES_REVIEW');
    const category = classify({ raw_data: { description: text, brand, normalized_reference: ref?.recognized ? ref.reference : null } });
    const nonWatch = classifyNonWatch(text);
    if (category.category !== 'WATCH' || nonWatch) reasons.push(nonWatch || 'CATEGORY_' + category.category);
    if (/\b(?:dial|dials|boxes|box|straps?|bracelets?|links?)\s+(?:only|for\s+sale)\b|\b(?:selling|WTS|FS)\s+(?:a\s+)?(?:dial|dials|boxes|straps?|bracelets?|links?)\b/i.test(text)) reasons.push('NONWATCH_ACCESSORY_OFFER');
    fields.category = 'WATCH';
    fields.original_price_amount = null;
    fields.original_price_currency = null;
    fields.original_price_text = null;
    fields.original_price_role = null;
    fields.price_usd = null;
    fields.fx_rate = null;
    fields.fx_source = null;
    fields.fx_date = null;
    const priceReasons = [];
    if (intent !== 'WTS') priceReasons.push('NOT_WTS_ASKING_PRICE');
    const displayPrices = intent === 'WTB' ? priceFacts.filter(p => p.role === 'EXPLICIT_BUDGET' || p.role === 'UNLABELLED' || (p.role === 'EXPLICIT_ASK' && !p.explicit_sale_role)) : offers;
    if (!displayPrices.length) priceReasons.push(intent === 'WTB' ? 'BUDGET_NOT_ESTABLISHED' : 'ASKING_PRICE_NOT_ESTABLISHED');
    else if (displayPrices.length !== 1) priceReasons.push('MULTIPLE_PRICE_AMBIGUITY');
    else {
      const p = displayPrices[0];
      evidence.price = [ev(p.start, p.end, p.role)];
      fields.original_price_text = evidence.price[0].quote;
      fields.original_price_role = intent === 'WTB' ? 'WTB_BUDGET' : intent === 'WTS' ? 'WTS_ASK' : null;
      if (p.uses_currency_context && block.context.currency) evidence.price.push(block.context.currency.proof);
      evidence.price_numeric = p.numeric_evidence;
      if (p.review_reason) priceReasons.push(p.review_reason);
      if (!p.currency) priceReasons.push('CURRENCY_NOT_ESTABLISHED');
      if ((!p.review_reason || ['CURRENCY_AMBIGUOUS', 'CURRENCY_NOT_DETECTED'].includes(p.review_reason)) && intent) { fields.original_price_amount = p.amount; fields.original_price_currency = p.currency; }
    }
    const modification = /\b(?:aftermarket|custom(?:ized|ised)?|iced(?:\s*out)?|bust\s*down|non[- ]factory|converted|conversion|moissanite)\b/i.exec(text);
    if (modification) {
      const negated = /\b(?:not|no|without)\s*$/i.test(text.slice(Math.max(0, modification.index - 16), modification.index));
      warnings.push(negated ? 'MODIFICATION_WORDING_REQUIRES_REVIEW' : 'SOURCE_DISCLOSED_MODIFICATION');
      priceReasons.push('MODIFIED_CONFIGURATION_RESEARCH_REVIEW');
      evidence.modification = [ev(modification.index, modification.index + modification[0].length, negated ? 'MODIFICATION_WORDING_REQUIRES_REVIEW' : 'SOURCE_DISCLOSED_MODIFICATION')];
    }
    fields.condition = block.context.condition?.value || null;
    if (block.context.condition) evidence.condition = [block.context.condition.proof];
    const conditionMatch = /\b(brand\s+new|unworn|pre[- ]owned|used)\b/i.exec(text);
    if (conditionMatch) { fields.condition = /^(?:brand|unworn)/i.test(conditionMatch[0]) ? 'New' : 'Used'; evidence.condition = [ev(conditionMatch.index, conditionMatch.index + conditionMatch[0].length, 'EXPLICIT_CONDITION')]; }
    fields.year = null;
    const yearMatch = /\b(?:year|yom|dated)\s*[:=-]?\s*((?:19|20)\d{2})\b/i.exec(text);
    if (yearMatch) { fields.year = Number(yearMatch[1]); evidence.year = [ev(yearMatch.index, yearMatch.index + yearMatch[0].length, 'EXPLICIT_YEAR')]; }
    fields.dial_color = null;
    const dialMatch = /\b(black|white|blue|green|grey|gray|silver|champagne|salmon|pink|purple|brown|red)\s+dial\b|\bdial\s*[:=-]\s*(black|white|blue|green|grey|gray|silver|champagne|salmon|pink|purple|brown|red)\b/i.exec(text);
    if (dialMatch) { const value = (dialMatch[1] || dialMatch[2]).toLowerCase(); fields.dial_color = value === 'gray' ? 'Grey' : value[0].toUpperCase() + value.slice(1); evidence.dial_color = [ev(dialMatch.index, dialMatch.index + dialMatch[0].length, 'EXPLICIT_DIAL')]; }
    fields.country = null;
    if (typeof raw.country === 'string' && raw.country.trim()) { fields.country = raw.country.trim(); evidence.country = [{ field: 'country', value: raw.country, value_sha256: sha(stableJson(raw.country)), role: 'EXPLICIT_SOURCE_METADATA' }]; }
    fields.source_status = envelope.source_status;
    const tfReasons = [...new Set(reasons)];
    const c = {
      contract: CONTRACT, parser_version: PARSER_VERSION, dependency_hashes: DEPENDENCY_HASHES,
      source_system: staged.source_system, source_database: staged.source_database, source_table: staged.source_table,
      source_id: staged.source_id, source_hash: staged.source_hash, parent_source_field: field, parent_field_hash: fieldHash,
      kind: isChild ? 'CHILD' : 'SINGLE', child_index: isChild ? index + 1 : null,
      source_spans: [quote], context_spans: Object.values(block.context).filter(Boolean).map(item => item.proof),
      source_context_text: quote.quote, fields, evidence, intent_evidence_tier: tier,
      source_dates: envelope.source_dates, source_date_semantics: envelope.source_date_semantics,
      images: isChild ? emptyImages() : { policy: 'RESOLVE_EXISTING_EXACT_SOURCE_IMAGE_EVIDENCE_ONLY', source_image_keys: [raw.front_image, raw.image, raw.back_image].filter(value => typeof value === 'string' && value.length) },
      decision: { trading_floor: tfReasons.length ? 'REVIEW' : 'TF_SUPPORTED_CANDIDATE', reasons: tfReasons, warnings: [...new Set(warnings)], price_source: priceReasons.length ? 'REVIEW' : 'SOURCE_PRICE_SUPPORTED_REQUIRES_FX_AND_ADMISSION', price_reasons: [...new Set(priceReasons)], final_publication_approved: false },
    };
    const canonicalJson = stableJson(c);
    envelope.candidates.push({ candidate_hash: sha(canonicalJson), canonical_json: canonicalJson, candidate: c });
  }
  // Identical repeated source blocks in one message do not establish separate
  // units. Collapse their visible proposal while retaining every exact span.
  const unique = new Map();
  envelope.identical_blocks_collapsed = 0;
  for (const entry of envelope.candidates) {
    const c = entry.candidate;
    const key = sha(stableJson({ kind: c.kind, text: c.source_context_text, fields: c.fields, decision: c.decision }));
    const earlier = unique.get(key);
    if (c.kind !== 'CHILD' || !earlier) { unique.set(key, entry); continue; }
    earlier.candidate.source_spans.push(...c.source_spans);
    const contexts = new Map([...earlier.candidate.context_spans, ...c.context_spans].map(s => [stableJson(s), s]));
    earlier.candidate.context_spans = [...contexts.values()];
    earlier.candidate.repeated_block_policy = 'IDENTICAL_SOURCE_BLOCK_NOT_ADDITIONAL_UNIT';
    earlier.canonical_json = stableJson(earlier.candidate);
    earlier.candidate_hash = sha(earlier.canonical_json);
    envelope.identical_blocks_collapsed++;
  }
  envelope.candidates = [...unique.values()];
  // A bookmark icon alone cannot prove whether an identifier denotes stock or
  // another watch. Preserve both hypotheses, but admit neither uncertain split.
  const unresolvedTags=taggedIdentifierSpans(view.text).filter(s=>!catalogByRef.has(refKey(s.quote)));
  if(unresolvedTags.length)for(const entry of envelope.candidates){
    const c=entry.candidate;
    c.evidence.unresolved_tagged_scope=unresolvedTags.map(s=>makeSpan(s.start,s.end,s.reason));
    c.decision.reasons=[...new Set([...c.decision.reasons,'UNRESOLVED_TAGGED_IDENTIFIER_SCOPE'])];
    c.decision.trading_floor='REVIEW';
    entry.canonical_json=stableJson(c);entry.candidate_hash=sha(entry.canonical_json);
  }
  envelope.parent_outcome = blocks.length ? (envelope.candidates.some(c => c.candidate.decision.trading_floor === 'TF_SUPPORTED_CANDIDATE') ? 'HAS_SUPPORTED_CANDIDATE' : 'REVIEW') : 'REVIEW';
  if (!blocks.length) envelope.residuals.push({ reason: 'NO_SOURCE_BACKED_REFERENCE_BLOCK', evidence: [] });
  return envelope;
}

function verifyExpandedCandidate(staged, entry) {
  const rebuilt = buildExpandedCandidates(staged);
  const found = rebuilt.candidates.find(item => item.candidate_hash === entry.candidate_hash);
  if (!found || found.canonical_json !== entry.canonical_json || stableJson(entry.candidate) !== entry.canonical_json) throw new Error('EXPANDED_CANDIDATE_PROOF_MISMATCH');
  return true;
}

// Cheap inspection of already frozen proposals. Only possible extended tokens
// invoke price/reference extraction; unchanged parents need no raw-source read.
function inspectLegacyCandidateScope(candidate) {
  const issues = [], text = candidate.source_context_text || '', view = parsingView(text);
  const explicit=(candidate.evidence.intent || []).some(s=>/^EXPLICIT_MESSAGE_/.test(s.role||''));
  const possibleExtended=/(?:[12]\d{4,5}|52\d{3})[A-Z]*-\d{3,4}/i.test(view.text);
  const add=(reason,start,end,parent)=>{const a=view.starts[start],b=view.ends[end-1],quote=view.points.slice(a,b).join('');issues.push({reason,field:parent.field,field_sha256:parent.field_sha256,start:parent.start+a,end:parent.start+b,offset_unit:'UNICODE_CODEPOINT',end_exclusive:true,quote,quote_sha256:sha(quote)});};
  if(explicit||possibleExtended)for(const line of sourceLines(view.text)){
    const ms=makers(line.text),object=nonwatchIntentObject(line.text.replace(makerPattern,'')),foreign=!ms.length&&foreignCurrencyExchangeLine(line.text),stickers=nonIntentFullStickersLine(line.text);
    const extended=possibleExtended&&/(?:[12]\d{4,5}|52\d{3})[A-Z]*-\d{3,4}/i.test(line.text);
    if(!extended&&!(explicit&&(object||foreign||stickers)))continue;
    // Same exact logical-line context as the block splitter: a preceding line's
    // trailing HKD must not consume the following watch token as a price.
    const curr=candidate.context_spans?.find(s=>s.role==='SECTION_CURRENCY')?.quote;
    const facts=prices(line.text,currencyHeader.exec(curr||'')?.[1]||null),refs=referenceClaims(line.text,ms.length===1?ms[0].brand:candidate.fields?.brand,null,facts);
    for(const ref of refs.filter(r=>extendedReferenceClaim(r.reference)))for(const parent of candidate.source_spans || []){
      const start=parent.start+view.starts[line.start+ref.start],end=parent.start+view.ends[line.start+ref.end-1];
      if((candidate.evidence.reference||[]).some(s=>s.field===parent.field&&s.start===start&&s.end===end&&refKey(s.quote)===ref.reference))continue;
      add('FULL_HYPHENATED_REFERENCE_NOT_DELIMITED',line.start+ref.start,line.start+ref.end,parent);
    }
    if(explicit&&(object==='NONWATCH_ACCESSORY_REQUEST'||stickers||(!refs.length&&(foreign||object))))for(const parent of candidate.source_spans||[])add(object==='NONWATCH_ACCESSORY_REQUEST'?'NONWATCH_ACCESSORY_MESSAGE_SCOPE':foreign?'NONWATCH_CURRENCY_EXCHANGE_MESSAGE_INTENT':stickers?'FULL_STICKERS_NOT_SALE_INTENT':'NONWATCH_BUSINESS_OR_SERVICE_MESSAGE_INTENT',line.start,line.end,parent);
  }
  for (const s of candidate.context_spans || []) if (s.role === 'SECTION_INTENT') {
    const value = parsingView(s.quote).text;
    const ms=makers(value),object=nonwatchIntentObject(value.replace(makerPattern,'')),foreign=!ms.length&&foreignCurrencyExchangeLine(value),stickers=nonIntentFullStickersLine(value);
    if(object||foreign||stickers)issues.push({...s,reason:object==='NONWATCH_ACCESSORY_REQUEST'?'NONWATCH_ACCESSORY_SECTION_SCOPE':foreign?'NONWATCH_CURRENCY_EXCHANGE_SECTION_INTENT':stickers?'FULL_STICKERS_NOT_SALE_INTENT':'NONWATCH_BUSINESS_OR_SERVICE_SECTION_INTENT'});
  }
  return issues;
}

module.exports = { CONTRACT, PARSER_VERSION, DEPENDENCY_HASHES, buildExpandedCandidates, verifyExpandedCandidate, parsingView, literalIntent, inspectLegacyCandidateScope, referenceClaims, prices, sourceLines };
