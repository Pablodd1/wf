'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyEffectivePrice, resolveEffectivePrice } = require('../api/_lib/corrected-price-source.cjs');

test('qualified corrected USD takes precedence over the existing verified price', () => {
  const effective = resolveEffectivePrice({
    verified_price_usd: 10000, has_verified_usd_price: true,
    corrected_price_usd: 38500, corrected_source_amount: 300000,
    corrected_source_currency: 'HKD', corrected_fx_rate: 0.128333,
    corrected_fx_source: 'ECB_REFERENCE_RATES', corrected_fx_date: '2026-08-11',
    price_correction_status: 'QUALIFIED', price_correction_id: 'correction-1',
    price_correction_key: 'three-brand-v1',
  });
  assert.equal(effective.price_usd, 38500);
  assert.equal(effective.source, 'SIDECAR_CORRECTION');
  assert.equal(effective.correction_applied, true);
});

test('direct USD correction requires lineage but not an FX rate', () => {
  const effective = resolveEffectivePrice({
    corrected_price_usd: 37000, corrected_source_amount: 37000,
    corrected_source_currency: 'USD', price_correction_status: 'QUALIFIED',
    price_correction_id: 'correction-2', price_correction_key: 'three-brand-v1',
  });
  assert.equal(effective.price_usd, 37000);
  assert.equal(effective.fx_rate, 1);
  assert.equal(effective.has_verified_usd_price, true);
});

test('incomplete or unqualified correction fails closed to the base verified price', () => {
  for (const patch of [
    { price_correction_status: 'NEEDS_REVIEW' },
    { price_correction_status: 'QUALIFIED', corrected_fx_source: null },
    { price_correction_status: 'QUALIFIED', price_correction_id: null },
  ]) {
    const effective = resolveEffectivePrice({
      verified_price_usd: 25000, has_verified_usd_price: true,
      corrected_price_usd: 99999, corrected_source_amount: 780000,
      corrected_source_currency: 'HKD', corrected_fx_rate: 0.128,
      corrected_fx_source: 'ECB', corrected_fx_date: '2026-08-11',
      price_correction_id: 'correction-3', price_correction_key: 'three-brand-v1',
      ...patch,
    });
    assert.equal(effective.price_usd, 25000);
    assert.equal(effective.source, 'BASE_VERIFIED_PRICE');
    assert.equal(effective.correction_applied, false);
  }
});

test('no-price and WTB evidence remain no-price when correction is not qualified', () => {
  const row = applyEffectivePrice({ listing_type: 'WTB', has_verified_usd_price: false });
  assert.equal(row.verified_price_usd, null);
  assert.equal(row.has_verified_usd_price, false);
  assert.equal(row.effective_price_source, 'NO_VERIFIED_PRICE');
});

test('customer APIs integrate the overlay without creating a second inventory path', () => {
  const root = path.join(__dirname, '..');
  const trading = fs.readFileSync(path.join(root, 'api', 'reviewed-market-inventory.js'), 'utf8');
  const research = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
  const analytics = fs.readFileSync(path.join(root, 'api', '_lib', 'reviewed-workbook-analytics.cjs'), 'utf8');
  assert.match(trading, /applyEffectivePrice\(row\)/);
  assert.match(trading, /corrected_price_usd/);
  assert.match(research, /price_correction_applied === true/);
  assert.match(research, /QUALIFIED_SIDECAR_CORRECTION/);
  assert.match(research, /qnsa_three_brand_fx_price_research_rows/);
  assert.match(research, /qnsa_bounded_price_research_rows/);
  assert.doesNotMatch(trading, /qnsa_three_brand_fx_trading_floor_rows/);
  assert.match(trading, /qnsa_market_feed_page_rows/);
  assert.match(research, /\.eq\('listing_type', 'WTS'\)/);
  assert.match(research, /loadQnsaTradingDemand/);
  assert.match(analytics, /applyEffectivePrice\(row\)/);
  assert.doesNotMatch(`${trading}\n${research}\n${analytics}`, /\.from\(['"]three_brand_fx_sidecar/);
});
