#!/usr/bin/env node
'use strict';

// Read-only reconciliation of every catalog/reference source used by the six-brand
// completion contract. The tool stores reference identities and aggregate counts
// only. It never writes production and never persists raw listing messages.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalBrand,
  listCanonicalCatalogReferences,
  normalizeRef,
} = require('../../api/_lib/catalog.js');

const BRANDS = ['Rolex', 'Patek Philippe', 'Tudor', 'Zenith', 'Cartier', 'TAG Heuer'];
const BASE_URL = String(process.env.GLOBAL_CATALOG_CENSUS_BASE_URL
  || 'https://watchfacts-poc.vercel.app').replace(/\/$/, '');
const PHASE7B_RUN_KEY = 'phase7b-rolex-patek-verified-20260824-v1';
const PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = 60_000;
const KNOWN_RELEASE_PARTIALS = new Set([
  'TUDOR|25500T',
  'TUDOR|79620',
  'TUDOR|91350',
  'TUDOR|91650',
  'CARTIER|11000',
  'CARTIER|11700',
  'CARTIER|17200',
  'CARTIER|57000',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function key(brand, reference) {
  return `${String(brand || '').trim().toUpperCase()}|${String(reference || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

function referenceKey(reference) {
  return String(reference || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function exact(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.partial`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function rowsFromEnriched(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'public', 'enriched_refs.json'), 'utf8'));
  return (Array.isArray(raw) ? raw : Object.entries(raw).map(([reference, value]) => ({
    ...value,
    reference: value.reference || reference,
  }))).map(row => ({ brand: canonicalBrand(row.brand), reference: exact(row.reference) }));
}

function rowsFromMaster(root) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'api', 'dictionaries', 'master_catalog.json'), 'utf8'));
  return Object.entries(raw).map(([reference, value]) => ({
    brand: canonicalBrand(value.brand),
    reference,
  }));
}

function sourceRows(root) {
  const approved = BRANDS.flatMap(brand => listCanonicalCatalogReferences(brand).map(row => ({
    brand,
    model: row.model,
    reference: row.reference,
  })));
  const legacyCatalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'catalog.json'), 'utf8'))
    .map(row => ({ brand: canonicalBrand(row.brand), reference: exact(row.reference) }));
  return {
    approved_local_canonical_catalog: approved,
    runtime_legacy_catalog_json: legacyCatalog,
    runtime_enriched_refs: rowsFromEnriched(root),
    ingestion_master_catalog: rowsFromMaster(root),
  };
}

async function discoverDeployedCatalog() {
  const references = [];
  const brandMetadata = {};
  for (const brand of BRANDS) {
    const modelsPayload = await fetchJson(`${BASE_URL}/api/catalog-models?brand=${encodeURIComponent(brand)}`);
    const models = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
    const byKey = new Map();
    let unresolvedListingCount = 0;
    let unresolvedPricedWtsCount = 0;
    let suppressedPartialReferenceCount = 0;
    for (const modelRow of models) {
      const model = exact(modelRow.model);
      if (!model) continue;
      const payload = await fetchJson(`${BASE_URL}/api/catalog-references?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`);
      unresolvedListingCount += Number(payload.unresolved_reference_listing_count || 0);
      unresolvedPricedWtsCount += Number(payload.unresolved_reference_priced_wts_count || 0);
      suppressedPartialReferenceCount = Math.max(
        suppressedPartialReferenceCount,
        Number(payload.suppressed_partial_reference_count || 0),
      );
      for (const row of payload.references || []) {
        const reference = exact(row.reference);
        if (!reference) continue;
        const identityKey = key(brand, reference);
        const current = byKey.get(identityKey);
        if (current && current.model !== model) {
          throw new Error(`Deployed catalog model conflict: ${identityKey} (${current.model} / ${model})`);
        }
        byKey.set(identityKey, {
          brand,
          model,
          reference,
          listing_count: Number(row.listing_count || 0),
          identity_source: exact(row.identity_source || payload.identity_source || modelsPayload.identity_source),
        });
      }
    }
    if (byKey.size !== Number(modelsPayload.catalog_reference_count)) {
      throw new Error(`${brand} deployed catalog count mismatch: ${byKey.size} != ${modelsPayload.catalog_reference_count}`);
    }
    const rows = [...byKey.values()].sort((left, right) => key(left.brand, left.reference).localeCompare(key(right.brand, right.reference)));
    references.push(...rows);
    brandMetadata[brand] = {
      catalog_reference_count: rows.length,
      model_count: models.length,
      identity_source: modelsPayload.identity_source || null,
      suppressed_model_conflict_count: Number(modelsPayload.suppressed_model_conflict_count || 0),
      suppressed_partial_reference_count: suppressedPartialReferenceCount,
      unresolved_reference_listing_count: unresolvedListingCount,
      unresolved_reference_priced_wts_count: unresolvedPricedWtsCount,
    };
  }
  return { references, brandMetadata };
}

async function publishedPopulation(brand) {
  const ids = new Set();
  const referenceValues = new Map();
  const intentCounts = { WTS: 0, WTB: 0, OTHER: 0 };
  let cursor = null;
  let pages = 0;
  let advertisedTotal = null;
  let totalStatus = null;
  do {
    const url = new URL('/api/reviewed-market-inventory', BASE_URL);
    url.searchParams.set('brand', brand);
    url.searchParams.set('item', 'watches');
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('pagination', 'cursor');
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await fetchJson(url);
    const payloadTotal = Number(payload.total);
    advertisedTotal = Number.isFinite(payloadTotal) && payloadTotal > 0 ? payloadTotal : advertisedTotal;
    totalStatus = payload.totalStatus || totalStatus;
    for (const row of payload.records || []) {
      const id = exact(row.id);
      if (id) ids.add(id);
      const reference = exact(row.reference);
      const intent = exact(row.listing_type || row.intent).toUpperCase();
      if (reference) {
        const compactReference = referenceKey(reference);
        const current = referenceValues.get(compactReference) || {
          reference,
          listing_count: 0,
          wts_count: 0,
          wtb_count: 0,
        };
        current.listing_count += 1;
        if (intent === 'WTS') current.wts_count += 1;
        if (intent === 'WTB') current.wtb_count += 1;
        referenceValues.set(compactReference, current);
      }
      if (intent === 'WTS' || intent === 'WTB') intentCounts[intent] += 1;
      else intentCounts.OTHER += 1;
    }
    pages += 1;
    cursor = payload.hasMore === true ? exact(payload.nextCursor) : null;
    if (payload.hasMore === true && !cursor) throw new Error(`${brand} cursor response hasMore without nextCursor`);
  } while (cursor);
  return {
    brand,
    listing_count: ids.size,
    advertised_total: advertisedTotal,
    total_status: totalStatus,
    snapshot_complete: advertisedTotal === null || ids.size === advertisedTotal,
    advertised_count_gap: advertisedTotal === null ? null : advertisedTotal - ids.size,
    pages,
    intent_counts: intentCounts,
    references: [...referenceValues.values()].sort((left, right) => left.reference.localeCompare(right.reference)),
    listing_ids_sha256: sha256([...ids].sort().join('\n')),
  };
}

function classify(reference, brand, authoritativeKeys, aliasMap) {
  const identityKey = key(brand, reference);
  const compact = referenceKey(reference);
  if (authoritativeKeys.has(identityKey)) return 'EXACT';
  if (aliasMap.has(identityKey)) return 'ALIAS';
  if (/\b(?:BRACELET|STRAP|LINK|CLASP|BUCKLE|DIAL|BEZEL|BOX)\b/i.test(String(reference))) return 'COMPONENT';
  if (KNOWN_RELEASE_PARTIALS.has(identityKey)) return 'PARTIAL';
  const brandKeys = [...authoritativeKeys]
    .filter(item => item.startsWith(`${brand.toUpperCase()}|`))
    .map(item => item.split('|')[1]);
  if (compact.length >= 4 && brandKeys.some(candidate => candidate.startsWith(compact) || compact.startsWith(candidate))) {
    return 'PARTIAL';
  }
  if (!compact || compact.length < 4 || !/\d/.test(compact)
    || /(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|JPY|CAD|AUD)/i.test(String(reference))) return 'INVALID';
  return 'UNRESOLVED';
}

function summarizeSource(brand, source, rows, authoritativeKeys, aliasMap, _allOtherKeys) {
  const byKey = new Map();
  for (const row of rows.filter(item => canonicalBrand(item.brand) === brand)) {
    const reference = exact(row.reference);
    if (!reference) continue;
    byKey.set(key(brand, reference), { reference, model: row.model || null, identity_source: row.identity_source || null });
  }
  const classes = { EXACT: [], ALIAS: [], PARTIAL: [], COMPONENT: [], INVALID: [], UNRESOLVED: [] };
  for (const [identityKey, row] of byKey) classes[classify(row.reference, brand, authoritativeKeys, aliasMap)].push(row.reference);
  for (const values of Object.values(classes)) values.sort();
  const exactOverlapAuthoritative = [...byKey.keys()].filter(identityKey => authoritativeKeys.has(identityKey)).length;
  const unique = [...byKey.entries()]
    .filter(([identityKey]) => !authoritativeKeys.has(identityKey))
    .map(([, row]) => row.reference)
    .sort();
  return {
    brand,
    source,
    reference_count: byKey.size,
    exact_overlap: exactOverlapAuthoritative,
    unique_references: unique.length,
    aliases: classes.ALIAS.length,
    partials: classes.PARTIAL.length,
    components: classes.COMPONENT.length,
    invalids: classes.INVALID.length,
    unresolved: classes.UNRESOLVED.length,
    exact_authoritative: classes.EXACT.length,
    references_sha256: sha256([...byKey.keys()].sort().join('\n')),
    references_by_classification: classes,
    source_unique_reference_values: unique,
  };
}

function phase7Evidence(root) {
  const directory = path.join(root, 'audit-output', 'global-six-brand-completion', 'phase7b-rolex-patek-authoritative');
  const audit = JSON.parse(fs.readFileSync(path.join(directory, 'audit.json'), 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(path.join(directory, 'artifact.json'), 'utf8'));
  if (audit.complete !== true || audit.run_key !== PHASE7B_RUN_KEY) throw new Error('Accepted Phase 7B evidence is incomplete or uses the wrong run key');
  return { audit, rows: artifact.manifest.datasets.reference_census || [] };
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const localSources = sourceRows(root);
  const curation = JSON.parse(fs.readFileSync(path.join(root, 'api', 'dictionaries', 'catalog-curation.json'), 'utf8'));
  const phase7 = phase7Evidence(root);
  const deployed = await discoverDeployedCatalog();
  const publishedCensuses = {};
  for (const brand of ['Tudor', 'Zenith', 'Cartier', 'TAG Heuer']) {
    publishedCensuses[brand] = await publishedPopulation(brand);
  }
  const aliasMap = new Map((curation.aliases || []).map(row => [key(row.brand, row.alias), row]));

  const authoritativeRows = [];
  for (const brand of BRANDS) {
    if (brand === 'Rolex' || brand === 'Patek Philippe') {
      authoritativeRows.push(...phase7.rows.filter(row => row.brand === brand).map(row => ({
        brand,
        model: row.canonical_model,
        reference: row.canonical_reference,
        published_listing_count: Number(row.total_published_listings || 0),
        published_wts_count: Number(row.wts_listings || 0),
        published_wtb_count: Number(row.wtb_listings || 0),
        authority: 'PHASE7B_AUTHORITATIVE_CATALOG',
      })));
    } else {
      authoritativeRows.push(...localSources.approved_local_canonical_catalog.filter(row => row.brand === brand).map(row => ({
        brand,
        model: row.model,
        reference: row.reference,
        authority: 'APPROVED_LOCAL_CANONICAL_CATALOG',
      })));
    }
  }
  const authoritativeKeys = new Set(authoritativeRows.map(row => key(row.brand, row.reference)));
  if (authoritativeKeys.size !== authoritativeRows.length) throw new Error('Authoritative catalog contains duplicate brand/reference keys');

  const releaseManifestRows = deployed.references.filter(row => /(?:RELEASE|REVIEWED_WORKBOOK)/i.test(row.identity_source));
  const phase7Rows = phase7.rows.map(row => ({ brand: row.brand, model: row.canonical_model, reference: row.canonical_reference }));
  const curationRows = [
    ...(curation.overrides || []).map(row => ({ brand: row.brand, reference: row.reference, curation_type: 'OVERRIDE' })),
    ...(curation.aliases || []).map(row => ({ brand: row.brand, reference: row.alias, curation_type: 'ALIAS' })),
  ];
  const publishedRows = [];
  for (const row of phase7.rows.filter(row => Number(row.total_published_listings || 0) > 0)) {
    publishedRows.push({
      brand: row.brand,
      reference: row.canonical_reference,
      listing_count: Number(row.total_published_listings || 0),
      wts_count: Number(row.wts_listings || 0),
      wtb_count: Number(row.wtb_listings || 0),
    });
  }
  for (const [brand, census] of Object.entries(publishedCensuses)) {
    for (const row of census.references) publishedRows.push({ brand, ...row });
  }

  const sources = {
    ...localSources,
    deployed_price_research_catalog_api: deployed.references,
    production_release_manifests: releaseManifestRows,
    phase7b_authoritative_catalog: phase7Rows,
    curated_aliases_and_overrides: curationRows,
    exact_published_production_reference_population: publishedRows,
  };
  const sourceKeys = Object.fromEntries(Object.entries(sources).map(([source, rows]) => [source,
    new Set(rows.map(row => key(canonicalBrand(row.brand), row.reference)).filter(value => !value.endsWith('|')))]));
  const reconciliation = [];
  for (const brand of BRANDS) {
    for (const [source, rows] of Object.entries(sources)) {
      const allOtherKeys = new Set(Object.entries(sourceKeys)
        .filter(([other]) => other !== source)
        .flatMap(([, values]) => [...values]));
      reconciliation.push(summarizeSource(brand, source, rows, authoritativeKeys, aliasMap, allOtherKeys));
    }
  }

  const brandSummary = BRANDS.map(brand => {
    const authoritative = authoritativeRows.filter(row => row.brand === brand);
    const local = localSources.approved_local_canonical_catalog.filter(row => row.brand === brand);
    const deployedRows = deployed.references.filter(row => row.brand === brand);
    const published = publishedRows.filter(row => row.brand === brand);
    const localKeys = new Set(local.map(row => key(brand, row.reference)));
    const deployedKeys = new Set(deployedRows.map(row => key(brand, row.reference)));
    const exactOverlap = [...localKeys].filter(identityKey => deployedKeys.has(identityKey)).length;
    const publishedClassification = summarizeSource(
      brand,
      'exact_published_production_reference_population',
      publishedRows,
      authoritativeKeys,
      aliasMap,
      new Set(),
    );
    return {
      brand,
      authoritative_catalog_reference_count: authoritative.length,
      authoritative_source: brand === 'Rolex' || brand === 'Patek Philippe'
        ? 'PHASE7B_AUTHORITATIVE_CATALOG'
        : 'APPROVED_LOCAL_CANONICAL_CATALOG',
      approved_local_canonical_reference_count: local.length,
      deployed_price_research_catalog_reference_count: deployedRows.length,
      exact_local_deployed_overlap: exactOverlap,
      local_only_references: [...localKeys].filter(identityKey => !deployedKeys.has(identityKey)).length,
      deployed_only_references: [...deployedKeys].filter(identityKey => !localKeys.has(identityKey)).length,
      exact_published_reference_count: publishedClassification.exact_authoritative,
      observed_exact_published_reference_count: publishedClassification.exact_authoritative,
      published_population_snapshot_complete: publishedCensuses[brand]?.snapshot_complete
        ?? (brand === 'Rolex' || brand === 'Patek Philippe'),
      published_alias_count: publishedClassification.aliases,
      published_partial_count: publishedClassification.partials,
      published_component_count: publishedClassification.components,
      published_invalid_count: publishedClassification.invalids,
      published_unresolved_count: publishedClassification.unresolved,
      observed_catalog_universe_count: new Set(Object.values(sourceKeys).flatMap(values => [...values])
        .filter(identityKey => identityKey.startsWith(`${brand.toUpperCase()}|`))).size,
      deployed_metadata: deployed.brandMetadata[brand],
      catalog_reference_count_definition:
        'Distinct exact brand/reference identities in the accepted authoritative source after alias collapse and explicit partial/component/invalid exclusion.',
    };
  });

  for (const row of brandSummary) {
    if (row.published_population_snapshot_complete !== true) row.exact_published_reference_count = null;
  }

  const report = {
    contract: 'watchfacts-global-catalog-census-reconciliation-v1',
    generated_at: new Date().toISOString(),
    read_only: true,
    canonical_project_ref: 'qnsafosakvonzgfcsphh',
    base_url: BASE_URL,
    phase7b_run_key: PHASE7B_RUN_KEY,
    phase7b_rerun: false,
    complete: true,
    catalog_reconciliation_complete: true,
    published_population_complete: brandSummary.every(row => row.published_population_snapshot_complete === true),
    catalog_reference_count_definition:
      'Distinct exact brand/reference identities in the accepted authoritative source after alias collapse and explicit partial/component/invalid exclusion.',
    source_of_truth_policy: {
      Rolex: 'Completed Phase 7B authoritative catalog',
      'Patek Philippe': 'Completed Phase 7B authoritative catalog',
      Tudor: 'Approved local canonical catalog; the larger deployed browse union remains a separately classified production-observed universe',
      Zenith: 'Approved local canonical catalog; exact match to the deployed catalog API',
      Cartier: 'Approved local canonical catalog; the larger deployed browse union remains a separately classified production-observed universe',
      'TAG Heuer': 'Approved local canonical catalog; the larger deployed browse union remains a separately classified owner-reviewed production universe',
    },
    brand_summary: brandSummary,
    source_reconciliation: reconciliation,
    authoritative_catalog: authoritativeRows.sort((left, right) => key(left.brand, left.reference).localeCompare(key(right.brand, right.reference))),
    exact_published_production_reference_population: publishedRows.sort((left, right) => key(left.brand, left.reference).localeCompare(key(right.brand, right.reference))),
    curated_aliases: curation.aliases || [],
    curated_overrides: curation.overrides || [],
    published_censuses: publishedCensuses,
    checksums: {
      authoritative_catalog_sha256: sha256(authoritativeRows.map(row => `${key(row.brand, row.reference)}|${row.model || ''}`).sort().join('\n')),
      source_reconciliation_sha256: sha256(reconciliation.map(row => JSON.stringify(row)).join('\n')),
      published_reference_population_sha256: sha256(publishedRows.map(row => key(row.brand, row.reference)).sort().join('\n')),
    },
    safety: {
      production_writes: 0,
      raw_messages_persisted: 0,
      normalized_values_modified: 0,
      customer_sources_switched: 0,
      cohorts_deployed: 0,
      ui_changes: 0,
    },
  };
  const outputPath = path.resolve(process.env.GLOBAL_CATALOG_CENSUS_OUTPUT
    || path.join(root, 'audit-output', 'global-six-brand-completion', 'catalog-census-reconciliation.json'));
  atomicJson(outputPath, report);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    complete: report.complete,
    counts: Object.fromEntries(brandSummary.map(row => [row.brand, row.authoritative_catalog_reference_count])),
    sha256: report.checksums.authoritative_catalog_sha256,
  })}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { BRANDS, classify, summarizeSource };
