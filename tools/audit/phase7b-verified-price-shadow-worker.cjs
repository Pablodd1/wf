#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  extractPriceCandidates,
  extractPriceObservations,
  segmentDealerMessage,
} = require('../../api/_lib/normalization-v4.cjs');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const {
  CONTRACT: FX_CONTRACT,
  DIRECTION: FX_DIRECTION,
  HistoricalEcbResolver,
  MAX_LOOKBACK_DAYS,
  applicableSourceDate,
} = require('./phase7b-historical-fx.cjs');
const { SOURCE: ECB_SOURCE, SOURCE_URL: ECB_SOURCE_URL } = require('../mariadb-live/fetch-fx-snapshot.cjs');

const PROJECT_REF = 'qnsafosakvonzgfcsphh';
const CONTRACT = 'watchfacts-phase7b-verified-price-research-shadow-v1';
const PARSER_VERSION = 'price-parser-v5-shadow';
const BRANDS = ['Rolex', 'Patek Philippe'];
const SHA256 = /^[0-9a-f]{64}$/;

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const refKey = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clean = value => String(value || '').trim() || null;

function postgresCharacterOffset(value, utf16Offset) {
  if (!Number.isInteger(utf16Offset) || utf16Offset < 0) return null;
  return Array.from(String(value || '').slice(0, utf16Offset)).length;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function buildCatalog() {
  return BRANDS.flatMap(brand => listCanonicalCatalogReferences(brand).map(entry => {
    const row = { brand, model: clean(entry.model), reference: clean(entry.reference) };
    if (!row.model || !row.reference) throw new Error(`Incomplete ${brand} catalog entry`);
    return { ...row, entry_sha256: sha256(stable(row)) };
  })).sort((a, b) => a.brand.localeCompare(b.brand) || a.reference.localeCompare(b.reference));
}

function catalogIndex(catalog = buildCatalog()) {
  const index = new Map();
  for (const entry of catalog) index.set(`${entry.brand}|${entry.reference.toUpperCase()}`, entry);
  return index;
}

function baseClassification(row, catalog) {
  const reference = clean(row.reference_normalized);
  const exact = reference ? catalog.get(`${row.brand}|${reference.toUpperCase()}`) : null;
  const raw = String(row.raw_message || '');
  if (!reference || !exact) {
    const normalized = refKey(reference);
    const partial = normalized && [...catalog.values()].some(entry => entry.brand === row.brand
      && refKey(entry.reference).startsWith(normalized) && refKey(entry.reference) !== normalized);
    return { classification: partial ? 'REFERENCE_AMBIGUOUS' : 'REFERENCE_INVALID', exact: null,
      reason: partial ? 'PARTIAL_REFERENCE_NOT_EXPANDED' : 'NOT_A_CUSTOMER_SAFE_EXACT_REFERENCE' };
  }
  if (!raw || !refKey(raw).includes(refKey(exact.reference))) {
    return { classification: 'SOURCE_NOT_RECONCILABLE', exact, reason: 'EXACT_REFERENCE_NOT_PROVEN_IN_IMMUTABLE_RAW' };
  }
  return { exact, raw };
}

function classifyObservation(row, catalog = catalogIndex(), options = {}) {
  if (!row || !BRANDS.includes(row.brand) || row.intent !== 'WTS' || !positive(row.price_usd)) {
    throw new Error('Phase 7B worker accepts only current Rolex/Patek priced WTS observations');
  }
  if (!row.listing_id || !row.source_record_id || !row.raw_message_version_id
    || !SHA256.test(row.source_hash || '')
    || (row.source_candidate_hash && !SHA256.test(row.source_candidate_hash))) {
    return finish(row, null, 'SOURCE_NOT_RECONCILABLE', 'INCOMPLETE_IMMUTABLE_LINEAGE');
  }

  if (/(?:supersed|suppress|duplicate)/i.test(String(row.price_research_status || ''))
    || /^(?:withdrawn|rejected|hidden|deleted|archived)$/i.test(String(row.trading_floor_status || ''))
    || /^(?:withdrawn|rejected|hidden|deleted|archived)$/i.test(String(row.verdict || ''))) {
    return finish(row, null, 'OTHER', 'NOT_CURRENT_AFTER_DEDUPLICATION_OR_PUBLICATION_CONTROLS');
  }

  const identity = baseClassification(row, catalog);
  if (identity.classification) return finish(row, identity.exact, identity.classification, identity.reason);
  const { exact, raw } = identity;
  const segments = segmentDealerMessage(raw);
  const candidates = extractPriceCandidates(raw);
  const observations = extractPriceObservations(raw);

  // The segmenter returns zero segments for an ordinary unstructured single
  // listing and two or more only when it proves multi-item structure.
  if (row.parent_id || row.is_bundle === true || row.bundle_status !== 'SINGLE_CANDIDATE'
    || segments.length > 1 || candidates.some(item => item.review_reason === 'BUNDLE_PRICE_AMBIGUITY')) {
    return finish(row, exact, 'BUNDLE_PRICE_AMBIGUOUS', 'WATCH_TO_PRICE_ASSOCIATION_IS_NOT_SINGLE_ITEM');
  }
  if (candidates.length > 1 || candidates.some(item => item.review_reason === 'MULTIPLE_PRICE_AMBIGUITY')) {
    return finish(row, exact, 'MULTIPLE_PRICE_AMBIGUOUS', 'MULTIPLE_PRICE_CANDIDATES_NOT_DETERMINISTIC');
  }

  if (observations.length !== 1 || observations[0].evidence_status !== 'AUTO_APPROVED') {
    if (String(row.currency_evidence || '').toLowerCase() === 'usd_defaulted_by_policy') {
      return finish(row, exact, 'LEGACY_USD_DEFAULTED', 'RETIRED_USD_DEFAULTING_WITHOUT_EXPLICIT_SOURCE_CURRENCY');
    }
    if (/(?:^|\s)\$\s*\d/u.test(raw) && !/(?:USD|USDT|US\$|U\$)/iu.test(raw)) {
      return finish(row, exact, 'BARE_DOLLAR_AMBIGUOUS', 'BARE_DOLLAR_SYMBOL_HAS_NO_EXPLICIT_CURRENCY');
    }
    if (/\b\d+(?:[.,]\d+)?\s*[km]\b/iu.test(raw)) {
      return finish(row, exact, 'CURRENCYLESS_KM', 'K_OR_M_AMOUNT_HAS_NO_EXPLICIT_CURRENCY');
    }
    if (candidates.length === 1 && !clean(candidates[0].currency_original)) {
      return finish(row, exact, 'CURRENCYLESS_AMOUNT', 'SOURCE_AMOUNT_HAS_NO_EXPLICIT_CURRENCY');
    }
    return finish(row, exact, candidates.length ? 'REVIEW_REQUIRED' : 'OTHER',
      candidates.length ? 'PARSER_V5_REQUIRES_HUMAN_REVIEW' : 'NO_EXACT_PARSER_V5_PRICE_OBSERVATION');
  }

  const observation = observations[0];
  const sourceAmount = positive(observation.amount_original);
  const sourceCurrency = clean(observation.currency_original)?.toUpperCase();
  const currentUsd = positive(row.price_usd);
  const span = observation.raw_price_text || raw.slice(observation.position?.start, observation.position?.end);
  if (!sourceAmount || !sourceCurrency || !span || !raw.includes(span)) {
    return finish(row, exact, 'SOURCE_NOT_RECONCILABLE', 'PARSER_OBSERVATION_LACKS_EXACT_SOURCE_SPAN');
  }
  const structuredAmount = positive(row.price_original);
  const structuredCurrency = clean(row.currency_original)?.toUpperCase();
  if ((structuredAmount && Math.abs(structuredAmount - sourceAmount) > 0.01)
    || (structuredCurrency && structuredCurrency !== sourceCurrency)) {
    return finish(row, exact, 'SOURCE_PRICE_CONFLICT',
      'STRUCTURED_SOURCE_PRICE_OR_CURRENCY_CONFLICTS_WITH_IMMUTABLE_SOURCE', observation,
      { sourceAmount, sourceCurrency });
  }

  let verifiedUsd;
  let fxProvider = null;
  let fxRate = null;
  let fxDate = null;
  let fxApplicableDate = null;
  let fxContract = null;
  let fxDirection = null;
  let fxSourceUrl = null;
  let storedFxComparison = null;
  if (['USD', 'USDT'].includes(sourceCurrency)) {
    verifiedUsd = sourceAmount;
  } else {
    fxApplicableDate = applicableSourceDate(row.source_created_on);
    const independent = options.independentFx || null;
    if (!fxApplicableDate) {
      return finish(row, exact, 'FX_PROVENANCE_MISSING', 'FOREIGN_CURRENCY_HAS_NO_VALID_IMMUTABLE_SOURCE_DATE', observation,
        { sourceAmount, sourceCurrency });
    }
    if (!independent) {
      return finish(row, exact, 'FX_PROVENANCE_MISSING', 'INDEPENDENT_DATED_FX_NOT_RESOLVED', observation,
        { sourceAmount, sourceCurrency, fxApplicableDate });
    }
    fxProvider = clean(independent.provider);
    fxRate = positive(independent.usd_per_source_unit);
    fxDate = applicableSourceDate(independent.effective_date);
    fxContract = clean(independent.contract);
    fxDirection = clean(independent.rate_direction);
    fxSourceUrl = clean(independent.source_url);
    const effectiveDelta = fxDate
      ? Math.round((Date.parse(`${fxApplicableDate}T00:00:00Z`) - Date.parse(`${fxDate}T00:00:00Z`)) / 86_400_000)
      : null;
    if (fxContract !== FX_CONTRACT || fxProvider !== ECB_SOURCE || fxSourceUrl !== ECB_SOURCE_URL
      || fxDirection !== FX_DIRECTION || !fxRate || !fxDate
      || independent.applicable_date !== fxApplicableDate || effectiveDelta === null
      || effectiveDelta < 0 || effectiveDelta > MAX_LOOKBACK_DAYS
      || Number(independent.lookback_days) !== effectiveDelta) {
      return finish(row, exact, 'FX_INVALID', 'INDEPENDENT_FX_CONTRACT_OR_RATE_DIRECTION_INVALID', observation,
        { sourceAmount, sourceCurrency, fxApplicableDate });
    }
    verifiedUsd = Math.round(sourceAmount * fxRate);
    if (!positive(verifiedUsd)) return finish(row, exact, 'FX_INVALID', 'FX_CONVERSION_IS_NON_POSITIVE', observation);
    const storedRate = positive(row.conversion_rate);
    storedFxComparison = {
      source_matches: clean(row.conversion_source) === fxProvider,
      rate_matches: Boolean(storedRate && Math.abs(storedRate - fxRate) <= 0.000000000001),
      effective_date_matches: applicableSourceDate(row.conversion_timestamp) === fxDate,
    };
  }

  if (Math.abs(verifiedUsd - currentUsd) > 1.01) {
    return finish(row, exact, 'SOURCE_PRICE_CONFLICT', 'CURRENT_NORMALIZED_USD_CONFLICTS_WITH_EXACT_SOURCE_EVIDENCE', observation,
      { sourceAmount, sourceCurrency, fxProvider, fxRate, fxDate, fxApplicableDate,
        fxContract, fxDirection, fxSourceUrl, storedFxComparison });
  }

  return finish(row, exact, 'VERIFIED_IN_NEW_COHORT', null, observation,
    { sourceAmount, sourceCurrency, fxProvider, fxRate, fxDate, fxApplicableDate,
      fxContract, fxDirection, fxSourceUrl, storedFxComparison, verifiedUsd, span });
}

function finish(row, exact, classification, exclusionReason, observation = null, evidence = {}) {
  const verified = classification === 'VERIFIED_IN_NEW_COHORT';
  const span = verified ? evidence.span : null;
  const raw = String(row.raw_message || '');
  const record = {
    listing_id: row.listing_id,
    source_record_id: row.source_record_id,
    raw_message_version_id: row.raw_message_version_id,
    source_hash: row.source_hash,
    source_candidate_hash: row.source_candidate_hash || null,
    brand: row.brand,
    canonical_model: exact?.model || null,
    canonical_reference: exact?.reference || null,
    intent: 'WTS',
    source_amount: evidence.sourceAmount ?? positive(observation?.amount_original),
    source_currency: evidence.sourceCurrency ?? clean(observation?.currency_original)?.toUpperCase() ?? null,
    parser_version: PARSER_VERSION,
    parser_rule: observation?.parser_rule || null,
    source_span_start: verified ? postgresCharacterOffset(raw, observation?.position?.start) : null,
    source_span_end: verified ? postgresCharacterOffset(raw, observation?.position?.end) : null,
    source_span_sha256: span ? sha256(span) : null,
    price_evidence_classification: classification,
    fx_provider: verified ? evidence.fxProvider : null,
    fx_rate: verified ? evidence.fxRate : null,
    fx_effective_date: verified ? evidence.fxDate : null,
    fx_applicable_date: verified ? evidence.fxApplicableDate : null,
    fx_contract: verified ? evidence.fxContract : null,
    fx_rate_direction: verified ? evidence.fxDirection : null,
    fx_source_url: verified ? evidence.fxSourceUrl : null,
    stored_fx_comparison: verified ? evidence.storedFxComparison : null,
    verified_usd_amount: verified ? evidence.verifiedUsd : null,
    current_usd_amount: positive(row.price_usd),
    qualification_reason: verified ? 'EXACT_IMMUTABLE_SOURCE_PARSER_V5_AND_CANONICAL_REFERENCE_MATCH' : null,
    exclusion_reason: exclusionReason,
    dedupe_status: clean(row.price_research_status) || 'CURRENT_PR_NOT_SUPPRESSED',
  };
  const evidenceCanonical = stable(record);
  return { ...record, source_span_text: span, evidence_canonical: evidenceCanonical,
    observation_sha256: sha256(evidenceCanonical) };
}

async function rpc(client, name, parameters) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function mapLimit(values, concurrency, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, consume));
  return results;
}

async function run(options = {}) {
  const url = clean(options.url || process.env.SUPABASE_URL);
  const key = clean(options.key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!url || !key) throw new Error('SUPABASE_URL and a service-role key are required');
  const parsed = new URL(url);
  if (parsed.hostname !== `${PROJECT_REF}.supabase.co`) throw new Error('Phase 7B is bound to canonical QNSA only');
  const client = options.client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const catalog = buildCatalog();
  const index = catalogIndex(catalog);
  const fxResolver = options.fxResolver || new HistoricalEcbResolver();
  const catalogSha = sha256(stable(catalog));
  const runKey = options.runKey || clean(process.env.PHASE7B_RUN_KEY)
    || `phase7b-${new Date().toISOString().replace(/[-:.TZ]/g, '').toLowerCase()}`;
  const begin = await rpc(client, 'begin_phase7b_verified_price_shadow', {
    p_run_key: runKey, p_contract: CONTRACT, p_parser_version: PARSER_VERSION,
    p_catalog_sha256: catalogSha, p_catalog: catalog,
  });
  const summary = { run_key: runKey, begin, catalog_sha256: catalogSha, brands: {}, classifications: {} };
  for (const brand of BRANDS) {
    let after = null;
    let batchNumber = 0;
    let processed = 0;
    while (true) {
      const page = await rpc(client, 'phase7b_verified_price_source_page', {
        p_run_key: runKey, p_brand: brand, p_after_id: after, p_limit: 250,
      });
      const rows = (page || []).map(value => value.row_data || value);
      if (!rows.length) break;
      const preliminary = rows.map(row => classifyObservation(row, index));
      const fxKeys = [...new Map(preliminary.map((record, rowIndex) => ({ record, row: rows[rowIndex] }))
        .filter(({ record, row }) => record.price_evidence_classification === 'FX_PROVENANCE_MISSING'
          && record.exclusion_reason === 'INDEPENDENT_DATED_FX_NOT_RESOLVED'
          && applicableSourceDate(row.source_created_on))
        .map(({ record, row }) => [`${record.source_currency}|${applicableSourceDate(row.source_created_on)}`,
          { currency: record.source_currency, applicableDate: applicableSourceDate(row.source_created_on) }])).values()];
      const resolvedFx = new Map();
      await mapLimit(fxKeys, 2, async request => {
        const key = `${request.currency}|${request.applicableDate}`;
        try {
          resolvedFx.set(key, await fxResolver.resolve(request.currency, request.applicableDate));
        } catch (error) {
          resolvedFx.set(key, null);
          summary.fx_resolution_failures = (summary.fx_resolution_failures || 0) + 1;
        }
      });
      const records = rows.map((row, rowIndex) => {
        const preliminaryRecord = preliminary[rowIndex];
        if (preliminaryRecord.exclusion_reason !== 'INDEPENDENT_DATED_FX_NOT_RESOLVED') return preliminaryRecord;
        const key = `${preliminaryRecord.source_currency}|${applicableSourceDate(row.source_created_on)}`;
        return classifyObservation(row, index, { independentFx: resolvedFx.get(key) || null });
      });
      batchNumber += 1;
      const batchSha = sha256(records.map(record => record.observation_sha256).join(''));
      await rpc(client, 'ingest_phase7b_verified_price_shadow_batch', {
        p_run_key: runKey, p_brand: brand, p_batch_number: batchNumber,
        p_batch_sha256: batchSha, p_records: records,
      });
      for (const record of records) summary.classifications[record.price_evidence_classification]
        = (summary.classifications[record.price_evidence_classification] || 0) + 1;
      processed += records.length;
      after = rows.at(-1).listing_id;
      if (rows.length < 250) break;
    }
    summary.brands[brand] = { processed, batches: batchNumber, last_listing_id: after };
  }
  const materialized = await mapLimit(catalog, Number(options.referenceConcurrency || 4), entry => rpc(
    client, 'materialize_phase7b_verified_reference', {
      p_run_key: runKey, p_brand: entry.brand, p_reference: entry.reference,
    },
  ));
  summary.reference_materialization = {
    references: materialized.length,
    concurrency: Number(options.referenceConcurrency || 4),
    result_sha256: sha256(stable(materialized.map(value => value.census_sha256))),
  };
  summary.completion = await rpc(client, 'complete_phase7b_verified_price_shadow', {
    p_run_key: runKey,
  });
  summary.report = await rpc(client, 'phase7b_verified_shadow_report', { p_run_key: runKey });
  const canaries = summary.report?.proposed_canaries || [];
  summary.query_benchmarks = [];
  for (const candidate of canaries) {
    const started = performance.now();
    await rpc(client, 'phase7b_verified_reference_snapshot', {
      p_run_key: runKey, p_brand: candidate.brand, p_reference: candidate.canonical_reference,
    });
    summary.query_benchmarks.push({ brand: candidate.brand, reference: candidate.canonical_reference,
      elapsed_ms: Math.round((performance.now() - started) * 100) / 100 });
  }
  return summary;
}

async function main() {
  if (process.argv.includes('--validate-only')) {
    const catalog = buildCatalog();
    process.stdout.write(`${JSON.stringify({ contract: CONTRACT, parser_version: PARSER_VERSION,
      catalog_references: catalog.length, catalog_sha256: sha256(stable(catalog)), production_writes: 0 })}\n`);
    return;
  }
  const result = await run();
  if (process.env.PHASE7B_OUTPUT) {
    const output = path.resolve(process.env.PHASE7B_OUTPUT);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { BRANDS, CONTRACT, PARSER_VERSION, buildCatalog,
  catalogIndex, classifyObservation, finish, mapLimit, refKey, run, sha256, stable };

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
