'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const evidence = require('../tools/audit/curated-luxury-card-evidence-lib.cjs');
const ecb = require('../tools/audit/fetch-ecb-card-fx-rates.cjs');
const shadow = require('../api/_lib/curated-luxury-shadow.cjs');
const root = path.resolve(__dirname, '..');

function row(overrides = {}) {
  return {
    run_id: '17d6d831-86cd-5e67-9830-c881bcf16e0d',
    current_listing_key: 'listing-1', offer_state_key: 'state-1',
    raw_occurrence_key: 'occurrence-1', exact_child_text_sha256: 'a'.repeat(64),
    brand: 'Rolex', observed_reference: '116500LN', observed_reference_key: '116500LN',
    intent: 'WTS', source_timestamp: '2026-08-23T12:00:00Z',
    price_evidence_classification: 'AUTO_APPROVED',
    current_status: 'CURRENT_ACTIVE', disposition: { duplicate: false },
    search_text: 'Rolex 116500LN Daytona', dial_or_color: null,
    ...overrides,
  };
}

test('same-brand raw model is accepted deterministically', () => {
  const result = evidence.resolveModelEvidence(row());
  assert.deepEqual(result, {
    decision: 'VERIFIED', model: 'Daytona',
    model_evidence_type: 'FROZEN_SOURCE_MODEL_AS_POSTED', source_model_claim: 'Daytona',
  });
});

test('wrong-brand raw claim is rejected and never displayed as a model', () => {
  const result = evidence.resolveModelEvidence(row({
    brand: 'Patek Philippe', observed_reference: '5711/1A-010', observed_reference_key: '57111A010',
    search_text: 'Patek Philippe 5711/1A-010 Daytona',
  }));
  assert.notEqual(result.model, 'Daytona');
  assert.equal(result.model_evidence_type, 'CATALOG_EXACT_BRAND_REFERENCE');
  assert.equal(result.model, 'Nautilus');
});

test('exact same-brand catalog reference is the only catalog fallback', () => {
  const result = evidence.resolveModelEvidence(row({ search_text: 'Rolex 116500LN Not a real Rolex family' }));
  assert.equal(result.model, 'Cosmograph Daytona');
  assert.equal(result.model_evidence_type, 'CATALOG_EXACT_BRAND_REFERENCE');
});

test('unresolved model fails closed without invalidating the listing', () => {
  const result = evidence.resolveModelEvidence(row({
    observed_reference: 'OBSERVED-ONLY-X', observed_reference_key: 'OBSERVEDONLYX',
    search_text: 'Rolex OBSERVED-ONLY-X 126334',
  }));
  assert.equal(result.decision, 'REVIEW_REQUIRED');
  assert.equal(result.model, null);
  assert.equal(evidence.buildModelEvidence(row({
    observed_reference: 'OBSERVED-ONLY-X', observed_reference_key: 'OBSERVEDONLYX',
    search_text: 'Rolex OBSERVED-ONLY-X 126334',
  })), null);
});

test('duplicates and non-current rows receive no evidence', () => {
  assert.equal(evidence.buildModelEvidence(row({ disposition: { duplicate: true } })), null);
  assert.equal(evidence.buildPriceEvidence(row({ current_status: 'SUPPRESSED_EXACT_DUPLICATE' })), null);
});

test('direct USD and USDT are verified without FX and WTB stays outside Price Research', () => {
  const usd = evidence.buildPriceEvidence(row({ source_price_amount: 25000, source_currency: 'USD' }));
  assert.equal(usd.normalized_usd_amount, 25000);
  assert.equal(usd.price_evidence_classification, 'SOURCE_EXPLICIT_USD_MATCH');
  assert.equal(usd.price_research_eligible, true);
  const usdt = evidence.buildPriceEvidence(row({
    intent: 'WTB', source_price_amount: 26000, source_currency: 'USDT',
  }));
  assert.equal(usdt.normalized_usd_amount, 26000);
  assert.equal(usdt.price_research_eligible, false);
});

test('dated ECB FX preserves source amount and qualifies only with exact applicable date', () => {
  const fx = {
    provider: 'ECB', source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/',
    applicable_date: '2026-08-23', effective_date: '2026-08-21', lookback_days: 2,
    rate_direction: 'USD_PER_SOURCE_UNIT', usd_per_source_unit: 0.128,
  };
  const result = evidence.buildPriceEvidence(row({
    source_price_amount: 100000, source_currency: 'HKD',
  }), fx);
  assert.equal(result.source_price_amount, 100000);
  assert.equal(result.source_currency, 'HKD');
  assert.equal(result.normalized_usd_amount, 12800);
  assert.equal(result.price_evidence_classification, 'DATED_VERIFIED_FX');
  assert.equal(evidence.buildPriceEvidence(row({
    source_price_amount: 100000, source_currency: 'HKD',
  }), { ...fx, applicable_date: '2026-08-22' }), null);
});

test('ECB cross-rate conversion uses USD per EUR divided by source units per EUR', () => {
  const csv = [
    'CURRENCY,TIME_PERIOD,OBS_VALUE',
    'USD,2026-08-21,1.20',
    'HKD,2026-08-21,9.36',
    'EUR,2026-08-21,1',
  ].join('\n');
  const rows = ecb.buildRates(csv, '2026-08-21', '2026-08-23',
    'https://data-api.ecb.europa.eu/service/data/EXR/test');
  const weekend = rows.find(item => item.applicable_date === '2026-08-23' && item.source_currency === 'HKD');
  assert.equal(weekend.effective_date, '2026-08-21');
  assert.equal(weekend.lookback_days, 2);
  assert.ok(Math.abs(weekend.usd_per_source_unit - (1.2 / 9.36)) < 1e-12);
});

test('unsupported peg currencies and missing dates remain unresolved', () => {
  const fx = {
    provider: 'ECB', source_url: 'https://data-api.ecb.europa.eu/service/data/EXR/',
    applicable_date: '2026-08-23', effective_date: '2026-08-22', lookback_days: 1,
    rate_direction: 'USD_PER_SOURCE_UNIT', usd_per_source_unit: 0.2723,
  };
  assert.equal(evidence.buildPriceEvidence(row({ source_price_amount: 100000, source_currency: 'AED' }), fx), null);
  assert.equal(evidence.buildPriceEvidence(row({
    source_timestamp: null, source_price_amount: 100000, source_currency: 'HKD',
  }), fx), null);
  assert.equal(evidence.buildPriceEvidence(row({ source_price_amount: 25000, source_currency: 'USD',
    price_evidence_classification: 'PRICE_MAPPING_REVIEW_REQUIRED' })), null);
});

test('migration is additive, append-only, lineage-bound, and source-table read-only', () => {
  const sql = fs.readFileSync(path.join(root,
    'supabase/migrations/20260827210000_curated_luxury_card_evidence_contract.sql'), 'utf8');
  assert.match(sql, /FROZEN_SOURCE_MODEL_AS_POSTED/);
  assert.match(sql, /CATALOG_EXACT_BRAND_REFERENCE/);
  assert.match(sql, /exact_child_text_sha256=c\.exact_child_text_sha256/);
  assert.match(sql, /fx_provider='ECB'/);
  assert.match(sql, /fx_lookback_days BETWEEN 0 AND 7/);
  assert.match(sql, /BEFORE UPDATE OR DELETE[\s\S]*reject_evidence_mutation/i);
  assert.match(sql, /image_evidence_type='SELLER_LISTING_IMAGE'/);
  assert.match(sql, /count\(DISTINCT c\.current_listing_key\)/i);
  assert.doesNotMatch(sql,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\.(?:raw_messages|raw_message_versions|curated_luxury_current_listings_shadow)/i);
});

test('manual evidence workflow is freeze-pinned and cannot load or switch customer sources', () => {
  const workflow = fs.readFileSync(path.join(root,
    '.github/workflows/qnsa-rolex-patek-card-evidence.yml'), 'utf8');
  assert.match(workflow, /run-id: '32953447624'/);
  assert.match(workflow, /17d6d83186cd8e675830c881bcf16e0d3c011ba1835eecf90710a4c665e4472a/);
  assert.match(workflow, /production_selector_changed == false/);
  const migration = fs.readFileSync(path.join(root,
    'supabase/migrations/20260827210000_curated_luxury_card_evidence_contract.sql'), 'utf8').replace(/\r\n/g, '\n');
  const migrationSha = crypto.createHash('sha256').update(migration).digest('hex');
  assert.match(workflow, new RegExp(migrationSha));
  assert.doesNotMatch(workflow, /CURATED_SHADOW_MARKET_SOURCE|CURATED_SHADOW_PRICE_SOURCE|ROLEX_PATEK_PUBLICATION_MODE/);
  assert.doesNotMatch(workflow, /load.*card.*evidence/i);
});

test('mandatory display fallbacks stay visible without inventing evidence', () => {
  const ui = fs.readFileSync(path.join(root, 'src/pages/TradingFloor.tsx'), 'utf8');
  const contract = fs.readFileSync(path.join(root, 'config/watchfacts-global-customer-data-contract.json'), 'utf8');
  assert.match(ui, /Model requires review/);
  assert.match(ui, /Location not provided/);
  assert.match(ui, /Posting date requires review/);
  assert.match(ui, /Posting identity requires review/);
  assert.match(ui, /Open for rating/);
  assert.match(ui, /ambiguousPriceDisplay/);
  assert.match(contract, /"ambiguous_price_display": "Price requires review"/);
  assert.match(ui, /NO IMAGE/);
  assert.match(ui, /Original source price:/);
});

test('new card and Price Research projections require an explicit selector', async () => {
  const prior = process.env.CURATED_LUXURY_CARD_EVIDENCE_SOURCE;
  process.env.CURATED_LUXURY_CARD_EVIDENCE_SOURCE = shadow.CARD_EVIDENCE_SELECTOR;
  const calls = [];
  const client = { rpc: async (name) => {
    calls.push(name);
    if (name.includes('page_keys')) return { data: { keys: ['listing-1'], key_lanes: { 'listing-1': 0 }, has_more: false }, error: null };
    if (name.includes('count')) return { data: { total: 1, source: 'test' }, error: null };
    if (name.includes('cards')) return { data: [{ id: 'listing-1', brand: 'Patek Philippe' }], error: null };
    return { data: { stats: { count: 0 }, wtb_count: 0, rows: [] }, error: null };
  } };
  try {
    await shadow.loadInventory(client, { brand: 'Patek Philippe', listingType: null, countries: null,
      pricedOnly: false, imagesOnly: false, search: null, reference: null,
      page: 1, pageSize: 24, cursor: null });
    assert.deepEqual(calls, ['curated_luxury_shadow_customer_page_keys_v8',
      'curated_luxury_shadow_customer_count_v4', 'curated_luxury_shadow_customer_cards_v5']);
    calls.length = 0;
    await shadow.loadPriceResearch(client, { brand: 'Patek Philippe', reference: '5711/1A-010' });
    assert.deepEqual(calls, ['curated_luxury_shadow_price_research_v3']);
  } finally {
    if (prior === undefined) delete process.env.CURATED_LUXURY_CARD_EVIDENCE_SOURCE;
    else process.env.CURATED_LUXURY_CARD_EVIDENCE_SOURCE = prior;
  }
});
