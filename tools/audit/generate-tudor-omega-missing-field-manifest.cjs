#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ORIGIN = 'https://watchfacts-poc.vercel.app';
const ALLOWED_BRANDS = new Set(['Omega', 'Tudor']);

const MODEL_RULES = {
  Omega: [
    ['Speedmaster', /\bspeedmaster\b/i],
    ['Seamaster', /\bseamaster\b/i],
    ['Constellation', /\bconstellation\b/i],
    ['De Ville', /\bde[ -]?ville\b/i],
  ],
  Tudor: [
    ['Black Bay Fifty-Eight', /\bblack[ -]?bay\s+(?:fifty[ -]?eight|58)\b/i],
    ['Black Bay Chrono', /\bblack[ -]?bay\s+chrono(?:graph)?\b/i],
    ['Black Bay GMT', /\bblack[ -]?bay\s+gmt\b/i],
    ['Black Bay', /\bblack[ -]?bay\b/i],
    ['Pelagos', /\bpelagos\b/i],
    ['Ranger', /\branger\b/i],
    ['Royal', /\b(?:tudor\s+)?royal\b/i],
    ['1926', /\b1926\b/i],
    ['Heritage', /\bheritage\b/i],
    ['Glamour', /\bglamour\b/i],
    ['North Flag', /\bnorth[ -]?flag\b/i],
    ['Clair de Rose', /\bclair[ -]?de[ -]?rose\b/i],
  ],
};

const CONDITION_RULES = [
  ['New', /\b(?:brand[ -]?new|bnib|unworn|factory fresh)\b/i],
  ['Used - Like New', /\b(?:like[ -]?new|near[ -]?mint|mint condition)\b/i],
  ['Used', /\b(?:pre[ -]?owned|used|worn)\b(?!\s+(?:strap|band|bracelet|box|card|dial))/i],
];

const COLOR = 'black|blue|white|green|red|yellow|pink|salmon|grey|gray|silver|gold|brown|chocolate|champagne|ivory|cream|purple|orange|turquoise|mother[ -]?of[ -]?pearl|mop';
const DIAL_RULES = [
  new RegExp(`\\b(${COLOR})\\s+(?:sunburst\\s+|guilloch[eé]\\s+)?(?:dial|face)\\b`, 'i'),
  new RegExp(`\\b(?:dial|face)\\s*[:=-]?\\s*(${COLOR})\\b`, 'i'),
];

const OMEGA_REFERENCE = /\b(?:\d{3}(?:\.\d{2}){4}\.\d{3}|\d{4}\.\d{2}\.\d{2})\b/g;
const EXPLICIT_USD = /\b(USD|USDT)\s*[$:]?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?)(?:\s*([kKmM]))?\b/g;
const BARE_DOLLAR = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?)(?:\s*([kKmM]))?\b/g;
const FOREIGN_CURRENCY = /(?:\b(?:HKD|HK\$|EUR|GBP|CHF|AED|SGD|CAD|AUD|JPY|CNY|RMB)\b|[€£¥])/i;
const COMPETING_PRICE_CONTEXT = /\b(?:msrp|retail(?: price)?|list price)\b/i;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function comparisonKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function quote(raw, match) {
  const start = Math.max(0, match.index - 35);
  const end = Math.min(raw.length, match.index + match[0].length + 35);
  return raw.slice(start, end).replace(/\s+/g, ' ').trim();
}

function matches(regex, raw) {
  regex.lastIndex = 0;
  return [...raw.matchAll(regex)];
}

function amount(match, amountIndex, multiplierIndex) {
  let value = Number(String(match[amountIndex]).replaceAll(',', ''));
  const multiplier = String(match[multiplierIndex] || '').toLowerCase();
  if (multiplier === 'k') value *= 1_000;
  if (multiplier === 'm') value *= 1_000_000;
  return value;
}

function baseProposal(record, field, proposedValue, match, rule, reason) {
  const raw = String(record.raw_message || '');
  return {
    listing_id: String(record.id),
    source_record_id: record.source_record_id ? String(record.source_record_id) : null,
    brand: String(record.brand),
    reference: record.reference ? String(record.reference) : null,
    field,
    current_value: null,
    proposed_value: proposedValue,
    raw_message_sha256: sha256(raw),
    evidence_quote: quote(raw, match),
    rule,
    reason,
    confidence: 'DETERMINISTIC_EXACT_RAW',
  };
}

function isMissingModel(record) {
  return !record.model || record.model === record.brand || record.model === 'Reference-only listings';
}

function priceMissing(record) {
  return record.listing_type === 'WTS' && !Number(record.price_raw || 0) && !Number(record.price_usd || 0);
}

function proposalsForRecord(record) {
  if (!ALLOWED_BRANDS.has(record.brand)) return { proposals: [], blocked: [] };
  const raw = String(record.raw_message || '');
  if (!raw || !record.id) return { proposals: [], blocked: [] };
  const proposals = [];
  const blocked = [];

  if (isMissingModel(record)) {
    const matchedModels = MODEL_RULES[record.brand]
      .map(([value, regex]) => ({ value, match: regex.exec(raw) }))
      .filter(candidate => candidate.match);
    const maximalModels = matchedModels.filter(candidate => !matchedModels.some(other => (
      other !== candidate
      && other.value.length > candidate.value.length
      && other.value.toLowerCase().includes(candidate.value.toLowerCase())
      && other.match.index === candidate.match.index
    )));
    const distinctModels = [...new Set(maximalModels.map(candidate => candidate.value))];
    if (distinctModels.length === 1) {
      const winner = maximalModels[0];
      proposals.push(baseProposal(record, 'model', winner.value, winner.match,
        `${record.brand.toUpperCase()}_EXPLICIT_COLLECTION_V1`,
        'The missing model is explicitly named in this listing raw message.'));
    } else if (distinctModels.length > 1) {
      blocked.push({ listing_id: String(record.id), field: 'model', reason: 'MULTIPLE_MODEL_FAMILIES_IN_RAW' });
    }
  }

  if (!record.reference && record.brand === 'Omega') {
    const referenceMatches = matches(OMEGA_REFERENCE, raw);
    const unique = [...new Map(referenceMatches.map(match => [comparisonKey(match[0]), match])).values()];
    if (unique.length === 1) {
      proposals.push(baseProposal(record, 'reference', unique[0][0], unique[0],
        'OMEGA_SINGLE_EXACT_RAW_REFERENCE_V1',
        'The blank reference has one exact Omega-formatted reference in the same raw message.'));
    } else if (unique.length > 1) {
      blocked.push({ listing_id: String(record.id), field: 'reference', reason: 'MULTIPLE_OMEGA_REFERENCES_IN_RAW' });
    }
  }

  if (!record.dial_color) {
    const dialMatches = DIAL_RULES.map(regex => regex.exec(raw)).filter(Boolean);
    const values = [...new Set(dialMatches.map(match => match[1].toLowerCase()))];
    if (values.length === 1) {
      const value = values[0] === 'gray' ? 'Grey'
        : values[0] === 'mop' ? 'Mother of Pearl'
          : values[0].replace(/\b\w/g, letter => letter.toUpperCase());
      proposals.push(baseProposal(record, 'dial_color', value, dialMatches[0],
        'EXPLICIT_DIAL_PHRASE_V1',
        'The missing dial color is explicitly joined to dial or face in this listing raw message.'));
    } else if (values.length > 1) {
      blocked.push({ listing_id: String(record.id), field: 'dial_color', reason: 'MULTIPLE_DIAL_COLORS_IN_RAW' });
    }
  }

  if (!record.condition) {
    const conditionMatches = CONDITION_RULES
      .map(([value, regex]) => ({ value, match: regex.exec(raw) }))
      .filter(candidate => candidate.match);
    const values = [...new Set(conditionMatches.map(candidate => candidate.value))];
    if (values.length === 1) {
      proposals.push(baseProposal(record, 'condition', values[0], conditionMatches[0].match,
        'EXPLICIT_CONDITION_PHRASE_V1',
        'The missing condition is explicitly stated in this listing raw message.'));
    } else if (values.length > 1) {
      blocked.push({ listing_id: String(record.id), field: 'condition', reason: 'CONFLICTING_CONDITION_PHRASES_IN_RAW' });
    }
  }

  if (priceMissing(record)) {
    const usdMatches = matches(EXPLICIT_USD, raw).filter(match => {
      const value = amount(match, 2, 3);
      return value >= 250 && value <= 2_000_000;
    });
    const usdValues = [...new Set(usdMatches.map(match => amount(match, 2, 3)))];
    const rawOmegaReferences = record.brand === 'Omega'
      ? [...new Set(matches(OMEGA_REFERENCE, raw).map(match => comparisonKey(match[0])))] : [];
    const identityConflict = record.reference && rawOmegaReferences.length
      && rawOmegaReferences.some(reference => reference !== comparisonKey(record.reference));

    if (identityConflict) {
      blocked.push({ listing_id: String(record.id), field: 'price_usd', reason: 'REFERENCE_IDENTITY_CONFLICT' });
    } else if (usdValues.length === 1 && usdMatches.length === 1) {
      proposals.push({ ...baseProposal(record, 'price_usd', usdValues[0], usdMatches[0],
        'SINGLE_EXPLICIT_USD_USDT_V1',
        'The missing WTS price has one explicit USD or USDT amount in the same raw message.'),
      price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH',
      analytics_admission: 'REQUIRES_INDEPENDENT_QUALIFICATION' });
    } else if (usdMatches.length > 1) {
      blocked.push({ listing_id: String(record.id), field: 'price_usd', reason: 'MULTIPLE_EXPLICIT_USD_AMOUNTS' });
    } else {
      const dollarMatches = matches(BARE_DOLLAR, raw).filter(match => {
        const value = amount(match, 1, 2);
        return value >= 250 && value <= 2_000_000;
      });
      const dollarValues = [...new Set(dollarMatches.map(match => amount(match, 1, 2)))];
      if (dollarValues.length === 1 && dollarMatches.length === 1
        && !FOREIGN_CURRENCY.test(raw) && !COMPETING_PRICE_CONTEXT.test(raw)) {
        proposals.push({ ...baseProposal(record, 'price_usd', dollarValues[0], dollarMatches[0],
          'OWNER_ASSUMED_USD_SINGLE_DOLLAR_V1',
          'The missing WTS price has one unambiguous dollar-shaped amount; it is owner-assumed USD and remains excluded from independent analytics.'),
        price_evidence_status: 'OWNER_ASSUMED_USD',
        analytics_admission: 'TRACKED_ONLY_NOT_INDEPENDENTLY_QUALIFIED' });
      } else if (dollarMatches.length) {
        blocked.push({ listing_id: String(record.id), field: 'price_usd', reason: 'AMBIGUOUS_DOLLAR_PRICE_CONTEXT' });
      }
    }
  }

  return { proposals, blocked };
}

function buildManifest(records) {
  const ids = new Set();
  const proposals = [];
  const blocked = [];
  const brandCounts = { Omega: 0, Tudor: 0 };
  for (const record of records) {
    if (!ALLOWED_BRANDS.has(record.brand)) continue;
    if (ids.has(record.id)) throw new Error(`Duplicate listing ID: ${record.id}`);
    ids.add(record.id);
    brandCounts[record.brand] += 1;
    const result = proposalsForRecord(record);
    proposals.push(...result.proposals);
    blocked.push(...result.blocked);
  }
  proposals.sort((a, b) => a.brand.localeCompare(b.brand)
    || a.field.localeCompare(b.field) || a.listing_id.localeCompare(b.listing_id));
  return {
    schema_version: 'TUDOR_OMEGA_MISSING_ONLY_V1',
    generated_at: new Date().toISOString(),
    source: 'PUBLIC_READ_ONLY_REVIEWED_MARKET_INVENTORY',
    writes: 0,
    input_unique_listings: ids.size,
    input_by_brand: brandCounts,
    proposal_count: proposals.length,
    proposals_by_brand_field: proposals.reduce((counts, proposal) => {
      const key = `${proposal.brand}:${proposal.field}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    blocked_count: blocked.length,
    blocked_by_reason: blocked.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {}),
    proposals,
    blocked,
  };
}

async function crawlBrand(origin, brand, fetchImpl = fetch) {
  const records = [];
  const seen = new Set();
  let expectedTotal = null;
  let cursor = null;
  for (let page = 1; page <= 2_000; page += 1) {
    const url = new URL('/api/reviewed-market-inventory', origin);
    url.searchParams.set('brand', brand);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('pagination', 'cursor');
    if (cursor) url.searchParams.set('cursor', cursor);
    let response;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      response = await fetchImpl(url);
      if (response.ok || (response.status !== 429 && response.status < 500)) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
    if (!response.ok) throw new Error(`${brand} page ${page} failed with HTTP ${response.status}.`);
    const body = await response.json();
    if (expectedTotal === null) expectedTotal = Number(body.total);
    for (const record of body.records || []) {
      if (record?.id && !seen.has(record.id)) {
        seen.add(record.id);
        records.push(record);
      }
    }
    if (!body.hasMore || !body.nextCursor) {
      if (!Number.isInteger(expectedTotal) || records.length !== expectedTotal) {
        throw new Error(`${brand} crawl did not reconcile: expected ${expectedTotal}, received ${records.length}.`);
      }
      return records;
    }
    cursor = body.nextCursor;
  }
  throw new Error(`${brand} cursor did not terminate within 2,000 pages.`);
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const originIndex = process.argv.indexOf('--origin');
  const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : 'tudor-omega-missing-field-manifest.json');
  const origin = originIndex >= 0 ? process.argv[originIndex + 1] : DEFAULT_ORIGIN;
  const records = [
    ...await crawlBrand(origin, 'Omega'),
    ...await crawlBrand(origin, 'Tudor'),
  ];
  const manifest = buildManifest(records);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    output,
    writes: 0,
    input_unique_listings: manifest.input_unique_listings,
    proposal_count: manifest.proposal_count,
    proposals_by_brand_field: manifest.proposals_by_brand_field,
    blocked_by_reason: manifest.blocked_by_reason,
  })}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildManifest,
  crawlBrand,
  proposalsForRecord,
  sha256,
};
