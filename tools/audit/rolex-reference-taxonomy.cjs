#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { lookupCatalog } = require('../../api/_lib/catalog.js');

const CLASSIFICATIONS = Object.freeze([
  'VALID_EXACT_REFERENCE',
  'VALID_REFERENCE_VARIANT',
  'MODEL_OR_FAMILY_TOKEN',
  'COMPONENT_ACCESSORY',
  'FREE_TEXT',
  'AMBIGUOUS',
  'INVALID',
]);

const MODEL_TOKENS = new Set([
  'AIRKING', 'CELLINI', 'COSMOGRAPH DAYTONA', 'DATEJUST', 'DAYDATE', 'DAYTONA',
  'DEEPSEA', 'EXPLORER', 'GMTMASTER', 'GMTMASTERII', 'LADYDATEJUST', 'MILGAUSS',
  'OYSTERPERPETUAL', 'PEARLMASTER', 'SEADWELLER', 'SKYDWELLER', 'SUBMARINER',
  'YACHTMASTER', 'YACHTMASTERII',
].map(value => value.replace(/[^A-Z0-9]/g, '')));

const COMPONENT = /\b(?:BRACELET|STRAP|BAND|CLASP|BUCKLE|LINK|ENDLINK|BEZEL|INSERT|CRYSTAL|DIAL|CROWN|STEM|CASE|MOVEMENT|ROTOR|HANDS?|PUSHER|SPRINGBAR|BOX|PAPERS?)\b/i;

function key(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function classifyReference(value) {
  const raw = String(value || '').trim();
  const normalized = key(raw);
  if (!raw || !normalized) return { classification: 'INVALID', reason: 'EMPTY_OR_PUNCTUATION_ONLY' };
  if (/[^A-Za-z0-9\s./&-]/.test(raw)) return { classification: 'INVALID', reason: 'MALFORMED_REFERENCE_TOKEN' };
  const catalog = lookupCatalog(raw, 'Rolex');
  if (catalog?.found && catalog.matchType === 'exact') {
    return { classification: 'VALID_EXACT_REFERENCE', reason: 'EXACT_LOCAL_CATALOG_MATCH', canonical_reference: catalog.reference, canonical_model: catalog.model, source: catalog.source };
  }
  if (catalog?.found && ['exact_alias', 'collapsed'].includes(catalog.matchType)) {
    return { classification: 'VALID_REFERENCE_VARIANT', reason: `CATALOG_${String(catalog.matchType).toUpperCase()}`, canonical_reference: catalog.reference, canonical_model: catalog.model, source: catalog.source };
  }
  if (catalog?.found && catalog.matchType === 'partial') {
    const matched = key(catalog.reference);
    const suffix = normalized.slice(matched.length);
    if (normalized.startsWith(matched) && /^\d{2,4}$/.test(suffix)) {
      return { classification: 'VALID_REFERENCE_VARIANT', reason: 'CATALOG_REFERENCE_WITH_NUMERIC_VARIANT_SUFFIX', canonical_reference: catalog.reference, canonical_model: catalog.model, source: catalog.source };
    }
  }
  if (COMPONENT.test(raw)) return { classification: 'COMPONENT_ACCESSORY', reason: 'COMPONENT_OR_ACCESSORY_TERM' };
  if (MODEL_TOKENS.has(normalized)) return { classification: 'MODEL_OR_FAMILY_TOKEN', reason: 'KNOWN_ROLEX_MODEL_OR_FAMILY' };
  if (/^[A-Za-z][A-Za-z\s&-]{2,60}$/.test(raw)) return { classification: 'FREE_TEXT', reason: 'TEXT_NOT_REFERENCE_OR_KNOWN_MODEL' };
  if (/^(?:19|20)\d{2}$/.test(normalized) || /^\d{1,3}$/.test(normalized)) return { classification: 'INVALID', reason: 'YEAR_OR_TOO_SHORT_NUMERIC_TOKEN' };
  if (/^[A-Z0-9]{4,14}$/.test(normalized) && /\d/.test(normalized)) return { classification: 'AMBIGUOUS', reason: 'REFERENCE_SHAPED_BUT_NOT_CATALOG_CONFIRMED' };
  return { classification: 'INVALID', reason: 'MALFORMED_REFERENCE_TOKEN' };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function main() {
  const inputPath = path.resolve(process.env.ROLEX_REFERENCE_CENSUS || 'audit-output/phase3-production-census/rolex-reference-census.json');
  const outputPath = path.resolve(process.env.ROLEX_REFERENCE_TAXONOMY_OUTPUT || 'audit-output/phase3-rolex-canary-shadow/reference-taxonomy-summary.json');
  const census = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const rows = (census.references || []).map(row => ({
    reference: row.reference,
    listing_count: Number(row.normalized_rows || 0),
    ...classifyReference(row.reference),
  }));
  const byClassification = {};
  const listingsByClassification = {};
  for (const row of rows) {
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    listingsByClassification[row.classification] = (listingsByClassification[row.classification] || 0) + row.listing_count;
  }
  const report = {
    contract: 'watchfacts-rolex-reference-taxonomy-v1',
    generated_at: new Date().toISOString(),
    source_sha256: sha256(fs.readFileSync(inputPath)),
    classifications: CLASSIFICATIONS,
    distinct_values: rows.length,
    by_classification: byClassification,
    listings_by_classification: listingsByClassification,
    selected_reference_identity: ['126334', '126300', '228235', '228238', '126333'].map(reference => ({ reference, ...classifyReference(reference) })),
    representative_non_exact: rows.filter(row => !['VALID_EXACT_REFERENCE', 'VALID_REFERENCE_VARIANT'].includes(row.classification)).slice(0, 50),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ by_classification: byClassification, listings_by_classification: listingsByClassification }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { CLASSIFICATIONS, classifyReference };
