#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_BRANDS = new Set(['Cartier', 'Zenith']);
const VERSION = 'cartier-zenith-missing-field-manifest-v1';
const DEFAULT_BASE_URL = 'https://watchfacts-poc.vercel.app';
const DIALS = [
  'mother of pearl', 'champagne', 'skeleton', 'salmon', 'silver', 'black', 'white',
  'blue', 'green', 'grey', 'gray', 'pink', 'red', 'brown', 'purple',
];

function clean(value) {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim();
  return output || null;
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteAt(raw, index, length) {
  const source = String(raw || '');
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + length + 60);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

function normalizedReference(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function catalogForBrand(entries, brand) {
  return (entries || []).filter(entry => entry?.brand === brand && clean(entry.reference));
}

function uniqueCatalogReferenceInRaw(raw, entries) {
  const matches = [];
  for (const entry of entries) {
    const expression = new RegExp(`(?<![A-Z0-9])${escapeRegExp(entry.reference)}(?![A-Z0-9])`, 'i');
    const match = expression.exec(raw);
    if (match) matches.push({ value: entry.reference, match });
  }
  const unique = [...new Map(matches.map(item => [normalizedReference(item.value), item])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function uniqueCatalogModelForReference(reference, entries) {
  const key = normalizedReference(reference);
  if (!key) return null;
  const models = [...new Set(entries
    .filter(entry => normalizedReference(entry.reference) === key)
    .map(entry => clean(entry.model))
    .filter(Boolean))];
  return models.length === 1 ? models[0] : null;
}

function uniqueModelInRaw(raw, entries) {
  const models = [...new Set(entries.map(entry => clean(entry.model)).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const matches = [];
  for (const model of models) {
    const expression = new RegExp(`(?<![A-Z0-9])${escapeRegExp(model)}(?![A-Z0-9])`, 'i');
    const match = expression.exec(raw);
    if (match) matches.push({ value: model, match });
  }
  // A longer exact catalog label subsumes its shorter family name.
  const maximal = matches.filter(candidate => !matches.some(other => (
    other !== candidate
    && other.value.length > candidate.value.length
    && other.value.toLowerCase().includes(candidate.value.toLowerCase())
    && other.match.index === candidate.match.index
  )));
  return maximal.length === 1 ? maximal[0] : null;
}

function explicitDialInRaw(raw) {
  const matches = [];
  for (const color of DIALS) {
    const expression = new RegExp(`(?:\\b${escapeRegExp(color)}\\s+dial\\b|\\bdial\\s*[:=-]?\\s*${escapeRegExp(color)}\\b)`, 'i');
    const match = expression.exec(raw);
    if (match) matches.push({ value: color === 'gray' ? 'Grey' : color.replace(/\b\w/g, letter => letter.toUpperCase()), match });
  }
  const unique = [...new Map(matches.map(item => [item.value.toLowerCase(), item])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function explicitConditionInRaw(raw) {
  const rules = [
    { value: 'Used - Like New', expression: /\blike[- ]?new\b(?!\s+(?:strap|band|bracelet|box|card|dial))/i },
    { value: 'New', expression: /\b(?:brand[- ]?new|unworn)\b(?!\s+(?:strap|band|bracelet|box|card|dial))/i },
    { value: 'New', expression: /\bconditions?\s*[:=-]\s*new\b/i },
    { value: 'Used', expression: /\bpre[- ]?owned\b/i },
    { value: 'Used', expression: /\bconditions?\s*[:=-]?\s*used\b(?!\s+(?:strap|band|bracelet|box|card|dial))/i },
    { value: 'Used', expression: /(?:^|[\r\n])\s*used(?:\s+\d{4})?\s*(?:$|[\r\n])/im },
  ];
  const matches = rules.map(rule => ({ ...rule, match: rule.expression.exec(raw) })).filter(rule => rule.match);
  // "Like new" and "pre-owned" may coexist; the more specific condition wins.
  if (matches.some(item => item.value === 'Used - Like New')) {
    return matches.find(item => item.value === 'Used - Like New');
  }
  const values = [...new Set(matches.map(item => item.value))];
  return values.length === 1 ? matches[0] : null;
}

function parseAmount(numberText, hasK) {
  const value = Number(String(numberText).replaceAll(',', ''));
  const expanded = hasK ? value * 1_000 : value;
  const year = Number.isInteger(expanded) && expanded >= 1900 && expanded <= new Date().getUTCFullYear() + 2;
  return Number.isFinite(expanded) && expanded >= 1_000 && !year ? expanded : null;
}

function singlePrice(raw, expression) {
  const matches = [...String(raw || '').matchAll(expression)]
    .map(match => ({
      value: parseAmount(match.groups?.amount, Boolean(match.groups?.k)),
      match,
    }))
    .filter(item => item.value !== null);
  const values = [...new Set(matches.map(item => item.value))];
  return values.length === 1 ? matches.find(item => item.value === values[0]) : null;
}

function isRetailOnlyPrice(raw, evidence) {
  if (!evidence) return false;
  const prefix = String(raw || '').slice(Math.max(0, evidence.match.index - 30), evidence.match.index);
  return /\b(?:retail|msrp|rrp|list\s*price)\s*[:=-]?\s*$/i.test(prefix);
}

function explicitUsdPriceInRaw(raw) {
  const evidence = singlePrice(raw, /(?:\b(?:USD|USDT)\s*[$:]?\s*(?<amount>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{4,8}(?:\.\d{1,2})?)(?<k>[kK])?\b|\b(?<amount>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{4,8}(?:\.\d{1,2})?)(?<k>[kK])?\s*(?:USD|USDT)\b)/gi);
  return isRetailOnlyPrice(raw, evidence) ? null : evidence;
}

function ownerAssumedDollarPriceInRaw(raw) {
  if (/\b(?:USD|USDT)\b/i.test(raw)) return null;
  const evidence = singlePrice(raw, /(?<![A-Za-z])\$\s*(?<amount>\d{1,8}(?:,\d{3})*(?:\.\d{1,2})?)(?<k>[kK])?(?![A-Za-z0-9])/g);
  return isRetailOnlyPrice(raw, evidence) ? null : evidence;
}

function correction(record, field, proposedValue, evidence, reason, extra = {}) {
  const raw = String(record.raw_message || '');
  return {
    listing_id: String(record.id),
    brand: record.brand,
    field,
    current_value: null,
    proposed_value: proposedValue,
    raw_message_sha256: sha256(raw),
    evidence_quote: quoteAt(raw, evidence.match.index, evidence.match[0].length),
    reason,
    ...extra,
  };
}

function buildCorrectionManifest(records, catalogEntries) {
  const corrections = [];
  const ownerPolicyTrackedOnly = [];
  const blockers = [];
  for (const record of records || []) {
    if (!ALLOWED_BRANDS.has(record?.brand) || !record?.id || !clean(record.raw_message)) continue;
    const raw = String(record.raw_message);
    const catalog = catalogForBrand(catalogEntries, record.brand);

    if (isBlank(record.reference)) {
      const evidence = uniqueCatalogReferenceInRaw(raw, catalog);
      if (evidence) corrections.push(correction(record, 'reference', evidence.value, evidence,
        'EXACT_SINGLE_CATALOG_REFERENCE_IN_IMMUTABLE_RAW'));
      else blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'reference', reason: 'NO_UNIQUE_EXACT_REFERENCE_IN_RAW' });
    }
    if (isBlank(record.model)) {
      const catalogModel = uniqueCatalogModelForReference(record.reference, catalog);
      const evidence = uniqueModelInRaw(raw, catalog);
      if (catalogModel && clean(record.reference)) {
        const referenceMatch = new RegExp(escapeRegExp(record.reference), 'i').exec(raw);
        if (referenceMatch) corrections.push(correction(record, 'model', catalogModel,
          { match: referenceMatch }, 'EXACT_RAW_REFERENCE_HAS_ONE_CANONICAL_CATALOG_MODEL'));
      } else if (evidence) corrections.push(correction(record, 'model', evidence.value, evidence,
        'EXACT_SINGLE_CANONICAL_MODEL_IN_IMMUTABLE_RAW'));
      else blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'model', reason: 'NO_UNIQUE_RAW_OR_REFERENCE_MODEL_EVIDENCE' });
    }
    if (isBlank(record.dial_color)) {
      const evidence = explicitDialInRaw(raw);
      if (evidence) corrections.push(correction(record, 'dial_color', evidence.value, evidence,
        'EXPLICIT_DIAL_PHRASE_IN_IMMUTABLE_RAW'));
      else blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'dial_color', reason: 'NO_EXPLICIT_UNAMBIGUOUS_DIAL_PHRASE' });
    }
    if (isBlank(record.condition)) {
      const evidence = explicitConditionInRaw(raw);
      if (evidence) corrections.push(correction(record, 'condition', evidence.value, evidence,
        'EXPLICIT_CONDITION_PHRASE_IN_IMMUTABLE_RAW'));
      else blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'condition', reason: 'NO_EXPLICIT_UNAMBIGUOUS_CONDITION_PHRASE' });
    }
    if (record.listing_type === 'WTS' && isBlank(record.price_usd)) {
      const explicit = explicitUsdPriceInRaw(raw);
      const assumed = ownerAssumedDollarPriceInRaw(raw);
      if (explicit) corrections.push(correction(record, 'price_usd', explicit.value, explicit,
        'ONE_EXPLICIT_USD_OR_USDT_AMOUNT_IN_IMMUTABLE_RAW', {
          price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
          analytics_admission: 'REQUIRES_INDEPENDENT_QUALIFICATION',
        }));
      else if (assumed) ownerPolicyTrackedOnly.push(correction(record, 'price_usd', assumed.value, assumed,
        'ONE_BARE_DOLLAR_AMOUNT_OWNER_POLICY_TRACKED_ONLY', {
          price_evidence_status: 'OWNER_ASSUMED_USD',
          analytics_admission: 'TRACKED_ONLY_NOT_INDEPENDENTLY_QUALIFIED',
        }));
      else blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'price_usd', reason: 'NO_SINGLE_SUPPORTED_USD_PRICE_AMOUNT' });
    }
    if (!record.has_images && isBlank(record.thumbnail_url)) {
      blockers.push({ listing_id: String(record.id), brand: record.brand, field: 'thumbnail_url', reason: 'NO_EXACT_ATTACHMENT_LEDGER_LINK' });
    }
    if (record.seller_rating_evidence_status === 'UNAVAILABLE') {
      blockers.push({
        listing_id: String(record.id),
        brand: record.brand,
        field: 'dealer_link',
        reason: 'NO_EXACT_PUBLIC_SOURCE_IDENTITY_DEALER_LINK',
      });
    }
  }
  const sort = (left, right) => `${left.listing_id}:${left.field}`.localeCompare(`${right.listing_id}:${right.field}`);
  corrections.sort(sort);
  ownerPolicyTrackedOnly.sort(sort);
  blockers.sort(sort);
  return {
    version: VERSION,
    scope: [...ALLOWED_BRANDS],
    input_rows: (records || []).length,
    corrections,
    owner_policy_tracked_only: ownerPolicyTrackedOnly,
    blockers,
    counts: {
      corrections: corrections.length,
      owner_policy_tracked_only: ownerPolicyTrackedOnly.length,
      blockers: blockers.length,
      by_brand_field: [...corrections, ...ownerPolicyTrackedOnly].reduce((out, item) => {
        const key = `${item.brand}:${item.field}:${item.price_evidence_status || 'STRUCTURED'}`;
        out[key] = (out[key] || 0) + 1;
        return out;
      }, {}),
    },
  };
}

async function fetchBrand(baseUrl, brand) {
  const records = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 2_000; page += 1) {
    const query = new URLSearchParams({ brand, pageSize: '100', pagination: 'cursor' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${baseUrl}/api/reviewed-market-inventory?${query}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`${brand} inventory returned HTTP ${response.status}`);
    const payload = await response.json();
    for (const record of payload.records || []) {
      if (record?.id && !seen.has(record.id)) {
        seen.add(record.id);
        records.push(record);
      }
    }
    if (!payload.hasMore || !payload.nextCursor) return records;
    cursor = payload.nextCursor;
  }
  throw new Error(`${brand} cursor did not terminate within 2,000 pages`);
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
  const baseIndex = process.argv.indexOf('--base-url');
  const baseUrl = baseIndex >= 0 ? process.argv[baseIndex + 1] : DEFAULT_BASE_URL;
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'catalog-source-v1.json'), 'utf8'));
  const records = (await Promise.all([...ALLOWED_BRANDS].map(brand => fetchBrand(baseUrl, brand)))).flat();
  const manifest = {
    generated_at: new Date().toISOString(),
    source: `${baseUrl}/api/reviewed-market-inventory`,
    ...buildCorrectionManifest(records, catalog.entries || []),
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serialized, 'utf8');
  } else process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCorrectionManifest,
  explicitConditionInRaw,
  explicitDialInRaw,
  explicitUsdPriceInRaw,
  ownerAssumedDollarPriceInRaw,
  sha256,
};
