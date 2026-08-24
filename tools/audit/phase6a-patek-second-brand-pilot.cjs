#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.resolve(process.env.AUDIT_OUTPUT_DIR || path.join(ROOT, 'audit-output/phase6a-patek-second-brand-pilot'));
const INPUT = path.join(OUTPUT_DIR, 'inputs/reference-shards.json');
const PROJECT_REF = 'qnsafosakvonzgfcsphh';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const refKey = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const exactText = value => String(value || '').trim().toUpperCase();
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);

function classifyReference(value, catalogByExact, catalogByKey, modelNames) {
  const text = String(value || '').trim();
  const upper = exactText(text);
  const key = refKey(text);
  if (!text || !key) return { classification: 'INVALID' };
  if (catalogByExact.has(upper)) {
    const match = catalogByExact.get(upper);
    return { classification: 'VALID_EXACT_REFERENCE', canonical_reference: match.reference, canonical_model: match.model };
  }
  const keyMatches = catalogByKey.get(key) || [];
  if (keyMatches.length === 1) {
    const match = keyMatches[0];
    return { classification: 'VALID_REFERENCE_VARIANT', canonical_reference: match.reference, canonical_model: match.model };
  }
  if (keyMatches.length > 1) return { classification: 'AMBIGUOUS' };
  if (modelNames.has(upper)) return { classification: 'MODEL_FAMILY' };
  if (/\b(BRACELET|STRAP|DIAL|BUCKLE|CLASP|LINK|BEZEL|CASE|MOVEMENT|COMPONENT|PART)\b/i.test(text)) {
    return { classification: 'COMPONENT' };
  }
  const prefixMatches = [...catalogByKey.keys()].filter(candidate => candidate.startsWith(key) || key.startsWith(candidate));
  if (/^[A-Z0-9/.-]{2,14}$/i.test(text) && prefixMatches.length > 0) return { classification: 'PARTIAL_REFERENCE' };
  if ((text.match(/\d{3,}/g) || []).length > 1) return { classification: 'AMBIGUOUS' };
  if (/^[A-Z][A-Z\s-]{2,}$/i.test(text)) return { classification: 'FREE_TEXT' };
  return { classification: 'INVALID' };
}

function mergeMetric(target, source) {
  const fields = [
    'active_rows', 'wts', 'wtb', 'missing_usd_structured_source', 'wts_missing_usd',
    'wts_original_price', 'explicit_usd_usdt', 'verified_fx', 'bundle_context',
    'tf_published', 'pr_source_rows', 'pr_qualified'
  ];
  for (const field of fields) target[field] = Number(target[field] || 0) + Number(source[field] || 0);
}

function main() {
  if (!fs.existsSync(INPUT)) throw new Error(`Missing sanitized aggregate input: ${INPUT}`);
  const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  if (input.project_ref !== PROJECT_REF || input.read_only !== true || input.shards?.length !== 16) {
    throw new Error('Invalid or incomplete Phase 6A aggregate input');
  }

  const catalog = listCanonicalCatalogReferences('Patek Philippe');
  const catalogByExact = new Map(catalog.map(row => [exactText(row.reference), row]));
  const catalogByKey = new Map();
  for (const row of catalog) {
    const key = refKey(row.reference);
    if (!catalogByKey.has(key)) catalogByKey.set(key, []);
    catalogByKey.get(key).push(row);
  }
  const modelNames = new Set(catalog.map(row => exactText(row.model)));

  const byValue = new Map();
  for (const row of input.shards.flat()) {
    const value = String(row.reference_value || '').trim();
    if (!byValue.has(value)) byValue.set(value, { reference_value: value, ref_key: refKey(value) });
    mergeMetric(byValue.get(value), row);
  }

  const taxonomy = {};
  const canonicalMetrics = new Map();
  const classifiedValues = [];
  for (const row of byValue.values()) {
    const identity = classifyReference(row.reference_value, catalogByExact, catalogByKey, modelNames);
    taxonomy[identity.classification] = (taxonomy[identity.classification] || 0) + 1;
    const classified = { ...row, ...identity };
    classifiedValues.push(classified);
    if (identity.canonical_reference) {
      if (!canonicalMetrics.has(identity.canonical_reference)) {
        canonicalMetrics.set(identity.canonical_reference, {
          reference: identity.canonical_reference,
          model: identity.canonical_model,
          variants: [],
          exact_value_present: false,
          variant_value_present: false
        });
      }
      const target = canonicalMetrics.get(identity.canonical_reference);
      target.variants.push(row.reference_value);
      target.exact_value_present ||= identity.classification === 'VALID_EXACT_REFERENCE';
      target.variant_value_present ||= identity.classification === 'VALID_REFERENCE_VARIANT';
      mergeMetric(target, row);
    }
  }

  const ranked = [...canonicalMetrics.values()].map(row => {
    const ambiguityRate = row.active_rows ? row.bundle_context / row.active_rows : 0;
    const explicitRate = row.wts ? row.explicit_usd_usdt / row.wts : 0;
    const opportunityScore =
      row.missing_usd_structured_source * 12 +
      Math.min(row.wts_missing_usd, 50) * 2 +
      Math.min(row.explicit_usd_usdt, 50) * 0.25 +
      Math.min(row.verified_fx, 50) * 0.15 +
      (row.tf_published > 0 ? 4 : 0) +
      (row.pr_qualified > 0 ? 2 : 0) -
      ambiguityRate * 40;
    return {
      ...row,
      variants: [...new Set(row.variants)].sort(),
      explicit_currency_rate: explicitRate,
      bundle_context_rate: ambiguityRate,
      candidate_score: Number(opportunityScore.toFixed(4))
    };
  }).sort((a, b) => b.candidate_score - a.candidate_score || b.missing_usd_structured_source - a.missing_usd_structured_source || a.reference.localeCompare(b.reference));

  const referencedRows = sum(classifiedValues, 'active_rows');
  const census = {
    total_active: Number(input.base_totals.total_active),
    wts: Number(input.base_totals.wts),
    wtb: Number(input.base_totals.wtb),
    rows_with_exact_source_identifier: Number(input.base_totals.source_id_rows),
    rows_with_immutable_raw_version_identifier: Number(input.base_totals.raw_version_id_rows),
    rows_with_complete_immutable_ids_and_hashes: Number(input.base_totals.exact_id_hash_rows),
    populated_model_rows: Number(input.base_totals.model_populated_rows),
    populated_model_count: input.base_totals.model_populated_rows ? 'UNKNOWN_PENDING_DISTINCT_QUERY' : 0,
    original_price_count: Number(input.base_totals.original_price_rows),
    normalized_usd_price_count: Number(input.base_totals.normalized_usd_rows),
    missing_normalized_usd_with_structured_source_price: Number(input.base_totals.missing_usd_with_structured_source_price),
    rows_with_reference_value: referencedRows,
    rows_without_reference_value: Number(input.base_totals.total_active) - referencedRows,
    distinct_reference_values: classifiedValues.length,
    trading_floor_published_base: sum(classifiedValues, 'tf_published'),
    price_research_source_rows_base: sum(classifiedValues, 'pr_source_rows'),
    price_research_qualified_wts_base: sum(classifiedValues, 'pr_qualified'),
    analytics_ready_canonical_references_base: ranked.filter(row => row.pr_qualified >= 2).length
  };

  const result = {
    contract: 'watchfacts-patek-phase6a-reference-ranking-v1',
    project_ref: PROJECT_REF,
    read_only: true,
    source_input_sha256: sha256(fs.readFileSync(INPUT)),
    catalog: { references: catalog.length, models: modelNames.size },
    census,
    reference_taxonomy_distinct_values: taxonomy,
    valid_customer_safe_reference_count: ranked.length,
    exact_reference_count: ranked.filter(row => row.exact_value_present).length,
    variant_only_reference_count: ranked.filter(row => !row.exact_value_present && row.variant_value_present).length,
    ranked_references: ranked,
    top_reference_ranking: ranked.slice(0, 20),
    classified_reference_values: classifiedValues.sort((a, b) => b.active_rows - a.active_rows || a.reference_value.localeCompare(b.reference_value)),
    checksums: {
      active_population: sha256(`${census.total_active}:${census.wts}:${census.wtb}:${census.normalized_usd_price_count}`),
      classified_values: sha256(classifiedValues.map(row => `${row.reference_value}:${row.classification}:${row.active_rows}`).sort().join('\n')),
      valid_canonical_references: sha256(ranked.map(row => row.reference).sort().join('\n'))
    }
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'reference-ranking.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ census, taxonomy, valid_customer_safe_reference_count: ranked.length, top: ranked.slice(0, 12) }, null, 2)}\n`);
}

main();
