'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { sha256 } = require('./raw-first-observation-v3-lib.cjs');
const {
  classifyOfferFamily,
  displayTier,
  explicitBrandConflict,
  isQualifiedComparable,
  isVerifiedUsd,
  terminalClassification,
} = require('./current-inventory-shadow-lib.cjs');

const CONTRACT = 'curated-luxury-rolex-patek-final-freeze-v1';
const SOURCE_CONTRACT = 'watchfacts-current-inventory-shadow-v1';
const BRANDS = ['Rolex', 'Patek Philippe'];
const EXPECTED_SOURCE_RUN = '32934432129';
const DEFAULT_CONFIRMED = { Rolex: 221830, 'Patek Philippe': 108890 };
const DEFAULT_WEBSITE_FLOORS = { Rolex: 281480, 'Patek Philippe': 126571 };

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeGzip(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify(value)}\n`, { level: 9 }));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzip(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

function artifactChecksum(file) {
  return sha256(fs.readFileSync(file).toString('base64'));
}

function requireFile(file, label = file) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}`);
  return file;
}

function verifiedManifestFile(root, manifestByPath, relative) {
  const metadata = manifestByPath.get(relative);
  if (!metadata) throw new Error(`Source manifest missing ${relative}`);
  const file = requireFile(path.join(root, relative), relative);
  const bytes = fs.statSync(file).size;
  const checksum = artifactChecksum(file);
  if (bytes !== metadata.bytes || checksum !== metadata.sha256) {
    throw new Error(`Source artifact checksum mismatch: ${relative}`);
  }
  return file;
}

function lineageDefects(row) {
  const defects = [];
  for (const key of ['offer_family_key', 'offer_state_key', 'raw_occurrence_key', 'unique_observation_key',
    'exact_child_text_sha256', 'parent_raw_text_sha256', 'parent_key', 'source_key']) {
    if (!String(row[key] || '').trim()) defects.push(`MISSING_${key.toUpperCase()}`);
  }
  if (!BRANDS.includes(row.brand)) defects.push('INVALID_BRAND');
  if (!['WTS', 'WTB'].includes(row.intent)) defects.push('INVALID_INTENT');
  if (!row.live_source_verified) defects.push('SOURCE_NOT_LIVE_RECHECKED');
  if (!row.source_timestamp || !Number.isFinite(Date.parse(row.source_timestamp))) defects.push('INVALID_SOURCE_TIMESTAMP');
  if (terminalClassification(row)) defects.push('TERMINAL_LATEST_STATE');
  if (explicitBrandConflict({ observed_brand: row.brand, exact_observed_reference: row.observed_reference })) {
    defects.push('FOREIGN_REFERENCE_CONFLICT');
  }
  return defects;
}

function rescueLatestObserved(family) {
  if (family.current_status !== 'CURRENT_LATEST_STATE') {
    return { eligible: false, defects: ['NOT_CURRENT_LATEST_STATE'] };
  }
  const defects = lineageDefects(family.latest_observation);
  return { eligible: defects.length === 0, defects };
}

function publicRow(family, sourceRow, cohortStatus) {
  const verifiedPrice = isVerifiedUsd(sourceRow);
  return {
    ...sourceRow,
    current_listing_key: family.offer_family_key,
    offer_family_key: family.offer_family_key,
    offer_state_key: family.latest_observation.offer_state_key,
    current_status: cohortStatus,
    cohort_status: cohortStatus,
    price_verified: verifiedPrice,
    normalized_usd_amount: verifiedPrice ? Number(sourceRow.source_price_amount) : null,
  };
}

function initialBrandStats() {
  return {
    confirmed_current: 0,
    latest_observed_rescued: 0,
    final_publishable: 0,
    parked_latest_observed: 0,
    wts: 0,
    wtb: 0,
    verified_priced: 0,
    image_linked: 0,
    dealer_linked: 0,
    location_resolved: 0,
    display_readiness: { IMAGE_AND_PRICE: 0, IMAGE_ONLY: 0, PRICE_ONLY: 0, NEITHER: 0 },
    qualified_price_research_observations: 0,
    comparable_reference_counts: new Map(),
    current_reference_counts: new Map(),
    reference_samples: new Map(),
    canary_pool: [],
    parked_reasons: {},
  };
}

function incrementParked(stats, defects) {
  stats.parked_latest_observed += 1;
  for (const defect of defects) stats.parked_reasons[defect] = (stats.parked_reasons[defect] || 0) + 1;
}

function updatePublishable(stats, row) {
  stats.final_publishable += 1;
  if (row.intent === 'WTS') stats.wts += 1;
  if (row.intent === 'WTB') stats.wtb += 1;
  if (row.price_verified) stats.verified_priced += 1;
  if (row.image_linked) stats.image_linked += 1;
  if (row.dealer_key) stats.dealer_linked += 1;
  if (row.country_code) stats.location_resolved += 1;
  stats.display_readiness[displayTier(row)] += 1;
  if (row.observed_reference_key) {
    stats.current_reference_counts.set(row.observed_reference_key,
      (stats.current_reference_counts.get(row.observed_reference_key) || 0) + 1);
    if (!stats.reference_samples.has(row.observed_reference_key)) stats.reference_samples.set(row.observed_reference_key, row);
  }
  if (stats.canary_pool.length < 4000) stats.canary_pool.push(row);
}

function updatePriceResearch(stats, familyRows) {
  const uniqueStates = new Map();
  for (const row of familyRows) uniqueStates.set(row.offer_state_key, row);
  for (const row of uniqueStates.values()) {
    if (!isQualifiedComparable(row)) continue;
    stats.qualified_price_research_observations += 1;
    stats.comparable_reference_counts.set(row.observed_reference_key,
      (stats.comparable_reference_counts.get(row.observed_reference_key) || 0) + 1);
  }
}

function defaultCanarySelectors(brand, stats) {
  const byReference = [...stats.current_reference_counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const common = byReference[0]?.[0];
  const rare = [...byReference].reverse()[0]?.[0];
  return [
    [`${brand}_COMMON_REFERENCE`, row => row.observed_reference_key === common, stats.reference_samples.get(common)],
    [`${brand}_RARE_REFERENCE`, row => row.observed_reference_key === rare, stats.reference_samples.get(rare)],
    [`${brand}_WTB`, row => row.intent === 'WTB'],
    [`${brand}_IMAGE_AND_PRICE`, row => displayTier(row) === 'IMAGE_AND_PRICE'],
    [`${brand}_IMAGE_ONLY`, row => displayTier(row) === 'IMAGE_ONLY'],
    [`${brand}_PRICE_ONLY`, row => displayTier(row) === 'PRICE_ONLY'],
    [`${brand}_DEALER_LINKED`, row => Boolean(row.dealer_key)],
    [`${brand}_MULTI_WATCH_CHILD`, row => String(row.parent_classification).startsWith('MULTI_WATCH')],
    [`${brand}_CONFIRMED_CURRENT`, row => row.cohort_status === 'CONFIRMED_CURRENT'],
    [`${brand}_LATEST_OBSERVED`, row => row.cohort_status === 'LATEST_OBSERVED'],
  ];
}

function canaryEvidence(brand, stats, selectors = defaultCanarySelectors(brand, stats)) {
  return selectors.map(([label, predicate, direct]) => {
    const row = direct || stats.canary_pool.find(predicate);
    const defects = row ? lineageDefects(row) : ['CANARY_NOT_AVAILABLE'];
    return {
      label,
      status: row && defects.length === 0 ? 'VERIFIED_FINAL_FROZEN_COHORT' : 'CANARY_FAILED',
      current_listing_key: row?.current_listing_key || null,
      brand: row?.brand || brand,
      observed_reference: row?.observed_reference || null,
      intent: row?.intent || null,
      cohort_status: row?.cohort_status || null,
      source_backed: row?.live_source_verified === true,
      raw_occurrence_key: row?.raw_occurrence_key || null,
      raw_message_hash_verified: Boolean(row?.parent_raw_text_sha256),
      exact_child_hash_verified: Boolean(row?.exact_child_text_sha256),
      price_currency_verified: row ? isVerifiedUsd(row) : false,
      dealer_verified: Boolean(row?.dealer_key),
      image_verified: Boolean(row?.source_image_key),
      defects,
    };
  });
}

function outputManifest(outputRoot) {
  const relativeFiles = ['canary-evidence.json', 'price-research-summary.json'];
  const cohortRoot = path.join(outputRoot, 'cohort-pages');
  for (const entry of fs.readdirSync(cohortRoot, { withFileTypes: true })) {
    if (entry.isFile()) relativeFiles.push(`cohort-pages/${entry.name}`);
  }
  return relativeFiles.sort().map(relative => {
    const file = path.join(outputRoot, relative);
    return { relative, bytes: fs.statSync(file).size, sha256: artifactChecksum(file) };
  });
}

function expectedCounts(env) {
  return {
    confirmed: {
      Rolex: Number(env.EXPECTED_ROLEX_CONFIRMED_CURRENT || DEFAULT_CONFIRMED.Rolex),
      'Patek Philippe': Number(env.EXPECTED_PATEK_CONFIRMED_CURRENT || DEFAULT_CONFIRMED['Patek Philippe']),
    },
    websiteFloors: {
      Rolex: Number(env.EXISTING_ROLEX_WEBSITE_COUNT || DEFAULT_WEBSITE_FLOORS.Rolex),
      'Patek Philippe': Number(env.EXISTING_PATEK_WEBSITE_COUNT || DEFAULT_WEBSITE_FLOORS['Patek Philippe']),
    },
  };
}

async function run(options = {}) {
  const env = options.env || process.env;
  const sourceRoot = path.resolve(env.FINAL_SOURCE_ARTIFACT || 'audit-final-source');
  const outputRoot = path.resolve(env.FINAL_FREEZE_OUTPUT || 'audit-output/final-rolex-patek-freeze');
  const sourceRun = String(env.FINAL_SOURCE_RUN_ID || EXPECTED_SOURCE_RUN);
  const commitSha = String(env.FINAL_COMMIT_SHA || 'TEST_COMMIT');
  const prUrl = String(env.FINAL_PR_URL || 'https://github.com/Pablodd1/wf/pull/775');
  const version = String(env.FINAL_FREEZE_VERSION || `rolex-patek-final-${sourceRun}`);
  const expected = expectedCounts(env);
  fs.mkdirSync(path.join(outputRoot, 'cohort-pages'), { recursive: true });

  const sourceSummary = readJson(requireFile(path.join(sourceRoot, 'summary.json'), 'source summary'));
  const sourceCheckpoint = readJson(requireFile(path.join(sourceRoot, 'checkpoint.json'), 'source checkpoint'));
  const sourceManifestFile = requireFile(path.join(sourceRoot, 'manifest-sha256.json'), 'source manifest');
  const sourceManifest = readJson(sourceManifestFile);
  if (sourceRun !== EXPECTED_SOURCE_RUN && !options.allowAnySourceRun) throw new Error(`Unexpected source run ${sourceRun}`);
  if (sourceSummary.contract !== SOURCE_CONTRACT || sourceCheckpoint.contract !== SOURCE_CONTRACT
    || sourceCheckpoint.status !== 'COMPLETE') throw new Error('Completed current-inventory source artifact required');
  if (!sourceSummary.read_only || sourceSummary.production_writes !== 0 || sourceSummary.raw_mutations !== 0
    || sourceSummary.production_source_switch !== false || sourceSummary.ui_changes !== 0) {
    throw new Error('Source mutation boundary failed');
  }
  const manifestByPath = new Map(sourceManifest.files.map(row => [row.relative, row]));
  if (manifestByPath.size !== sourceManifest.files.length || sourceManifest.files.length !== sourceSummary.artifact_manifest_files) {
    throw new Error('Source manifest does not reconcile');
  }
  for (const brand of BRANDS) {
    if (sourceSummary.brands[brand].current_active !== expected.confirmed[brand]) {
      throw new Error(`${brand} confirmed-current baseline drift`);
    }
  }

  const stats = Object.fromEntries(BRANDS.map(brand => [brand, initialBrandStats()]));
  const seenFamilies = new Set();
  let sourceFamilyRows = 0;
  let sourceUnresolved = 0;
  const partitionRelatives = [...manifestByPath.keys()].filter(relative => /^offer-partitions\/partition-\d{3}\.jsonl\.gz$/.test(relative)).sort();
  if (partitionRelatives.length !== 256) throw new Error(`Expected 256 source partitions, received ${partitionRelatives.length}`);

  for (const offerRelative of partitionRelatives) {
    const suffix = path.basename(offerRelative).replace('.jsonl.gz', '');
    const currentRelative = `current-pages/${suffix}.json.gz`;
    const familyRelative = `family-pages/${suffix}.json.gz`;
    const offerFile = verifiedManifestFile(sourceRoot, manifestByPath, offerRelative);
    const currentFile = verifiedManifestFile(sourceRoot, manifestByPath, currentRelative);
    const familyFile = verifiedManifestFile(sourceRoot, manifestByPath, familyRelative);
    const offerRows = zlib.gunzipSync(fs.readFileSync(offerFile)).toString('utf8').trim()
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    const expectedCurrent = new Map(readGzip(currentFile).map(row => [row.current_listing_key, row]));
    const expectedFamilies = new Map(readGzip(familyFile).map(row => [row.offer_family_key, row]));
    const grouped = new Map();
    for (const row of offerRows) {
      const rows = grouped.get(row.offer_family_key) || [];
      rows.push(row);
      grouped.set(row.offer_family_key, rows);
    }
    if (grouped.size !== expectedFamilies.size) throw new Error(`Family page mismatch: ${suffix}`);
    const cohortRows = [];
    for (const [familyKey, rows] of grouped) {
      if (seenFamilies.has(familyKey)) throw new Error(`Duplicate offer family ${familyKey}`);
      seenFamilies.add(familyKey);
      const family = classifyOfferFamily(rows);
      const expectedFamily = expectedFamilies.get(familyKey);
      if (!expectedFamily || expectedFamily.current_status !== family.current_status
        || expectedFamily.latest_parent_key !== family.latest_observation.parent_key) {
        throw new Error(`Family classification drift: ${familyKey}`);
      }
      sourceFamilyRows += 1;
      updatePriceResearch(stats[family.brand], rows);
      if (family.current_status === 'CURRENT_ACTIVE') {
        const baseline = expectedCurrent.get(familyKey);
        if (!baseline || baseline.offer_state_key !== family.latest_observation.offer_state_key) {
          throw new Error(`Confirmed-current baseline loss: ${familyKey}`);
        }
        expectedCurrent.delete(familyKey);
        const defects = lineageDefects(baseline);
        if (defects.length) throw new Error(`Confirmed-current lineage defect ${familyKey}: ${defects.join(',')}`);
        const row = publicRow(family, baseline, 'CONFIRMED_CURRENT');
        stats[family.brand].confirmed_current += 1;
        updatePublishable(stats[family.brand], row);
        cohortRows.push(row);
      } else if (family.current_status === 'CURRENT_LATEST_STATE') {
        sourceUnresolved += 1;
        const rescue = rescueLatestObserved(family);
        if (!rescue.eligible) {
          incrementParked(stats[family.brand], rescue.defects);
          continue;
        }
        const row = publicRow(family, family.latest_observation, 'LATEST_OBSERVED');
        stats[family.brand].latest_observed_rescued += 1;
        updatePublishable(stats[family.brand], row);
        cohortRows.push(row);
      }
    }
    if (expectedCurrent.size) throw new Error(`Unreconciled confirmed-current rows: ${suffix}`);
    cohortRows.sort((a, b) => a.current_listing_key.localeCompare(b.current_listing_key));
    writeGzip(path.join(outputRoot, `cohort-pages/${suffix}.json.gz`), cohortRows);
  }

  const canary = BRANDS.flatMap(brand => canaryEvidence(brand, stats[brand],
    options.canarySelectors?.[brand] || defaultCanarySelectors(brand, stats[brand])));
  writeJson(path.join(outputRoot, 'canary-evidence.json'), { contract: CONTRACT, canary });
  const priceResearch = Object.fromEntries(BRANDS.map(brand => [brand, {
    qualified_unique_wts_states: stats[brand].qualified_price_research_observations,
    distinct_observed_references: stats[brand].comparable_reference_counts.size,
    price_rating_ready_references: [...stats[brand].comparable_reference_counts.values()].filter(count => count >= 2).length,
    reposts_inflate_comparables: false,
    catalog_match_required: false,
  }]));
  writeJson(path.join(outputRoot, 'price-research-summary.json'), { contract: CONTRACT, brands: priceResearch });
  const manifest = outputManifest(outputRoot);
  writeJson(path.join(outputRoot, 'manifest-sha256.json'), { contract: CONTRACT, files: manifest });
  const manifestSha = artifactChecksum(path.join(outputRoot, 'manifest-sha256.json'));

  const publicBrands = Object.fromEntries(BRANDS.map(brand => {
    const value = stats[brand];
    return [brand, {
      confirmed_current: value.confirmed_current,
      latest_observed_rescued: value.latest_observed_rescued,
      final_publishable: value.final_publishable,
      parked_latest_observed: value.parked_latest_observed,
      parked_reasons: value.parked_reasons,
      wts: value.wts,
      wtb: value.wtb,
      verified_priced: value.verified_priced,
      image_linked: value.image_linked,
      dealer_linked: value.dealer_linked,
      location_resolved: value.location_resolved,
      display_readiness: value.display_readiness,
      qualified_price_research_observations: value.qualified_price_research_observations,
      distinct_price_research_references: value.comparable_reference_counts.size,
      price_rating_ready_references: [...value.comparable_reference_counts.values()].filter(count => count >= 2).length,
    }];
  }));
  const baselinePreserved = BRANDS.every(brand => publicBrands[brand].confirmed_current === expected.confirmed[brand]);
  const uniqueCohort = seenFamilies.size === sourceFamilyRows && BRANDS.every(brand =>
    publicBrands[brand].final_publishable === publicBrands[brand].confirmed_current
      + publicBrands[brand].latest_observed_rescued);
  const canaryFailed = canary.filter(row => row.status !== 'VERIFIED_FINAL_FROZEN_COHORT');
  const unexplainedLoss = BRANDS.filter(brand => publicBrands[brand].final_publishable < expected.websiteFloors[brand]);
  const sourceUnresolvedExpected = BRANDS.reduce((sum, brand) => sum + sourceSummary.brands[brand].status_unresolved, 0);
  const rescuedOrParked = BRANDS.reduce((sum, brand) => sum + publicBrands[brand].latest_observed_rescued
    + publicBrands[brand].parked_latest_observed, 0);
  const blockers = [];
  if (!baselinePreserved) blockers.push('CONFIRMED_CURRENT_BASELINE_LOSS');
  if (!uniqueCohort) blockers.push('FINAL_COHORT_NOT_UNIQUE');
  if (sourceUnresolved !== sourceUnresolvedExpected || rescuedOrParked !== sourceUnresolvedExpected) {
    blockers.push('UNRESOLVED_FAMILY_RECONCILIATION_FAILED');
  }
  if (canaryFailed.length) blockers.push('FINAL_CANARY_FAILED');
  if (unexplainedLoss.length) blockers.push('EXISTING_WEBSITE_COUNT_FLOOR_LOSS');
  const decision = blockers.length ? 'NOT_READY_FINAL_COHORT' : 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY';
  const invalidParked = BRANDS.reduce((sum, brand) => sum
    + Object.values(sourceSummary.brands[brand].invalid_fragments).reduce((inner, count) => inner + count, 0), 0);
  const unsplittable = BRANDS.reduce((sum, brand) => sum
    + (sourceSummary.brands[brand].invalid_fragments.UNSPLITTABLE_PARENT || 0), 0);
  const freeze = {
    contract: CONTRACT,
    version,
    decision,
    generated_at: new Date().toISOString(),
    source_artifact_run_id: sourceRun,
    source_contract: sourceSummary.contract,
    source_manifest_sha256: artifactChecksum(sourceManifestFile),
    manifest_sha256: manifestSha,
    commit_sha: commitSha,
    pr_url: prUrl,
    read_only: true,
    production_writes: 0,
    raw_mutations: 0,
    production_source_switch: false,
    destructive_overwrites: 0,
    no_broad_recensus: true,
    source_partitions_verified: partitionRelatives.length,
    source_offer_families: sourceFamilyRows,
    source_unresolved_families: sourceUnresolved,
    brands: publicBrands,
    rescued_count: BRANDS.reduce((sum, brand) => sum + publicBrands[brand].latest_observed_rescued, 0),
    parked: {
      latest_observed_families: BRANDS.reduce((sum, brand) => sum + publicBrands[brand].parked_latest_observed, 0),
      unsplittable_parents: unsplittable,
      invalid_or_review_occurrences: invalidParked,
      preserved_not_deleted: true,
    },
    price_research: priceResearch,
    canary: { requested: canary.length, passed: canary.length - canaryFailed.length, failed: canaryFailed.length },
    protection: {
      confirmed_current_baseline_preserved: baselinePreserved,
      website_count_floors: expected.websiteFloors,
      final_counts_above_website_floors: unexplainedLoss.length === 0,
      no_production_switch: true,
    },
    manifest: { files: manifest.length, unique_paths: new Set(manifest.map(row => row.relative)).size },
    blockers,
    next_brand_readiness: Object.fromEntries(['Tudor', 'Zenith', 'Cartier', 'TAG Heuer']
      .map(brand => [brand, { generic_pipeline_ready: decision === 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY',
        source_census_required: true }])),
  };
  writeJson(path.join(outputRoot, 'freeze.json'), freeze);
  return freeze;
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.decision !== 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ contract: CONTRACT, decision: 'NOT_READY_FINAL_COHORT',
      read_only: true, production_writes: 0, raw_mutations: 0, error: String(error.message || error).slice(0, 500) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONTRACT,
  artifactChecksum,
  canaryEvidence,
  lineageDefects,
  rescueLatestObserved,
  run,
};
