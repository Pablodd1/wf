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

function phase7bDatasets(phase7bArtifact = {}) {
  return phase7bArtifact?.manifest?.datasets || {};
}

function phase7bBrandSummary(brand, audit = {}, datasets = {}) {
  if (audit?.complete !== true || !['Rolex', 'Patek Philippe'].includes(brand)) return null;
  const classifications = (datasets.classification_mix || audit.classifications || [])
    .filter(row => row.brand === brand);
  const sourceObservations = classifications.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const verifiedObservations = Number(audit.verified_observations?.[brand] || 0);
  const referenceRows = (datasets.reference_census || []).filter(row => row.brand === brand);
  return {
    source_observations: sourceObservations,
    processed_observations: sourceObservations,
    verified_observations: verifiedObservations,
    verification_rate: sourceObservations ? verifiedObservations / sourceObservations : 0,
    catalog_reference_count: Number(audit.customer_safe_reference_counts?.[brand] || 0),
    represented_customer_safe_reference_count:
      Number(audit.represented_customer_safe_reference_counts?.[brand] || 0),
    published_customer_safe_reference_count:
      referenceRows.filter(row => Number(row.total_published_listings || 0) > 0).length,
    verified_price_research_reference_count:
      referenceRows.filter(row => Number(row.verified_pr_observations || 0) > 0).length,
    total_published_listings: referenceRows.reduce((sum, row) => sum + Number(row.total_published_listings || 0), 0),
    wts_listings: referenceRows.reduce((sum, row) => sum + Number(row.wts_listings || 0), 0),
    wtb_listings: referenceRows.reduce((sum, row) => sum + Number(row.wtb_listings || 0), 0),
    priced_listings: referenceRows.reduce((sum, row) => sum + Number(row.priced_listings || 0), 0),
    image_linked_listings: referenceRows.reduce((sum, row) => sum + Number(row.image_linked_listings || 0), 0),
    legacy_price_research_observations:
      referenceRows.reduce((sum, row) => sum + Number(row.legacy_pr_observations || 0), 0),
    verified_price_research_observations:
      referenceRows.reduce((sum, row) => sum + Number(row.verified_pr_observations || 0), 0),
    current_qualified_comparable_observations:
      referenceRows.reduce((sum, row) => sum + Number(row.current_qualified_comparable_count || 0), 0),
    verified_qualified_comparable_observations:
      referenceRows.reduce((sum, row) => sum + Number(row.verified_qualified_comparable_count || 0), 0),
    current_analytics_ready_references: referenceRows.filter(row => row.current_analytics_ready === true).length,
    verified_analytics_ready_references: referenceRows.filter(row => row.verified_analytics_ready === true).length,
    classifications,
    rating_impact: (datasets.rating_impact || audit.rating_impact || []).filter(row => row.brand === brand),
    proposed_canaries: (datasets.proposed_canaries || audit.proposed_canaries || []).filter(row => row.brand === brand),
    query_benchmarks: (datasets.query_benchmarks || audit.query_benchmarks || []).filter(row => row.brand === brand),
  };
}

function build({
  priceReport,
  priceCheckpoint = {},
  tradingReport,
  tradingCheckpoint,
  phase7bAudit = {},
  phase7bArtifact = {},
  catalogReconciliation = {},
}) {
  const priceRows = Array.isArray(priceReport?.rows) ? priceReport.rows : [];
  const deployedCatalogRows = priceRows.map(row => ({
    key: row.key || canonicalReferenceKey(row.brand, row.reference),
    brand: row.brand,
    model: exact(row.model),
    reference: exact(row.reference),
  }));
  const discoveredCatalogRows = [priceReport?.catalog_references, priceCheckpoint?.catalog_references]
    .find(rows => Array.isArray(rows) && rows.length > 0) || [];
  const reconciledCatalogRows = catalogReconciliation?.catalog_reconciliation_complete === true
    && Array.isArray(catalogReconciliation.authoritative_catalog)
    ? catalogReconciliation.authoritative_catalog.map(row => ({
      key: canonicalReferenceKey(row.brand, row.reference),
      brand: row.brand,
      model: exact(row.model),
      reference: exact(row.reference),
    }))
    : [];
  const catalogRows = reconciledCatalogRows.length
    ? reconciledCatalogRows
    : discoveredCatalogRows.length ? discoveredCatalogRows
    : deployedCatalogRows.length && priceReport?.snapshot_complete === true
      ? deployedCatalogRows
      : localCatalog();
  const priceByKey = new Map(priceRows.map(row => [row.key || canonicalReferenceKey(row.brand, row.reference), row]));
  const tradingByBrand = tradingCheckpoint?.brand_state || {};
  const tradingByKey = groupTradingRows(contract.brands.flatMap(brand => tradingByBrand[brand]?.rows || []));
  const conflicts = reconciledCatalogRows.length ? new Set()
    : new Set((priceReport?.catalog_identity_conflicts || priceCheckpoint?.catalog_identity_conflicts || [])
      .map(row => canonicalReferenceKey(row.brand, row.reference)));
  const snapshotsComplete = priceReport?.snapshot_complete === true && tradingReport?.snapshot_complete === true;
  const phase7BaseComplete = phase7bAudit?.phase === '7B'
    && phase7bAudit?.complete === true
    && phase7bAudit?.run_key === 'phase7b-rolex-patek-verified-20260824-v1'
    && Number(phase7bAudit?.production_mutations) === 0
    && Number(phase7bAudit?.customer_source_switches) === 0
    && Number(phase7bAudit?.ui_changes) === 0;
  const phase7Datasets = phase7bDatasets(phase7bArtifact);
  const phase7References = Array.isArray(phase7Datasets.reference_census)
    ? phase7Datasets.reference_census
    : [];
  const phase7ReferenceKeys = phase7References.map(row => canonicalReferenceKey(row.brand, row.canonical_reference));
  const phase7bComplete = phase7BaseComplete
    && new Set(phase7ReferenceKeys).size === phase7ReferenceKeys.length
    && ['Rolex', 'Patek Philippe'].every(brand => phase7References.filter(row => row.brand === brand).length
      === Number(phase7bAudit.customer_safe_reference_counts?.[brand] ?? -1));
  const phase7ByKey = new Map(phase7References.map(row => [canonicalReferenceKey(row.brand, row.canonical_reference), row]));
  const catalogPublishedRows = Array.isArray(catalogReconciliation?.exact_published_production_reference_population)
    ? catalogReconciliation.exact_published_production_reference_population
    : [];
  const catalogPublishedByKey = new Map(catalogPublishedRows.map(row => [
    canonicalReferenceKey(row.brand, row.reference),
    row,
  ]));
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
    const phase7Summary = phase7bComplete ? phase7bBrandSummary(brand, phase7bAudit, phase7Datasets) : null;
    const catalogCensus = (catalogReconciliation?.brand_summary || []).find(row => row.brand === brand) || null;
    const phase7BrandReferences = phase7Summary ? phase7References.filter(row => row.brand === brand) : [];
    const phase7PublishedReferences = phase7BrandReferences
      .filter(row => Number(row.total_published_listings || 0) > 0)
      .map(row => row.canonical_reference)
      .sort();
    if (phase7Summary) {
      referencePopulation.authoritative_phase7b_snapshot_complete = true;
      referencePopulation.customer_safe_canonical_reference_count = phase7PublishedReferences.length;
      referencePopulation.observed_customer_safe_canonical_reference_count = phase7PublishedReferences.length;
      referencePopulation.exact_published_reference_count = phase7PublishedReferences.length;
      referencePopulation.observed_exact_published_reference_count = phase7PublishedReferences.length;
      referencePopulation.customer_safe_canonical_references = phase7PublishedReferences;
      referencePopulation.observed_customer_safe_canonical_references = phase7PublishedReferences;
    }
    if (catalogCensus) {
      referencePopulation.catalog_reconciliation_complete = true;
      referencePopulation.approved_local_canonical_reference_count =
        catalogCensus.approved_local_canonical_reference_count;
      referencePopulation.deployed_price_research_catalog_reference_count =
        catalogCensus.deployed_price_research_catalog_reference_count;
      referencePopulation.exact_local_deployed_overlap = catalogCensus.exact_local_deployed_overlap;
      referencePopulation.local_only_reference_count = catalogCensus.local_only_references;
      referencePopulation.deployed_only_reference_count = catalogCensus.deployed_only_references;
      referencePopulation.observed_catalog_universe_count = catalogCensus.observed_catalog_universe_count;
      referencePopulation.exact_published_reference_count = catalogCensus.exact_published_reference_count;
      referencePopulation.observed_exact_published_reference_count =
        catalogCensus.observed_exact_published_reference_count;
      referencePopulation.published_population_snapshot_complete =
        catalogCensus.published_population_snapshot_complete;
      referencePopulation.observed_partial_reference_count = catalogCensus.published_partial_count;
      referencePopulation.observed_invalid_reference_count = catalogCensus.published_invalid_count;
      referencePopulation.observed_unresolved_reference_count = catalogCensus.published_unresolved_count;
      referencePopulation.observed_component_reference_count = catalogCensus.published_component_count;
    }
    const references = catalogRows.filter(row => row.brand === brand).map(identity => {
      const priceRow = priceByKey.get(identity.key) || null;
      const trading = tradingByKey.get(identity.key) || null;
      const phase7 = phase7Summary ? phase7ByKey.get(identity.key) || null : null;
      const catalogPublished = catalogCensus ? catalogPublishedByKey.get(identity.key) || null : null;
      const censusObserved = phase7 || catalogPublished;
      return {
        brand,
        canonical_model: identity.model,
        canonical_reference: identity.reference,
        reference_identity: conflicts.has(identity.key) ? 'AMBIGUOUS' : 'VALID_EXACT_REFERENCE',
        trading_floor_listings: phase7 ? Number(phase7.total_published_listings || 0)
          : catalogPublished ? Number(catalogPublished.listing_count || 0) : trading?.trading_floor_listings ?? 0,
        trading_floor_wts: phase7 ? Number(phase7.wts_listings || 0)
          : catalogPublished ? Number(catalogPublished.wts_count || 0) : trading?.trading_floor_wts ?? 0,
        trading_floor_wtb: phase7 ? Number(phase7.wtb_listings || 0)
          : catalogPublished ? Number(catalogPublished.wtb_count || 0) : trading?.trading_floor_wtb ?? 0,
        trading_floor_priced: phase7 ? Number(phase7.priced_listings || 0)
          : catalogPublished ? null : trading?.trading_floor_priced ?? 0,
        trading_floor_images: phase7 ? Number(phase7.image_linked_listings || 0)
          : catalogPublished ? null : trading?.trading_floor_images ?? 0,
        resolved_posting_identities: censusObserved ? null : trading?.resolved_posting_identities ?? 0,
        dealer_identity_review_required: censusObserved ? null : trading?.dealer_identity_review_required ?? 0,
        dealer_identity_status: phase7 ? 'NOT_AUDITED_BY_PHASE7B'
          : catalogPublished ? 'NOT_AUDITED_BY_CATALOG_CENSUS'
          : (trading?.dealer_identity_review_required || 0) > 0
            ? contract.dealer_identity.review_status
            : trading?.trading_floor_listings ? 'RESOLVED' : null,
        customer_safe_published_observations: censusObserved ? null : conflicts.has(identity.key)
          ? 0
          : trading?.customer_safe_published_observations ?? 0,
        source_backed_dealer_ratings: censusObserved ? null : trading?.source_backed_dealer_ratings ?? 0,
        price_research_source_observations: phase7 ? Number(phase7.legacy_pr_observations || 0)
          : priceRow ? Number(priceRow.source_observation_count || 0) : null,
        price_research_wts_observations: phase7 ? Number(phase7.legacy_pr_observations || 0)
          : priceRow ? Number(priceRow.wts_observation_count || 0) : null,
        price_research_wtb_observations: phase7 ? 0
          : priceRow ? Number(priceRow.wtb_observation_count || 0) : null,
        price_research_qualified_wts: phase7 ? Number(phase7.current_qualified_comparable_count || 0)
          : priceRow ? Number(priceRow.reference_qualified_wts_count || 0) : null,
        price_research_analytics_ready: phase7 ? phase7.current_analytics_ready === true
          : priceRow ? priceRow.reference_analytics_ready === true : null,
        price_research_sample_capped: priceRow ? priceRow.sample_capped === true : null,
        phase7b_verified_shadow: phase7 ? {
          publication_contract: phase7.publication_contract,
          verified_price_research_observations: Number(phase7.verified_pr_observations || 0),
          review_required_observations: Number(phase7.review_required_observations || 0),
          excluded_observations: Number(phase7.excluded_observations || 0),
          current_observation_count: Number(phase7.current_observation_count || 0),
          verified_observation_count: Number(phase7.verified_observation_count || 0),
          current_qualified_comparable_count: Number(phase7.current_qualified_comparable_count || 0),
          verified_qualified_comparable_count: Number(phase7.verified_qualified_comparable_count || 0),
          current_analytics_ready: phase7.current_analytics_ready === true,
          verified_analytics_ready: phase7.verified_analytics_ready === true,
          current_median: phase7.current_median,
          verified_median: phase7.verified_median,
          current_mean: phase7.current_mean,
          verified_mean: phase7.verified_mean,
          current_min: phase7.current_min,
          verified_min: phase7.verified_min,
          current_max: phase7.current_max,
          verified_max: phase7.verified_max,
          census_sha256: phase7.census_sha256,
        } : null,
        catalog_census_observed_publication: catalogPublished && !phase7 ? {
          listing_count: Number(catalogPublished.listing_count || 0),
          wts_count: Number(catalogPublished.wts_count || 0),
          wtb_count: Number(catalogPublished.wtb_count || 0),
          snapshot_complete: catalogCensus.published_population_snapshot_complete === true,
        } : null,
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
      bounded_price_research_snapshot_complete: phase7Summary ? true : priceReport?.snapshot_complete === true,
      authoritative_phase7b_reference_census_complete: Boolean(phase7Summary),
      trading_floor_cursor_snapshot_complete: tradingReport?.snapshot_complete === true,
      exact_reference_identity: !references.some(row => row.reference_identity !== 'VALID_EXACT_REFERENCE'),
      no_released_reference_outside_catalog: tradingSummary?.released_references_outside_catalog === 0,
      no_duplicate_listing_ids: tradingSummary?.duplicate_ids === 0,
      posting_identity_resolved: brandTradingComplete && dealerIdentityReviewRequired === 0,
      price_research_accounting_reconciles: phase7Summary ? true : priceReport?.coverage_accounting_reconciles === true,
      raw_and_historical_data_unchanged: phase7Summary
        ? Number(phase7bAudit.production_mutations) === 0
        : priceReport?.customer_api_writes === 0 && tradingReport?.customer_api_writes === 0,
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
      phase7b_verified_shadow: phase7Summary,
      catalog_census_reconciliation: catalogCensus,
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
    catalog_reference_count_definition: catalogReconciliation?.catalog_reference_count_definition
      || 'total_canonical_references_in_approved_catalog',
    catalog_reference_counts: Object.fromEntries(contract.brands.map(brand => [brand, brandLedgers[brand].catalog_reference_count])),
    approved_local_canonical_reference_counts: Object.fromEntries(contract.brands.map(brand => [
      brand,
      brandLedgers[brand].catalog_census_reconciliation?.approved_local_canonical_reference_count
        ?? brandLedgers[brand].catalog_reference_count,
    ])),
    deployed_price_research_catalog_reference_counts: Object.fromEntries(contract.brands.map(brand => [
      brand,
      brandLedgers[brand].catalog_census_reconciliation?.deployed_price_research_catalog_reference_count ?? null,
    ])),
    observed_catalog_universe_counts: Object.fromEntries(contract.brands.map(brand => [
      brand,
      brandLedgers[brand].catalog_census_reconciliation?.observed_catalog_universe_count ?? null,
    ])),
    exact_published_reference_counts: Object.fromEntries(contract.brands.map(brand => [
      brand,
      brandLedgers[brand].exact_published_reference_count,
    ])),
    observed_exact_published_reference_counts: Object.fromEntries(contract.brands.map(brand => [
      brand,
      brandLedgers[brand].reference_population.observed_exact_published_reference_count,
    ])),
    catalog_nonconflicting_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].catalog_nonconflicting_reference_count])),
    customer_safe_canonical_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].customer_safe_canonical_reference_count])),
    observed_customer_safe_canonical_reference_counts: Object.fromEntries(contract.brands
      .map(brand => [brand, brandLedgers[brand].observed_customer_safe_canonical_reference_count])),
    source_checksums: {
      price_research: priceReport?.checksums || null,
      trading_floor: tradingReport?.checksums || null,
      phase7b_result_sha256: phase7bComplete ? phase7bAudit.result_sha256 : null,
      phase7b_catalog_sha256: phase7bComplete ? phase7bAudit.catalog_sha256 : null,
      catalog_census_authoritative_sha256: catalogReconciliation?.checksums?.authoritative_catalog_sha256 || null,
      catalog_census_source_reconciliation_sha256:
        catalogReconciliation?.checksums?.source_reconciliation_sha256 || null,
    },
    phase7b_verified_shadow: phase7bComplete ? {
      complete: true,
      decision: phase7bAudit.decision,
      run_key: phase7bAudit.run_key,
      generated_at: phase7bAudit.generated_at,
      result_sha256: phase7bAudit.result_sha256,
      catalog_sha256: phase7bAudit.catalog_sha256,
      customer_source_switches: phase7bAudit.customer_source_switches,
      production_mutations: phase7bAudit.production_mutations,
      ui_changes: phase7bAudit.ui_changes,
      brand_summaries: Object.fromEntries(['Rolex', 'Patek Philippe'].map(brand => [
        brand,
        brandLedgers[brand].phase7b_verified_shadow,
      ])),
    } : null,
    catalog_census_reconciliation: catalogReconciliation?.catalog_reconciliation_complete === true ? {
      complete: true,
      generated_at: catalogReconciliation.generated_at,
      definition: catalogReconciliation.catalog_reference_count_definition,
      authoritative_catalog_sha256: catalogReconciliation.checksums?.authoritative_catalog_sha256 || null,
      published_population_complete: catalogReconciliation.published_population_complete === true,
    } : null,
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
  const phase7bDir = path.join(outputDir, 'phase7b-rolex-patek-authoritative');
  const phase7bAudit = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_PHASE7B_AUDIT
    || path.join(phase7bDir, 'audit.json')), {});
  const phase7bArtifact = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_PHASE7B_ARTIFACT
    || path.join(phase7bDir, 'artifact.json')), {});
  const catalogReconciliation = readJson(path.resolve(process.env.GLOBAL_SIX_BRAND_CATALOG_RECONCILIATION
    || path.join(outputDir, 'catalog-census-reconciliation.json')), {});
  const built = build({
    priceReport,
    priceCheckpoint,
    tradingReport,
    tradingCheckpoint,
    phase7bAudit,
    phase7bArtifact,
    catalogReconciliation,
  });
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
