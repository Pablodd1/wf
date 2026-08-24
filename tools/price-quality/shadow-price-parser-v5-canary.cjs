'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const {
  extractPriceCandidates,
  extractPriceObservations,
  segmentDealerMessage,
} = require('../../api/_lib/normalization-v4.cjs');

const BASELINE_SHA = '0f8888317e13e056248b8de2a89252fd61383ea7';
const INPUT = 'public/parsedWatches.json';
const OUTPUT = process.env.PRICE_PARSER_CANARY_OUTPUT
  || 'audit-output/phase2-price-parser-canary.json';

function loadBaselineParser() {
  const source = execFileSync('git', ['show', `${BASELINE_SHA}:api/_lib/normalization-v4.cjs`], {
    encoding: 'utf8',
    maxBuffer: 5_000_000,
  });
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require, console });
  new vm.Script(source, { filename: `${BASELINE_SHA}:normalization-v4.cjs` }).runInContext(context);
  return module.exports;
}

const aliases = [
  ['USDT', 'USDT'], ['USD', 'USD'], ['US\\$', 'USD'], ['U\\$', 'USD'],
  ['HKD', 'HKD'], ['HDK', 'HKD'], ['HKN', 'HKD'], ['HNK', 'HKD'], ['HK\\$', 'HKD'], ['H\\.?K\\.?D\\.?', 'HKD'], ['港币', 'HKD'], ['港幣', 'HKD'],
  ['EUR', 'EUR'], ['€', 'EUR'], ['💶', 'EUR'], ['GBP', 'GBP'], ['£', 'GBP'], ['CHF', 'CHF'],
  ['SGD', 'SGD'], ['S\\$', 'SGD'], ['AED', 'AED'], ['DHS', 'AED'], ['DH', 'AED'], ['SAR', 'SAR'],
  ['CNY', 'CNY'], ['RMB', 'CNY'], ['CN[¥￥]', 'CNY'], ['JPY', 'JPY'], ['JP[¥￥]', 'JPY'],
  ['KRW', 'KRW'], ['₩', 'KRW'], ['THB', 'THB'], ['฿', 'THB'], ['CAD', 'CAD'], ['C\\$', 'CAD'],
  ['AUD', 'AUD'], ['A\\$', 'AUD'], ['NZD', 'NZD'], ['NZ\\$', 'NZD'], ['MYR', 'MYR'], ['RM(?!\\d)', 'MYR'],
  ['IDR', 'IDR'], ['RP', 'IDR'], ['INR', 'INR'], ['₹', 'INR'], ['PHP', 'PHP'], ['₱', 'PHP'],
  ['TWD', 'TWD'], ['NT\\$', 'TWD'], ['VND', 'VND'], ['₫', 'VND'], ['BRL', 'BRL'], ['R\\$', 'BRL'],
  ['MXN', 'MXN'], ['ZAR', 'ZAR'], ['SEK', 'SEK'], ['NOK', 'NOK'], ['DKK', 'DKK'],
];
const currencyToken = aliases.map(([pattern]) => pattern).join('|');
const numberToken = '(\\d[\\d.,]*)(?:[ \\t]*(million|mill|mil|mn|k|m|w|万))?';
const prefixPattern = new RegExp(`(?<![A-Za-z])(${currencyToken})[ \\t]*[:=]?[ \\t]*${numberToken}`, 'giu');
const suffixPattern = new RegExp(`(?<![A-Za-z0-9])${numberToken}[ \\t]*(${currencyToken})(?![A-Za-z])`, 'giu');

function normalizeCurrency(raw) {
  for (const [pattern, currency] of aliases) {
    if (new RegExp(`^(?:${pattern})$`, 'iu').test(raw)) return currency;
  }
  return null;
}

function parseIndependent(raw, scale = '') {
  let value = String(raw).trim().replace(/\s/g, '');
  const multiplier = String(scale || '').toLowerCase();
  if (/^\d{1,3}(?:[.,]\d{3}){1,}$/.test(value) && !multiplier) value = value.replace(/[.,]/g, '');
  else if (multiplier && /^\d+,\d{1,2}$/.test(value)) value = value.replace(',', '.');
  else if (/^\d{1,3}(?:,\d{3})+$/.test(value)) value = value.replace(/,/g, '');
  else if (!multiplier && /^\d{1,3}(?:\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  else value = value.replace(/,/g, '');
  const parsed = Number(value);
  const factor = ({ k: 1e3, mil: 1e3, m: 1e6, mn: 1e6, mill: 1e6, million: 1e6, w: 1e4, '万': 1e4 })[multiplier] || 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed * factor : null;
}

function explicitPairs(text) {
  const found = [];
  for (const match of String(text || '').matchAll(prefixPattern)) {
    const currency = normalizeCurrency(match[1]);
    const scale = /^(?:w|万)$/iu.test(match[3] || '') && /[.,]/.test(match[2]) ? '' : (match[3] || '');
    const amount = parseIndependent(match[2], scale);
    if (currency && amount) found.push({ currency, amount, alias: match[1], rawNumber: match[2], scale, direction: 'PREFIX', raw: match[0], index: match.index, end: match.index + match[0].length });
  }
  for (const match of String(text || '').matchAll(suffixPattern)) {
    const currency = normalizeCurrency(match[3]);
    const scale = /^(?:w|万)$/iu.test(match[2] || '') && /[.,]/.test(match[1]) ? '' : (match[2] || '');
    const amount = parseIndependent(match[1], scale);
    if (currency && amount) found.push({ currency, amount, alias: match[3], rawNumber: match[1], scale, direction: 'SUFFIX', raw: match[0], index: match.index, end: match.index + match[0].length });
  }
  const rejected = new Set(found.filter(pair => {
    const base = parseIndependent(pair.rawNumber, '');
    const explicitSymbol = /^(?:€|£|💶|HK\$|US\$|U\$|S\$|C\$|A\$|NZ\$|NT\$|R\$)$/iu.test(pair.alias);
    return !pair.scale && base >= 1900 && base <= 2099 && !explicitSymbol;
  }));
  for (const pair of found) {
    if (!pair.scale && pair.amount <= 31 && found.some(other => other !== pair && other.currency === pair.currency && other.amount >= 1000)) rejected.add(pair);
    if (pair.direction === 'PREFIX' && String(text).slice(pair.end).startsWith('/')) rejected.add(pair);
    if (pair.direction === 'SUFFIX' && String(text).slice(Math.max(0, pair.index - 1), pair.index) === '/') rejected.add(pair);
  }
  for (const suffixPair of found.filter(pair => pair.direction === 'SUFFIX')) {
    const prefixPair = found.find(pair => pair.direction === 'PREFIX' && pair.currency === suffixPair.currency && pair.index >= suffixPair.index && pair.index < suffixPair.end);
    if (!prefixPair) continue;
    const trailingPair = found.some(pair => pair !== suffixPair && pair.direction === 'SUFFIX' && pair.currency !== prefixPair.currency && pair.amount === prefixPair.amount && pair.index > prefixPair.index && pair.index < prefixPair.end);
    const yearLike = suffixPair.amount >= 1900 && suffixPair.amount <= 2099;
    const scaled = Boolean(suffixPair.scale) || /[.,]\d{3}/.test(suffixPair.rawNumber) || (suffixPair.amount >= 10_000 && !yearLike);
    rejected.add(trailingPair && scaled ? prefixPair : suffixPair);
  }
  const unique = new Map();
  for (const pair of found) if (!rejected.has(pair)) unique.set(`${pair.index}|${pair.currency}|${pair.amount}`, pair);
  return [...unique.values()].sort((a, b) => a.index - b.index);
}

function matches(pair, observations) {
  return observations.some(item => item.currency_original === pair.currency && Math.abs(Number(item.amount_original) - pair.amount) < 0.5);
}

function oldFailure(pair, pairCount, segmentCount) {
  if (pairCount > 1 && segmentCount > 1) return 'BUNDLE_PRICE_AMBIGUITY';
  if (pairCount > 1) return 'MULTIPLE_PRICE_AMBIGUITY';
  if (/^m$/i.test(pair.scale)) return 'M_NOTATION_UNSUPPORTED';
  if (/^k$/i.test(pair.scale)) return 'K_NOTATION_UNSUPPORTED';
  return 'CURRENCY_NOT_DETECTED';
}

function bump(map, key, value = 1) {
  map[key] = (map[key] || 0) + value;
}

function classifyGap(entry, pairs, candidates, observations) {
  const reasons = new Set(candidates.map(item => item.review_reason).filter(Boolean));
  if (reasons.has('BUNDLE_PRICE_AMBIGUITY') || segmentDealerMessage(entry.text).length > 1) return 'BUNDLE_DEFERRED';
  if (reasons.has('MULTIPLE_PRICE_AMBIGUITY')) return 'MULTIPLE_PRICE_REVIEW';
  if (entry.rows.every(row => !String(row[2] || '').trim())) return 'REFERENCE_UNRESOLVED';
  if (pairs.some(pair => ['AED', 'SAR', 'TWD', 'VND'].includes(pair.currency))) return 'CURRENCY_POLICY';
  if (pairs.every(pair => matches(pair, observations))) return 'NORMALIZATION_SKIPPED';
  if (pairs.some(pair => matches(pair, candidates))) return 'PARSER_VERSION_DRIFT';
  return 'OTHER';
}

const baseline = loadBaselineParser();
const inputBuffer = fs.readFileSync(INPUT);
const rows = JSON.parse(inputBuffer);
const messages = new Map();
for (const row of rows) {
  const text = String(row[8] || '').trim();
  if (!text) continue;
  const entry = messages.get(text) || { text, rows: [] };
  entry.rows.push(row);
  messages.set(text, entry);
}

const missed = [];
const gaps = [];
const controls = [];
for (const entry of messages.values()) {
  const pairs = explicitPairs(entry.text);
  if (!pairs.length) continue;
  const old = baseline.extractPriceObservations(entry.text, {});
  const normalized = entry.rows.some(row => Number(row[5]) > 0 && String(row[6] || '').trim());
  const allOld = pairs.every(pair => matches(pair, old));
  if (!allOld) missed.push({ ...entry, pairs, old });
  else if (!normalized) gaps.push({ ...entry, pairs, old });
  else if (controls.length < 250 && pairs.length === 1 && segmentDealerMessage(entry.text).length <= 1) controls.push({ ...entry, pairs, old });
}

if (missed.length !== 94 || gaps.length !== 665 || controls.length < 200) {
  throw new Error(`Phase 1 cohort drift: missed=${missed.length}, gaps=${gaps.length}, controls=${controls.length}`);
}

const cohort = [...missed, ...gaps, ...controls];
function summarize(entries) {
  const result = { messages: entries.length, explicitPairs: 0, oldRecognizedPairs: 0, newCandidateRecognizedPairs: 0, newAutoApprovedPairs: 0 };
  for (const entry of entries) {
    const candidates = extractPriceCandidates(entry.text, {});
    const observations = extractPriceObservations(entry.text, {});
    result.explicitPairs += entry.pairs.length;
    result.oldRecognizedPairs += entry.pairs.filter(pair => matches(pair, entry.old)).length;
    result.newCandidateRecognizedPairs += entry.pairs.filter(pair => matches(pair, candidates)).length;
    result.newAutoApprovedPairs += entry.pairs.filter(pair => matches(pair, observations)).length;
  }
  return result;
}
const metrics = {
  messages: cohort.length,
  explicitPairs: 0,
  oldRecognizedPairs: 0,
  newCandidateRecognizedPairs: 0,
  newAutoApprovedPairs: 0,
  oldAutoApprovedPrices: 0,
  newAutoApprovedPrices: 0,
  newReviewOnlyCandidates: 0,
  multiplePriceAmbiguitiesPreserved: 0,
  bundleAmbiguitiesPreserved: 0,
};
for (const entry of cohort) {
  const candidates = extractPriceCandidates(entry.text, {});
  const observations = extractPriceObservations(entry.text, {});
  metrics.explicitPairs += entry.pairs.length;
  metrics.oldRecognizedPairs += entry.pairs.filter(pair => matches(pair, entry.old)).length;
  metrics.newCandidateRecognizedPairs += entry.pairs.filter(pair => matches(pair, candidates)).length;
  metrics.newAutoApprovedPairs += entry.pairs.filter(pair => matches(pair, observations)).length;
  metrics.oldAutoApprovedPrices += entry.old.length;
  metrics.newAutoApprovedPrices += observations.length;
  metrics.newReviewOnlyCandidates += candidates.filter(item => item.review_required).length;
  if (candidates.some(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY')) metrics.multiplePriceAmbiguitiesPreserved += 1;
  if (candidates.some(item => item.review_reason === 'BUNDLE_PRICE_AMBIGUITY')) metrics.bundleAmbiguitiesPreserved += 1;
}

const recoveryByOldFailure = {};
for (const entry of missed) {
  const candidates = extractPriceCandidates(entry.text, {});
  const observations = extractPriceObservations(entry.text, {});
  const segmentCount = segmentDealerMessage(entry.text).length;
  for (const pair of entry.pairs.filter(pair => !matches(pair, entry.old))) {
    const category = oldFailure(pair, entry.pairs.length, segmentCount);
    recoveryByOldFailure[category] ||= { baselineMissed: 0, autoApproved: 0, reviewOnly: 0, stillMissed: 0 };
    recoveryByOldFailure[category].baselineMissed += 1;
    if (matches(pair, observations)) recoveryByOldFailure[category].autoApproved += 1;
    else if (matches(pair, candidates)) recoveryByOldFailure[category].reviewOnly += 1;
    else recoveryByOldFailure[category].stillMissed += 1;
  }
}

const gapCauses = {};
for (const entry of gaps) {
  const candidates = extractPriceCandidates(entry.text, {});
  const observations = extractPriceObservations(entry.text, {});
  bump(gapCauses, classifyGap(entry, entry.pairs, candidates, observations));
}

const adversarial = [
  ['ROLEX_REFERENCE', 'Rolex 126500LN'], ['ROLEX_REFERENCE_NUMERIC', 'Rolex 116688'],
  ['AP_REFERENCE', 'Audemars Piguet 15500ST'], ['AP_REFERENCE_WITH_YEAR', 'AP 26574OR 2024'],
  ['RM_REFERENCE', 'RM11-03'], ['RM_REFERENCE_SPACED', 'RM 67-01'],
  ['PATEK_REFERENCE', 'Patek 5712/1A'], ['PATEK_REFERENCE_WITH_YEAR', 'Patek 5167A 2022'],
  ['YEAR', 'Watch dated 2025'], ['DATE', 'Posted 08/24/2026'],
  ['PHONE_INTL', 'Call +852 91234567'], ['PHONE_US', 'Call +1 305 555 0199'],
  ['QUANTITY', 'Limited edition 500 pieces'], ['DEALER_ID', 'Dealer ID 500000'],
  ['STOCK_ID', 'Stock #87351'], ['SERIAL', 'Serial 12345678'],
  ['DIMENSION', 'Case size 42mm'], ['WEIGHT', 'Weight 85g'],
  ['PRICE_ON_REQUEST', 'Rolex 126500LN price on request'], ['REFERENCE_AND_ID', 'Ref 5711/1A ID 123456'],
  ['CURRENCYLESS_NUMBER', 'Rolex 116688 37000'], ['CURRENCYLESS_K', 'Rolex Daytona 126508 85k'],
  ['BARE_DOLLAR', 'Rolex 126500LN $28,000'], ['BARE_YEN', 'Rolex 126500LN ¥200k'],
  ['HK_SHORTHAND_PREFIX', 'Rolex 126500LN HK 115'], ['HK_SHORTHAND_SUFFIX', 'Rolex 126500LN 115 / HK'],
].map(([category, text]) => ({
  category,
  oldAutoApproved: baseline.extractPriceObservations(text, {}).length,
  newAutoApproved: extractPriceObservations(text, {}).length,
  newReviewOnly: extractPriceCandidates(text, {}).filter(item => item.review_required).length,
}));

const result = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  baselineSha: BASELINE_SHA,
  input: {
    path: INPUT,
    rows: rows.length,
    uniqueRawMessages: messages.size,
    sha256: crypto.createHash('sha256').update(inputBuffer).digest('hex'),
  },
  cohorts: { parserMissMessages: missed.length, normalizationGapMessages: gaps.length, knownGoodControls: controls.length, adversarialCases: adversarial.length },
  cohortMetrics: { parserMisses: summarize(missed), normalizationGaps: summarize(gaps), knownGoodControls: summarize(controls) },
  metrics,
  falsePositives: {
    old: adversarial.filter(item => item.oldAutoApproved > 0).length,
    new: adversarial.filter(item => item.newAutoApproved > 0).length,
    cases: adversarial,
  },
  missedPairRecovery: recoveryByOldFailure,
  normalizationGapCauses: gapCauses,
  limitations: [
    'Static export has no live release-gate or Price Research qualification state.',
    'Normalization-gap causes are deterministic local classifications, not production lineage proof.',
    'No production system was contacted and no listing value was written.',
  ],
};

fs.mkdirSync(require('node:path').dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
