'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const shadow = require('../api/_lib/curated-luxury-shadow.cjs');
const restoration = require('../tools/audit/rolex-evidence-restoration-lib.cjs');
const worker = require('../tools/audit/restore-rolex-price-image-evidence.cjs');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260827150000_rolex_evidence_restoration_v1.sql'), 'utf8');

function row(overrides = {}) {
  const raw = overrides.raw_message || 'WTS Rolex 116500LN USD 25,000';
  return {
    run_id: worker.RUN_ID,
    current_listing_key: 'listing-1',
    offer_state_key: 'state-1',
    latest_raw_occurrence_key: 'occurrence-1',
    unique_observation_key: 'observation-1',
    current_status: 'CURRENT_ACTIVE',
    brand: 'Rolex',
    intent: 'WTS',
    observed_reference_key: '116500LN',
    version_key: 'version-1',
    source_timestamp: '2026-08-20T00:00:00Z',
    exact_child_text_sha256: restoration.sha256(raw),
    parent_raw_text_sha256: restoration.sha256(raw),
    raw_message: raw,
    raw_version_media: [],
    raw_is_bundle: false,
    parent_child_count: 1,
    is_canonical_survivor: true,
    ...overrides,
  };
}

test('direct USD is immutable verified display evidence and WTS comparable evidence', async () => {
  const evidence = await restoration.buildPriceEvidence(row(), null);
  assert.equal(evidence.decision, 'VERIFIED');
  assert.equal(evidence.source_currency, 'USD');
  assert.equal(evidence.normalized_usd_amount, 25000);
  assert.equal(evidence.price_evidence_classification, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(evidence.display_price_verified, true);
  assert.equal(evidence.price_research_eligible, true);
  assert.match(evidence.evidence_checksum, /^[0-9a-f]{64}$/);
});

test('dated foreign FX creates USD display evidence while preserving source evidence', async () => {
  const raw = 'WTS Rolex 116500LN 💶 3900';
  const evidence = await restoration.buildPriceEvidence(row({ raw_message: raw,
    exact_child_text_sha256: restoration.sha256(raw), parent_raw_text_sha256: restoration.sha256(raw) }), {
    resolve: async () => ({ contract: 'dated-fx-v1', provider: 'ECB', source_url: 'https://data-api.ecb.europa.eu/',
      applicable_date: '2026-08-20', effective_date: '2026-08-20', lookback_days: 0,
      rate_direction: 'USD_PER_SOURCE_UNIT', usd_per_source_unit: 1.2 }),
  });
  assert.equal(evidence.decision, 'VERIFIED');
  assert.equal(evidence.source_currency, 'EUR');
  assert.equal(evidence.normalized_usd_amount, 4680);
  assert.equal(evidence.fx_rate_direction, 'USD_PER_SOURCE_UNIT');
});

test('WTB can display verified USD but never enters Price Research', async () => {
  const evidence = await restoration.buildPriceEvidence(row({ intent: 'WTB' }), null);
  assert.equal(evidence.display_price_verified, true);
  assert.equal(evidence.price_research_eligible, false);
});

test('non-canonical duplicate candidates are never enriched', async () => {
  const evidence = await restoration.buildPriceEvidence(row({ is_canonical_survivor: false }), null);
  assert.equal(evidence.decision, 'REVIEW_REQUIRED');
  assert.equal(evidence.review_reason, 'NON_CANONICAL_OR_NON_CURRENT');
  assert.equal(restoration.buildImageEvidence(row({ is_canonical_survivor: false })).length, 0);
});

test('ambiguous multiple ask prices and structured conflicts fail closed', async () => {
  const raw = 'WTS Rolex 116500LN USD 25,000 / USD 26,000';
  const multiple = await restoration.buildPriceEvidence(row({ raw_message: raw,
    exact_child_text_sha256: restoration.sha256(raw), parent_raw_text_sha256: restoration.sha256(raw) }), null);
  assert.equal(multiple.decision, 'REVIEW_REQUIRED');
  assert.equal(multiple.display_price_verified, false);
  const conflict = await restoration.buildPriceEvidence(row({ source_price_amount: 999 }), null);
  assert.equal(conflict.review_reason, 'STRUCTURED_PRICE_CONFLICTS_WITH_RAW');
});

test('bare dollar never becomes USD evidence', async () => {
  const raw = 'WTS Rolex 116500LN $25,000';
  const evidence = await restoration.buildPriceEvidence(row({ raw_message: raw,
    exact_child_text_sha256: restoration.sha256(raw), parent_raw_text_sha256: restoration.sha256(raw) }), null);
  assert.equal(evidence.decision, 'REVIEW_REQUIRED');
  assert.equal(evidence.review_reason, 'NO_EXACT_EXPLICIT_PRICE');
  assert.equal(evidence.normalized_usd_amount, undefined);
});

test('exact child hash resolves only its own multi-line segment', () => {
  const child = 'Rolex 116500LN USD 25,000';
  const raw = `WTS watches\n${child}\nRolex 126500LN USD 30,000`;
  const resolved = restoration.exactChildText(row({ raw_message: raw,
    exact_child_text_sha256: restoration.sha256(child), parent_raw_text_sha256: restoration.sha256(raw) }));
  assert.equal(resolved.text, child);
  assert.equal(resolved.scope, 'EXACT_CHILD_SEGMENT');
});

test('images require deterministic singleton seller media and preserve multiple images', () => {
  const safe = row({ raw_version_media: [
    { url: 'https://images.example.test/one.jpg', image_evidence_type: 'SELLER_LISTING_IMAGE' },
    { public_url: 'https://images.example.test/two.jpg' },
  ] });
  const images = restoration.buildImageEvidence(safe);
  assert.equal(images.length, 2);
  assert.ok(images.every(image => image.image_evidence_type === 'SELLER_LISTING_IMAGE'));
  assert.equal(restoration.buildImageEvidence({ ...safe, parent_child_count: 2 }).length, 0);
  assert.equal(restoration.buildImageEvidence({ ...safe, raw_is_bundle: true }).length, 0);
  assert.equal(restoration.buildImageEvidence({ ...safe,
    raw_version_media: [{ url: 'https://images.example.test/ref.jpg', image_evidence_type: 'REFERENCE_IMAGE' }] }).length, 0);
  assert.equal(restoration.buildImageEvidence({ ...safe,
    raw_version_media: [{ url: 'https://images.example.test/unverified.jpg', verified_for_child_listing: false }] }).length, 0);
});

test('restored Rolex card is USD-only publicly and separates display from analytics', () => {
  const card = shadow.mapCard({
    id: 'listing-1', brand: 'Rolex', reference: '116500LN', listing_type: 'WTB',
    source_price_amount: 100000, source_currency: 'HKD', price_usd: 12820,
    price_verified: true, price_display_verified: true, price_research_eligible: false,
    price_evidence_classification: 'DATED_VERIFIED_FX', price_requires_review: false,
    verified_child_media: [], image_state: 'NO_VERIFIED_CHILD_IMAGE',
  });
  assert.equal(card.price_usd, 12820);
  assert.equal(card.currency, 'USD');
  assert.equal(card.source_currency, null);
  assert.equal(card.source_price_amount, null);
  assert.equal(card.price_display_verified, true);
  assert.equal(card.price_research_eligible, false);
});

test('Patek card projection remains byte-contract compatible for new Rolex fields', () => {
  const card = shadow.mapCard({ id: 'patek-1', brand: 'Patek Philippe', listing_type: 'WTS',
    price_usd: null, price_verified: false, verified_child_media: [], image_state: 'NO_VERIFIED_CHILD_IMAGE' });
  assert.equal(Object.hasOwn(card, 'price_display_verified'), false);
  assert.equal(Object.hasOwn(card, 'price_requires_review'), false);
});

test('Rolex v4 is opt-in and Patek remains on v3', async () => {
  const prior = process.env.CURATED_ROLEX_EVIDENCE_SOURCE;
  process.env.CURATED_ROLEX_EVIDENCE_SOURCE = shadow.ROLEX_EVIDENCE_SELECTOR;
  const calls = [];
  const client = { rpc: async (name) => {
    calls.push(name);
    if (name.includes('page_keys')) return { data: { keys: [], has_more: false }, error: null };
    if (name.includes('count')) return { data: { total: 1, source: 'test' }, error: null };
    return { data: [], error: null };
  } };
  const base = { listingType: null, countries: null, pricedOnly: false, imagesOnly: false,
    search: null, reference: null, page: 1, pageSize: 24, cursor: null };
  try {
    await shadow.loadInventory(client, { ...base, brand: 'Rolex' });
    assert.deepEqual(calls, ['curated_luxury_rolex_customer_page_keys_v4',
      'curated_luxury_rolex_customer_count_v3']);
    calls.length = 0;
    await shadow.loadInventory(client, { ...base, brand: 'Patek Philippe' });
    assert.deepEqual(calls, ['curated_luxury_shadow_customer_page_keys_v3',
      'curated_luxury_shadow_customer_count_v2']);
  } finally {
    if (prior === undefined) delete process.env.CURATED_ROLEX_EVIDENCE_SOURCE;
    else process.env.CURATED_ROLEX_EVIDENCE_SOURCE = prior;
  }
});

test('migration is append-only, duplicate-safe, Rolex-only, and source-table read-only', () => {
  assert.match(migration, /brand='Rolex'/);
  assert.match(migration, /duplicate\.offer_state_key=c\.offer_state_key/);
  assert.match(migration, /duplicate\.unique_observation_key=c\.unique_observation_key/);
  assert.match(migration, /BEFORE UPDATE OR DELETE[\s\S]*reject_evidence_mutation/i);
  assert.match(migration, /image_evidence_type='SELLER_LISTING_IMAGE'/);
  assert.match(migration, /count\(DISTINCT l\.current_listing_key\)/i);
  assert.match(migration, /row_number\(\) OVER\(PARTITION BY offer_state_key/i);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\.(?:raw_messages|raw_message_versions|curated_luxury_current_listings_shadow)/i);
  assert.doesNotMatch(migration, /brand='Patek Philippe'/);
});

test('worker requires explicit write confirmations', () => {
  assert.equal(worker.confirmationFor('dry-run'), null);
  assert.equal(worker.confirmationFor('canary'), 'APPLY_QNSA_ROLEX_EVIDENCE_CANARY_V1');
  assert.equal(worker.confirmationFor('full'), 'APPLY_QNSA_ROLEX_EVIDENCE_FULL_V1');
});

test('worker dry-run emits aggregate-only evidence without table writes', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolex-evidence-test-'));
  const outputFile = path.join(outputDir, 'manifest.json');
  const candidate = row();
  const calls = [];
  const client = {
    rpc: async (name) => {
      calls.push(name);
      if (name === 'curated_luxury_rolex_evidence_candidates_v1') {
        return { data: { rows: [candidate], next_key: candidate.current_listing_key, has_more: false }, error: null };
      }
      return { data: { raw_current_rows: 1535763, canonical_current_rows: 1535763,
        duplicate_rows_suppressed: 0, verified_image_listings: 255 }, error: null };
    },
    from: () => { throw new Error('dry-run must not write'); },
  };
  try {
    const result = await worker.run({ mode: 'dry-run', url: 'https://qnsafosakvonzgfcsphh.supabase.co',
      key: 'test-only', client, outputFile });
    assert.equal(result.manifest.applied, false);
    assert.equal(result.manifest.counters.verified_direct_usd, 1);
    assert.equal(result.manifest.duplicate_details_exposed, false);
    assert.deepEqual(calls, ['curated_luxury_rolex_evidence_reconciliation_v1',
      'curated_luxury_rolex_evidence_candidates_v1',
      'curated_luxury_rolex_evidence_reconciliation_v1']);
    assert.equal(fs.existsSync(outputFile), true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
