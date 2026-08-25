#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { listCanonicalCatalogReferences } = require('../../api/_lib/catalog.js');
const {
  canonicalReferenceKey,
  contract,
  postingIdentityStatus,
  resolvePostingIdentity,
} = require('../../api/_lib/global-customer-data-contract.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function readJson(filePath, fallback = null) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

function exact(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hasImage(row) {
  return Boolean(exact(row.thumbnail_url || row.image_url)
    || (Array.isArray(row.image_urls) && row.image_urls.some(Boolean)));
}

function hasRating(row) {
  return positive(row.dealer_rating ?? row.seller_rating ?? row.rating) !== null
    || ['SOURCE_SUPPLIED', 'SOURCE_FEEDBACK_COUNT'].includes(exact(row.seller_rating_evidence_status).toUpperCase());
}

function passesCustomerPublicationSafety(row) {
  const intent = exact(row.listing_type || row.intent).toUpperCase();
  if (!['WTS', 'WTB'].includes(intent)) return false;
  if (row.data_quality_review_required === true) return false;
  if (row.multi_listing === true && row.multi_listing_release_approved !== true) return false;
  if (exact(row.reference_invalid_reason)) return false;
  if (!resolvePostingIdentity(row)) return false;
  const blockedState = [
    row.listing_status,
    row.publication_state,
    row.verdict,
  ].map(value => exact(value).toUpperCase()).join('|');
  return !/(?:DUPLICATE|SUPERSEDED|SUPPRESSED|REJECTED|PENDING|REVIEW|COMPONENT|BUNDLE)/.test(blockedState);
}

function groupTradingRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = canonicalReferenceKey(row.brand, row.reference);
    if (!exact(row.reference)) continue;
    const current = groups.get(key) || {
      trading_floor_listings: 0,
      trading_floor_wts: 0,
      trading_floor_wtb: 0,
      trading_floor_priced: 0,
      trading_floor_images: 0,
      resolved_posting_identities: 0,
      dealer_identity_review_required: 0,
      customer_safe_published_observations: 0,
      source_backed_dealer_ratings: 0,
    };
    current.trading_floor_listings += 1;
    const intent = exact(row.listing_type || row.intent).toUpperCase();
    if (intent === 'WTS') current.trading_floor_wts += 1;
    if (intent === 'WTB') current.trading_floor_wtb += 1;
    if (positive(row.price_usd ?? row.source_price_amount ?? row.price_original ?? row.price)) current.trading_floor_priced += 1;
    if (hasImage(row)) current.trading_floor_images += 1;
    if (resolvePostingIdentity(row)) current.resolved_posting_identities += 1;
    else current.dealer_identity_review_required += 1;
    if (passesCustomerPublicationSafety(row)) current.customer_safe_published_observations += 1;
    if (hasRating(row)) current.source_backed_dealer_ratings += 1;
    groups.set(key, current);
  }
  return groups;
}

function productionReferencePopulation({ brand, rows, catalogRows, conflicts, snapshotComplete }) {
  const brandCatalog = catalogRows.filter(row => row.brand === brand);
  const catalogKeys = new Set(brandCatalog.map(row => row.key));
  const catalogSearchKeys = [...catalogKeys].map(key => key.split('|')[1]);
  const values = new Set();
  const exactPublished = new Set();
  const customerSafeCanonical = new Set();
  const unresolved = new Set();
  const partial = new Set();
  const invalid = new Set();
  let missingReferenceListings = 0;

  for (const row of rows) {
    const reference = exact(row.reference || row.normalized_reference || row.raw_reference || row.catalog_reference);
    if (!reference) {
      missingReferenceListings += 1;
      continue;
    }
    values.add(reference);
    const key = canonicalReferenceKey(brand, reference);
    const searchKey = key.split('|')[1];
    if (catalogKeys.has(key) && !conflicts.has(key)) {
      exactPublished.add(reference);
      if (passesCustomerPublicationSafety(row)) customerSafeCanonical.add(reference);
    } else if (exact(row.reference_invalid_reason)) {
      invalid.add(reference);
    } else if (searchKey.length >= 4 && catalogSearchKeys.some(candidate => candidate.startsWith(searchKey))) {
      partial.add(reference);
    } else {
      unresolved.add(reference);
    }
  }

  const authoritative = value => snapshotComplete ? value : null;
  return {
    snapshot_complete: snapshotComplete,
    catalog_reference_count: brandCatalog.length,
    catalog_nonconflicting_reference_count: brandCatalog.filter(row => !conflicts.has(row.key)).length,
    customer_safe_canonical_reference_count: authoritative(customerSafeCanonical.size),
    observed_customer_safe_canonical_reference_count: customerSafeCanonical.size,
    production_reference_value_count: authoritative(values.size),
    exact_published_reference_count: authoritative(exactPublished.size),
    unresolved_reference_count: authoritative(unresolved.size),
    partial_reference_count: authoritative(partial.size),
    invalid_reference_count: authoritative(invalid.size),
    missing_reference_listing_count: authoritative(missingReferenceListings),
    observed_production_reference_value_count: values.size,
    observed_exact_published_reference_count: exactPublished.size,
    observed_unresolved_reference_count: unresolved.size,
    observed_partial_reference_count: partial.size,
    observed_invalid_reference_count: invalid.size,
    observed_missing_reference_listing_count: missingReferenceListings,
    production_reference_values: snapshotComplete ? [...values].sort() : null,
    observed_production_reference_values: [...values].sort(),
    customer_safe_canonical_references: snapshotComplete ? [...customerSafeCanonical].sort() : null,
    observed_customer_safe_canonical_references: [...customerSafeCanonical].sort(),
  };
}

function localCatalog() {
  return contract.brands.flatMap(brand => listCanonicalCatalogReferences(brand).map(row => ({
    key: canonicalReferenceKey(brand, row.reference),
    brand,
    model: exact(row.model),
    reference: exact(row.reference),
  })));
}

function completionStatus({ snapshotsComplete, identityConflict, priceRow, trading }) {
  if (!snapshotsComplete) return 'AUDIT_INCOMPLETE';
  if (identityConflict || priceRow?.error) return 'REVIEW_REQUIRED';
  if ((trading?.dealer_identity_review_required || 0) > 0) return 'REVIEW_REQUIRED';
  if (!trading?.trading_floor_listings && !priceRow?.source_observation_count) return 'NO_PUBLISHED_LISTINGS';
  return 'COVERAGE_RECONCILED';
}

function build({ priceReport, priceCheckpoint = {}, tradingReport, tradingCheckpoint }) {
  const priceRows = Array.isArray(priceReport?.rows) ? priceReport.rows : [];
  const deployedCatalogRows = priceRows.map(row => ({
    key: row.key || canonicalReferenceKey(row.brand, row.reference),
    brand: row.brand,
    model: exact(row.model),
    reference: exact(row.reference),
  }));
  const discoveredCatalogRows = [priceReport?.catalog_references, priceCheckpoint?.catalog_references]
    .find(rows => Array.isArray(rows) && rows.length > 0) || [];
  const catalogRows = discoveredCatalogRows.length
    ? discoveredCatalogRows
    : deployedCatalogRows.length && priceReport?.snapshot_complete === true
      ? deployedCatalogRows
      : localCatalog();
  const priceByKey = new Map(priceRows.map(row => [row.key || canonicalReferenceKey(row.brand, row.reference), row]));
  const tradingByBrand = tradingCheckpoint?.brand_state || {};
  const tradingByKey = groupTradingRows(contract.brands.flatMap(brand => tradingByBrand[brand]?.rows || []));
  const conflicts = new Set((priceReport?.catalog_identity_conflicts || priceCheckpoint?.catalog_identity_conflicts || [])
    .map(row => canonicalReferenceKey(row.brand, row.reference)));
  const snapshotsComplete = priceReport?.snapshot_complete === true && tradingReport?.snapshot_complete === true;
  const generatedAt = new Date().toISOString();
  const brandLedgers = {};

  for (const brand of contract.brands) {
    const brandTradingRows = tradingByBrand[brand]?.rows || [];
    const brandTradingComplete = tradingByBrand[brand]?.complete === true;
    const dealerIdentityReviewRequired = brandTradingRows
      .filter(row => postingIdentityStatus(row) === contract.dealer_identity.review_status).length;
    const referencePopulation = productionReferencePopulation({
      brand,
      rows: brandTradingRows,
      catalogRows,
      conflicts,
      snapshotComplete: brandTradingComplete,
    });
    const references = catalogRows.filter(row => row.brand === brand).map(identity => {
      const priceRow = priceByKey.get(identity.key) || null;
      const trading = tradingByKey.get(identity.key) || null;
      return {
        brand,
        canonical_model: identity.model,
        canonical_reference: identity.reference,
        reference_identity: conflicts.has(identity.key) ? 'AMBIGUOUS' : 'VALID_EXACT_REFERENCE',
        trading_floor_listings: trading?.trading_floor_listings ?? 0,
        trading_floor_wts: trading?.trading_floor_wts ?? 0,
        trading_floor_wtb: trading?.trading_floor_wtb ?? 0,
        trading_floor_priced: trading?.trading_floor_priced ?? 0,
        trading_floor_images: trading?.trading_floor_images ?? 0,
        resolved_posting_identities: trading?.resolved_posting_identities ?? 0,
        dealer_identity_review_required: trading?.dealer_identity_review_required ?? 0,
        dealer_identity_status: (trading?.dealer_identity_review_required || 0) > 0
          ? contract.dealer_identity.review_status
          : trading?.trading_floor_listings ? 'RESOLVED' : null,
        customer_safe_published_observations: conflicts.has(identity.key)
          ? 0
          : trading?.customer_safe_published_observations ?? 0,
        source_backed_dealer_ratings: trading?.source_backed_dealer_ratings ?? 0,
        price_research_source_observations: priceRow ? Number(priceRow.source_observation_count || 0) : null,
        price_research_wts_observations: priceRow ? Number(priceRow.wts_observation_count || 0) : null,
        price_research_wtb_observations: priceRow ? Number(priceRow.wtb_observation_count || 0) : null,
        price_research_qualified_wts: priceRow ? Number(priceRow.reference_qualified_wts_count || 0) : null,
        price_research_analytics_ready: priceRow ? priceRow.reference_analytics_ready === true : null,
        price_research_sample_capped: priceRow ? priceRow.sample_capped === true : null,
        completion_status: completionStatus({
          snapshotsComplete,
          identityConflict: conflicts.has(identity.key),
          priceRow,
          trading,
        }),
      };
    });
    const tradingSummary = (tradingReport?.brand_summary || []).find(row => row.brand === brand) || null;
    const priceSummary = (priceReport?.brand_summary || []).find(row => row.brand === brand) || null;
    const brandGates = {
      bounded_price_research_snapshot_complete: priceReport?.snapshot_complete === true,
      trading_floor_cursor_snapshot_complete: tradingReport?.snapshot_complete === true,
      exact_reference_identity: !references.some(row => row.reference_identity !== 'VALID_EXACT_REFERENCE'),
      no_released_reference_outside_catalog: tradingSummary?.released_references_outside_catalog === 0,
      no_duplicate_listing_ids: tradingSummary?.duplicate_ids === 0,
      posting_identity_resolved: brandTradingComplete && dealerIdentityReviewRequired === 0,
      price_research_accounting_reconciles: priceReport?.coverage_accounting_reconciles === true,
      raw_and_historical_data_unchanged: priceReport?.customer_api_writes === 0 && tradingReport?.customer_api_writes === 0,
    };
    brandLedgers[brand] = {
      contract: contract.contract,
      generated_at: generatedAt,
      brand,
      deployment_decision: 'NOT_READY',
      acceptance_gates: brandGates,
      catalog_reference_count: referencePopulation.catalog_reference_count,
      catalog_nonconflicting_reference_count: referencePopulation.catalog_nonconflicting_reference_count,
      customer_safe_canonical_reference_count: referencePopulation.customer_safe_canonical_reference_count,
      observed_customer_safe_canonical_reference_count: referencePopulation.observed_customer_safe_canonical_reference_count,
      production_reference_value_count: referencePopulation.production_reference_value_count,
      exact_published_reference_count: referencePopulation.exact_published_reference_count,
      unresolved_reference_count: referencePopulation.unresolved_reference_count,
      partial_reference_count: referencePopulation.partial_reference_count,
      invalid_reference_count: referencePopulation.invalid_reference_count,
      reference_population: referencePopulation,
      dealer_identity_review_required: brandTradingComplete ? dealerIdentityReviewRequired : null,
      observed_dealer_identity_review_required: dealerIdentityReviewRequired,
      trading_floor_summary: tradingSummary,
      price_research_summary: priceSummary,
      references,
      checksums: {
        reference_coverage_sha256: sha256(references.map(row => JSON.stringify(row)).join('\n')),
      },
    };
  }

  const summary = {
    contract: contract.contract,
    generated_at: generatedAt,
    canonical_project_ref: contract.canonical_project_ref,
    brands: contract.brands,
    snapshot_complete: snapshotsComplete,
    deployment_authorized: false,
    deployment_decisions: Object.fromEntries(contract.brands.map(brand => [brand, brandLedgers[brand].deployment_decision])),
    catalog_reference_counts: Object.fromEntries(contract.brands.map(brand => [brand, brandLedgers[brand].catalog_reference_count])),
    catalog_nonconflicting_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].catalog_nonconflicting_reference_count])),
    customer_safe_canonical_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].customer_safe_canonical_reference_count])),
    observed_customer_safe_canonical_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].observed_customer_safe_canonical_reference_count])),
    source_checksums: {
      price_research: priceReport?.checksums || null,
      trading_floor: tradingReport?.checksums || null,
    },
    safety: {
      raw_messages_modified: 0,
      historical_normalized_values_modified: 0,
      customer_data_sources_switched: 0,
      cohorts_deployed: 0,
      ui_structure_modified: 0,
    },
  };
  summary.result_sha256 = sha256(JSON.stringify({ summary, brandLedgers }));
  return { summary, brandLedgers };
}

function safeName(brand) {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function main() {
  const root = path.resolve(__dirname, '../..');
  const outputDir = path.resolve(process.env.GLOBAL_SIX_BRAND_OUTPUT
    || path.join(root, 'audit-output', 'global-six-brand-completion'));
  const priceReport = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_PRICE_REPORT
    || path.join(outputDir, 'price-research', 'report.json')), {});
  const priceCheckpoint = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_PRICE_CHECKPOINT
    || path.join(outputDir, 'price-research', 'checkpoint.json')), {});
  const tradingReport = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_TF_REPORT
    || path.join(outputDir, 'trading-floor', 'report.json')), {});
  const tradingCheckpoint = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_TF_CHECKPOINT
    || path.join(outputDir, 'trading-floor', 'checkpoint.json')), {});
  const built = build({ priceReport, priceCheckpoint, tradingReport, tradingCheckpoint });
  const ledgerDir = path.join(outputDir, 'ledgers');
  fs.mkdirSync(ledgerDir, { recursive: true });
  for (const brand of contract.brands) {
    fs.writeFileSync(path.join(ledgerDir, `${safeName(brand)}.json`), `${JSON.stringify(built.brandLedgers[brand], null, 2)}\n`);
  }
  fs.writeFileSync(path.join(outputDir, 'completion-summary.json'), `${JSON.stringify(built.summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output_dir: outputDir, snapshot_complete: built.summary.snapshot_complete,
    decisions: built.summary.deployment_decisions, result_sha256: built.summary.result_sha256 })}\n`);
}

module.exports = {
  build,
  groupTradingRows,
  hasImage,
  hasRating,
  passesCustomerPublicationSafety,
  productionReferencePopulation,
};
if (require.main === module) main();
