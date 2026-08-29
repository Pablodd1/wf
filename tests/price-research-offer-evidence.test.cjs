'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';

const {
  classifyResearchEligibility,
  classifySaleEvidenceEligibility,
} = require('../api/_lib/price-research-eligibility.cjs');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');
const {
  isCustomerPricedSaleEvidence,
  serializePriceProvenance,
} = require('../api/price-research.js');
const priceResearchSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research.js'), 'utf8');

const exactOffer = {
  id: 'offer-1',
  brand: 'Cartier',
  model: 'Santos',
  reference: 'WSSA0032',
  dial_color: 'Silver',
  listing_type: 'WTS',
  price_usd: 22_500,
  source_price_amount: 22_500,
  source_currency: 'USD',
  analytics_currency_status: 'VERIFIED',
};

test('a trustworthy exact WTS offer remains customer evidence even when catalog qualification fails', () => {
  assert.equal(classifySaleEvidenceEligibility(exactOffer), null);
  assert.equal(isCustomerPricedSaleEvidence(exactOffer), true);
  assert.equal(
    classifyResearchEligibility(exactOffer, { found: false, model: null, dialColors: [] }),
    'CATALOG_MODEL_UNCONFIRMED',
  );
});

test('WTB never becomes WTS offer evidence or an analytics candidate even when it carries a price', () => {
  const wtb = { ...exactOffer, listing_type: 'WTB' };
  assert.equal(classifySaleEvidenceEligibility(wtb), 'NOT_WTS_SALE');
  assert.equal(classifyResearchEligibility(wtb, { found: true, model: 'Santos', dialColors: ['Silver'] }), 'NOT_WTS_SALE');
  assert.equal(isCustomerPricedSaleEvidence(wtb), false);
});

test('bare dollar evidence is accounted but cannot silently become verified USD', () => {
  const normalized = normalizeMarketRow({
    price_usd: 85_000,
    raw_message: 'WTS Cartier WSSA0032 Silver $85k',
  }, ['WSSA0032']);
  assert.equal(normalized.analytics_currency_status, 'AMBIGUOUS_DOLLAR_CURRENCY');
  assert.equal(normalized.source_currency, null);
  assert.equal(normalized.source_currency_evidence, 'BARE_DOLLAR_UNRESOLVED');
  assert.equal(classifySaleEvidenceEligibility({ ...exactOffer, ...normalized }), 'AMBIGUOUS_DOLLAR_CURRENCY');
});

test('dated named-currency FX evidence remains visible with complete provenance', () => {
  const fxOffer = {
    ...exactOffer,
    source_price_amount: 174_000,
    source_currency: 'HKD',
    analytics_fx_rate: 0.1282,
    analytics_fx_source: 'ECB_DATED_RATE',
    analytics_fx_date: '2026-08-11',
    effective_price_source: 'SIDECAR_CORRECTION',
  };
  assert.equal(classifySaleEvidenceEligibility(fxOffer), null);
  assert.deepEqual(serializePriceProvenance(fxOffer), {
    source_price_amount: 174_000,
    source_currency: 'HKD',
    price_evidence_status: 'VERIFIED',
    effective_price_source: 'SIDECAR_CORRECTION',
    fx_rate: 0.1282,
    fx_source: 'ECB_DATED_RATE',
    fx_date: '2026-08-11',
  });
  assert.equal(classifySaleEvidenceEligibility({ ...fxOffer, analytics_fx_date: null }), 'FX_PROVENANCE_MISSING');
});

test('Price Research never fabricates a cohort from the browser archive', () => {
  assert.doesNotMatch(priceResearchSource, /public[^\n]+parsedWatches\.json/);
  assert.doesNotMatch(priceResearchSource, /top_watches_trading_floor\.json/);
  assert.doesNotMatch(priceResearchSource, /currency:\s*String\([^\n]+\|\|\s*'USD'\)/);
});
