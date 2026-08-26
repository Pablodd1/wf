'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { classifyOfferFamily } = require('../tools/audit/current-inventory-shadow-lib.cjs');
const {
  artifactChecksum,
  lineageDefects,
  rescueLatestObserved,
  run,
} = require('../tools/audit/final-rolex-patek-freeze.cjs');

function observation(brand, family, state, overrides = {}) {
  return {
    offer_family_key: family,
    offer_state_key: state,
    raw_occurrence_key: `${state}-occurrence`,
    unique_observation_key: `${state}-observation`,
    exact_child_text_sha256: `${state}-child`,
    parent_raw_text_sha256: `${state}-parent-text`,
    parent_key: `${state}-parent`,
    version_key: `${state}-version`,
    source_key: `${state}-source`,
    source_page: 'resume-pages/raw-00-000001.json.gz',
    live_source_verified: true,
    brand,
    observed_reference: brand === 'Rolex' ? '126334' : '5168G',
    observed_reference_key: brand === 'Rolex' ? '126334' : '5168G',
    intent: 'WTS',
    source_timestamp: '2026-08-01T00:00:00.000Z',
    source_status: null,
    source_price_amount: 13500,
    source_currency: 'HKD',
    price_evidence_classification: 'CURRENCY_UNVERIFIED',
    normalized_usd_amount: null,
    image_linked: false,
    source_image_key: null,
    dealer_key: null,
    country_code: null,
    parent_classification: 'SINGLE_WATCH',
    disposition: {},
    ...overrides,
  };
}

function familyPage(family) {
  return {
    offer_family_key: family.offer_family_key,
    current_status: family.current_status,
    latest_parent_key: family.latest_observation.parent_key,
  };
}

function gzipJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(`${JSON.stringify(value)}\n`));
}

function gzipJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(rows.map(row => JSON.stringify(row)).join('\n')));
}

test('LATEST_OBSERVED rescue requires immutable source lineage but not catalog, image, price, location, or dealer', () => {
  const family = classifyOfferFamily([observation('Rolex', 'family-r', 'state-r')]);
  assert.deepEqual(rescueLatestObserved(family), { eligible: true, defects: [] });
  assert.equal(lineageDefects(family.latest_observation).length, 0);
  const unsafe = classifyOfferFamily([observation('Patek Philippe', 'family-p', 'state-p', {
    observed_reference: 'Q9068670', observed_reference_key: 'Q9068670',
  })]);
  assert.deepEqual(rescueLatestObserved(unsafe), { eligible: false, defects: ['FOREIGN_REFERENCE_CONFLICT'] });
});

test('artifact-only pass preserves confirmed baseline, collapses reposts, rescues latest observations, and freezes a unique cohort', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rolex-patek-final-freeze-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  try {
    const rolexActive = observation('Rolex', 'family-rolex-active', 'state-rolex-active', {
      source_status: 'AVAILABLE', source_currency: 'USD', price_evidence_classification: 'SOURCE_EXPLICIT_USD_MATCH',
    });
    const patekActive = observation('Patek Philippe', 'family-patek-active', 'state-patek-active', {
      source_status: 'ACTIVE', source_currency: 'USD', price_evidence_classification: 'SOURCE_EXPLICIT_USD_MATCH',
    });
    const rolexLatest = observation('Rolex', 'family-rolex-latest', 'state-rolex-latest');
    const patekLatest = observation('Patek Philippe', 'family-patek-latest', 'state-patek-latest');
    const patekRepost = { ...patekLatest, raw_occurrence_key: 'patek-repost-occurrence',
      unique_observation_key: 'patek-repost-observation', source_timestamp: '2026-08-02T00:00:00.000Z' };
    const rows = [rolexActive, patekActive, rolexLatest, patekLatest, patekRepost];
    const families = new Map();
    for (const row of rows) {
      const values = families.get(row.offer_family_key) || [];
      values.push(row);
      families.set(row.offer_family_key, values);
    }
    const classified = [...families.values()].map(classifyOfferFamily);
    const active = classified.filter(family => family.current_status === 'CURRENT_ACTIVE').map(family => ({
      current_listing_key: family.offer_family_key,
      current_status: 'CURRENT_ACTIVE',
      ...family.latest_observation,
    }));
    const manifestRows = [];
    for (let index = 0; index < 256; index += 1) {
      const suffix = `partition-${String(index).padStart(3, '0')}`;
      const offerRelative = `offer-partitions/${suffix}.jsonl.gz`;
      const currentRelative = `current-pages/${suffix}.json.gz`;
      const familyRelative = `family-pages/${suffix}.json.gz`;
      gzipJsonl(path.join(source, offerRelative), index === 0 ? rows : []);
      gzipJson(path.join(source, currentRelative), index === 0 ? active : []);
      gzipJson(path.join(source, familyRelative), index === 0 ? classified.map(familyPage) : []);
      for (const relative of [offerRelative, currentRelative, familyRelative]) {
        const file = path.join(source, relative);
        manifestRows.push({ relative, bytes: fs.statSync(file).size, sha256: artifactChecksum(file) });
      }
    }
    gzipJson(path.join(source, 'observed-reference-registry.json.gz'), []);
    fs.writeFileSync(path.join(source, 'canary-evidence.json'), '{}\n');
    for (const relative of ['canary-evidence.json', 'observed-reference-registry.json.gz']) {
      const file = path.join(source, relative);
      manifestRows.push({ relative, bytes: fs.statSync(file).size, sha256: artifactChecksum(file) });
    }
    fs.writeFileSync(path.join(source, 'manifest-sha256.json'), JSON.stringify({ files: manifestRows }));
    fs.writeFileSync(path.join(source, 'checkpoint.json'), JSON.stringify({
      contract: 'watchfacts-current-inventory-shadow-v1', status: 'COMPLETE',
    }));
    const emptyInvalid = { REPEATED_IDENTICAL_OFFER: 0, NON_WATCH_FRAGMENT: 0, FIELD_ONLY_FRAGMENT: 0,
      AMBIGUOUS_CHILD_BOUNDARY: 0, UNSPLITTABLE_PARENT: 0, REVIEW_REQUIRED: 0 };
    fs.writeFileSync(path.join(source, 'summary.json'), JSON.stringify({
      contract: 'watchfacts-current-inventory-shadow-v1', read_only: true, production_writes: 0, raw_mutations: 0,
      production_source_switch: false, ui_changes: 0, artifact_manifest_files: manifestRows.length,
      brands: {
        Rolex: { current_active: 1, status_unresolved: 1,
          invalid_fragments: { ...emptyInvalid, UNSPLITTABLE_PARENT: 1 } },
        'Patek Philippe': { current_active: 1, status_unresolved: 1, invalid_fragments: emptyInvalid },
      },
    }));

    const canarySelectors = Object.fromEntries(['Rolex', 'Patek Philippe'].map(brand => [brand, [
      [`${brand}_CONFIRMED`, row => row.cohort_status === 'CONFIRMED_CURRENT'],
      [`${brand}_RESCUED`, row => row.cohort_status === 'LATEST_OBSERVED'],
    ]]));
    const freeze = await run({ allowAnySourceRun: true, canarySelectors, env: {
      FINAL_SOURCE_ARTIFACT: source,
      FINAL_FREEZE_OUTPUT: output,
      FINAL_SOURCE_RUN_ID: 'test-run',
      FINAL_COMMIT_SHA: 'a'.repeat(40),
      FINAL_FREEZE_VERSION: 'test-freeze-v1',
      FINAL_PR_URL: 'https://github.com/Pablodd1/wf/pull/775',
      EXPECTED_ROLEX_CONFIRMED_CURRENT: '1',
      EXPECTED_PATEK_CONFIRMED_CURRENT: '1',
      EXISTING_ROLEX_WEBSITE_COUNT: '1',
      EXISTING_PATEK_WEBSITE_COUNT: '1',
    } });
    assert.equal(freeze.decision, 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY');
    assert.equal(freeze.brands.Rolex.confirmed_current, 1);
    assert.equal(freeze.brands.Rolex.latest_observed_rescued, 1);
    assert.equal(freeze.brands['Patek Philippe'].latest_observed_rescued, 1);
    assert.equal(freeze.rescued_count, 2);
    assert.equal(freeze.parked.unsplittable_parents, 1);
    assert.deepEqual(freeze.canary, { requested: 4, passed: 4, failed: 0 });
    const cohort = readAllCohort(output);
    assert.equal(cohort.length, 4);
    assert.equal(new Set(cohort.map(row => row.current_listing_key)).size, 4);
    const rescued = cohort.find(row => row.current_listing_key === 'family-rolex-latest');
    assert.equal(rescued.current_status, 'LATEST_OBSERVED');
    assert.equal(rescued.source_currency, 'HKD');
    assert.equal(rescued.source_price_amount, 13500);
    assert.equal(rescued.price_verified, false);
    assert.equal(rescued.normalized_usd_amount, null);
    assert.equal(freeze.price_research.Rolex.reposts_inflate_comparables, false);
    assert.equal(fs.existsSync(path.join(output, 'manifest-sha256.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function readAllCohort(output) {
  const root = path.join(output, 'cohort-pages');
  return fs.readdirSync(root).flatMap(name => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, name))).toString('utf8')));
}

test('registered workflow isolates the final pass from QNSA and pins the completed source artifact', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'qnsa-disk-capacity-audit.yml'), 'utf8');
  const finalJob = workflow.split('  final-rolex-patek-rescue-freeze:')[1];
  assert.ok(finalJob, 'final freeze job missing');
  assert.match(finalJob, /test \"\$FINAL_SOURCE_RUN_ID\" = \"32934432129\"/);
  assert.match(finalJob, /test \"\$FINAL_SOURCE_HEAD_SHA\" = \"0bdc7f710eb3d28ba329582d379f41f602a53d3e\"/);
  assert.match(finalJob, /PRIVATE-qnsa-current-inventory-shadow-/);
  assert.match(finalJob, /npm run freeze:rolex-patek-final/);
  assert.match(finalJob, /no_broad_recensus !== true/);
  assert.doesNotMatch(finalJob, /SUPABASE_ACCESS_TOKEN|managementQuery|current-inventory-shadow\.cjs --validate-only/);
});
