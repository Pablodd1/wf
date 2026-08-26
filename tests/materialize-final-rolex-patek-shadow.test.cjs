'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const {
  artifactChecksum,
  materialize,
  PROJECT_REF,
} = require('../tools/audit/materialize-final-rolex-patek-shadow.cjs');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeGzipJson(file, value, jsonl = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = jsonl ? `${value.map(row => JSON.stringify(row)).join('\n')}\n` : `${JSON.stringify(value)}\n`;
  fs.writeFileSync(file, zlib.gzipSync(payload));
}

function manifest(root, relatives) {
  return relatives.map(relative => ({
    relative,
    bytes: fs.statSync(path.join(root, relative)).size,
    sha256: artifactChecksum(path.join(root, relative)),
  }));
}

test('frozen cohort materializer preserves current and Price Research counts without a source switch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'final-shadow-load-'));
  const finalRoot = path.join(root, 'final');
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'output');
  try {
    const rolex = {
      current_listing_key: 'family-r', offer_family_key: 'family-r', offer_state_key: 'state-r',
      raw_occurrence_key: 'raw-r', unique_observation_key: 'unique-r', brand: 'Rolex',
      observed_reference: '126334', observed_reference_key: '126334', intent: 'WTS',
      source_timestamp: '2026-08-01T00:00:00Z', source_price_amount: 13500, source_currency: 'USD',
      price_evidence_classification: 'SOURCE_EXPLICIT_USD_MATCH', price_verified: true,
      normalized_usd_amount: 13500, cohort_status: 'CONFIRMED_CURRENT', image_linked: false,
      exact_child_text_sha256: 'child-r', parent_raw_text_sha256: 'parent-r', parent_key: 'parent-key-r',
      version_key: 'version-r', source_key: 'source-r', source_page: 'page-r', origin: 'LIVE_SOURCE_RECHECK',
      source_identity_key: 'poster-r', live_source_verified: true,
    };
    const patek = {
      current_listing_key: 'family-p', offer_family_key: 'family-p', offer_state_key: 'state-p',
      raw_occurrence_key: 'raw-p', unique_observation_key: 'unique-p', brand: 'Patek Philippe',
      observed_reference: 'Zebra', observed_reference_key: 'ZEBRA', intent: 'WTB',
      source_timestamp: '2026-08-02T00:00:00Z', source_price_amount: null, source_currency: null,
      price_evidence_classification: null, price_verified: false, normalized_usd_amount: null,
      cohort_status: 'LATEST_OBSERVED', image_linked: true, source_image_key: 'image-p',
      exact_child_text_sha256: 'child-p', parent_raw_text_sha256: 'parent-p', parent_key: 'parent-key-p',
      version_key: 'version-p', source_key: 'source-p', source_page: 'page-p', origin: 'LIVE_SOURCE_RECHECK',
      source_identity_key: 'poster-p', live_source_verified: true,
    };
    const hkd = { ...rolex, current_listing_key: 'family-hkd', offer_family_key: 'family-hkd',
      offer_state_key: 'state-hkd', raw_occurrence_key: 'raw-hkd', unique_observation_key: 'unique-hkd',
      brand: 'Patek Philippe', observed_reference: '5711', observed_reference_key: '5711',
      source_price_amount: 105300, source_currency: 'HKD', normalized_usd_amount: 13500,
      price_evidence_classification: 'EXPLICIT_SOURCE_FX_CONVERTED' };
    const eur = { ...rolex, current_listing_key: 'family-eur', offer_family_key: 'family-eur',
      offer_state_key: 'state-eur', raw_occurrence_key: 'raw-eur', unique_observation_key: 'unique-eur',
      brand: 'Patek Philippe', observed_reference: '5167A', observed_reference_key: '5167A',
      source_price_amount: 12000, source_currency: 'EUR', normalized_usd_amount: 13080,
      price_evidence_classification: 'DATED_VERIFIED_FX' };
    const cohortRelative = 'cohort-pages/partition-000.json.gz';
    const priceRelative = 'price-research-summary.json';
    const canaryRelative = 'canary-evidence.json';
    writeGzipJson(path.join(finalRoot, cohortRelative), [rolex, patek]);
    writeJson(path.join(finalRoot, priceRelative), { brands: {
      Rolex: { qualified_unique_wts_states: 1, reposts_inflate_comparables: false, catalog_match_required: false },
      'Patek Philippe': { qualified_unique_wts_states: 0, reposts_inflate_comparables: false,
        catalog_match_required: false },
    } });
    writeJson(path.join(finalRoot, canaryRelative), { canary: [{ status: 'VERIFIED_FINAL_FROZEN_COHORT' },
      { status: 'VERIFIED_FINAL_FROZEN_COHORT' }] });
    writeJson(path.join(finalRoot, 'manifest-sha256.json'), { files: manifest(finalRoot,
      [cohortRelative, priceRelative, canaryRelative]) });

    const offerRelative = 'offer-partitions/partition-000.jsonl.gz';
    writeGzipJson(path.join(sourceRoot, offerRelative), [rolex, patek, hkd, eur], true);
    writeJson(path.join(sourceRoot, 'manifest-sha256.json'), { files: manifest(sourceRoot, [offerRelative]) });
    const finalManifestSha = artifactChecksum(path.join(finalRoot, 'manifest-sha256.json'));
    writeJson(path.join(finalRoot, 'freeze.json'), {
      version: 'curated-luxury-rolex-patek-final-42',
      decision: 'CURATED_LUXURY_ROLEX_PATEK_FINAL_READY',
      source_artifact_run_id: '41', source_manifest_sha256: artifactChecksum(path.join(sourceRoot, 'manifest-sha256.json')),
      manifest_sha256: finalManifestSha,
      canary: { passed: 2, failed: 0 },
      brands: {
        Rolex: { final_publishable: 1, wts: 1, wtb: 0, qualified_price_research_observations: 1 },
        'Patek Philippe': { final_publishable: 1, wts: 0, wtb: 1,
          qualified_price_research_observations: 0 },
      },
    });
    const summary = materialize({ finalRoot, sourceRoot, outputRoot, expected: {
      finalRun: '42', sourceRun: '41', manifestSha256: finalManifestSha, canaryPassed: 2, partitionCount: 1,
      brands: {
        Rolex: { final: 1, wts: 1, wtb: 0, priceResearch: 1 },
        'Patek Philippe': { final: 1, wts: 0, wtb: 1, priceResearch: 0 },
      },
    } });
    assert.equal(summary.canonical_project_ref, PROJECT_REF);
    assert.equal(summary.status, 'READY_TO_LOAD_SHADOW_ONLY');
    assert.equal(summary.counts.Rolex.current, 1);
    assert.equal(summary.counts.Rolex.priceResearch, 1);
    assert.equal(summary.counts['Patek Philippe'].current, 1);
    assert.equal(summary.counts['Patek Philippe'].priceResearch, 2);
    assert.equal(summary.source_switch, false);
    assert.equal(summary.customer_endpoints_changed, false);
    const currentCsv = zlib.gunzipSync(fs.readFileSync(path.join(outputRoot,
      'current', 'partition-000.csv.gz'))).toString('utf8');
    assert.match(currentCsv, /CONFIRMED_CURRENT/);
    assert.match(currentCsv, /LATEST_OBSERVED/);
    assert.match(currentCsv, /CURRENT_ACTIVE/);
    assert.match(currentCsv, /CURRENT_LATEST_STATE/);
    assert.match(currentCsv, /unique_observation_key,parent_key,version_key,source_key,source_page,origin/);
    assert.match(currentCsv, /poster-r/);
    assert.match(currentCsv, /image-p/);
    assert.doesNotMatch(currentCsv, /raw child text/i);
    const priceCsv = zlib.gunzipSync(fs.readFileSync(path.join(outputRoot,
      'price-research', 'partition-000.csv.gz'))).toString('utf8');
    assert.match(priceCsv, /"105300","HKD","13500"/);
    assert.match(priceCsv, /"12000","EUR","13080"/);
    const referencesCsv = zlib.gunzipSync(fs.readFileSync(path.join(outputRoot,
      'observed-references.csv.gz'))).toString('utf8');
    assert.match(referencesCsv, /OBSERVED_ONLY/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manual load workflow is pinned to the frozen evidence and cannot switch customer sources', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows',
    'qnsa-rolex-patek-final-shadow-load.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /32953447624/);
  assert.match(workflow, /32934432129/);
  assert.match(workflow, /17d6d83186cd8e675830c881bcf16e0d3c011ba1835eecf90710a4c665e4472a/);
  assert.match(workflow, /LOAD_QNSA_ROLEX_PATEK_FINAL_SHADOW_V1/);
  assert.match(workflow, /curated_luxury_current_listings_shadow/);
  assert.match(workflow, /curated_luxury_offer_states_shadow/);
  assert.doesNotMatch(workflow, /UPDATE\s+public\.watch_records|DELETE\s+FROM|TRUNCATE|customer_source_switch/i);
});
