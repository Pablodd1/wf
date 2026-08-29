'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { listEquivalentReferences } = require('../api/_lib/catalog');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');
const shadow = require('../api/_lib/curated-luxury-shadow.cjs');

const root = path.join(__dirname, '..');

test('Trading Floor canonical Patek references retain the claimed reference for exact price evidence', () => {
  const references = listEquivalentReferences('5712/1A-001', 'Patek Philippe');
  const normalized = normalizeMarketRow({
    price_usd: 871000,
    raw_message: 'Patek Philippe 5712/1A blue 2020 HKD 871k',
  }, references);

  assert.ok(references.includes('5712/1A'));
  assert.equal(normalized.source_price_amount, 871000);
  assert.equal(normalized.source_currency, 'HKD');
  assert.equal(normalized.analytics_currency_status, 'CURRENCY_RATE_UNVERIFIED');
});

test('Rolex and Patek cards expose only verified USD as the primary customer price', () => {
  const ingest = fs.readFileSync(path.join(root, 'api', 'ingest.js'), 'utf8');
  const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

  assert.match(ingest, /listEquivalentReferences\(resolved\.reference,\s*resolved\.brand\)/);
  assert.match(ingest, /price_raw:\s*normalized\.source_price_amount/);
  assert.match(ingest, /currency:\s*priceVerified\s*\?\s*'USD'\s*:\s*normalized\.source_currency/);
  assert.match(trading, /USD is the only primary customer price/);
  assert.match(trading, /ambiguousPriceDisplay/);
  for (const brand of ['Rolex', 'Patek Philippe']) {
    const verified = shadow.mapCard({ id: brand, brand, source_price_amount: 100000,
      source_currency: 'HKD', price_usd: 12800, price_verified: true,
      price_evidence_classification: 'DATED_VERIFIED_FX' });
    assert.equal(verified.price_usd, 12800);
    assert.equal(verified.currency, 'USD');
    const unresolved = shadow.mapCard({ id: `${brand}-review`, brand,
      source_price_amount: 100000, source_currency: 'HKD', price_verified: false,
      raw_message: 'Exact source text remains accessible' });
    assert.equal(unresolved.price_usd, null);
    assert.equal(unresolved.price_raw, null);
    assert.equal(unresolved.source_price_amount, null);
    assert.equal(unresolved.source_currency, null);
    assert.equal(unresolved.raw_message, 'Exact source text remains accessible');
  }
});

test('Rolex and Patek Price Research uses normalized USD and applies real 3x IQR exclusions', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations',
    '20260827210000_curated_luxury_card_evidence_contract.sql'), 'utf8');
  const shadowSource = fs.readFileSync(path.join(root, 'api', '_lib', 'curated-luxury-shadow.cjs'), 'utf8');
  assert.match(sql, /p\.decision='VERIFIED' AND p\.price_research_eligible/);
  assert.match(sql, /pre_filter_count>=4[\s\S]*is_outlier/i);
  assert.match(sql, /FROM retained/);
  assert.match(shadowSource, /const outliers = Number\(data\?\.stats\?\.outlier_count/);
  assert.match(shadowSource, /excluded_count: outliers/);
});

test('Listing detail uses reference aliases and preserves exact source currency', () => {
  const detail = fs.readFileSync(path.join(root, 'api', 'price-research-listing.js'), 'utf8');
  const tradingDetail = fs.readFileSync(path.join(root, 'api', 'trading-listing.js'), 'utf8');

  assert.match(detail, /listEquivalentReferences\(resolvedData\.reference,\s*resolvedData\.brand\)/);
  assert.match(detail, /price_raw:\s*normalized\.source_price_amount/);
  assert.match(detail, /currency:\s*priceVerified\s*\?\s*'USD'\s*:\s*normalized\.source_currency/);
  assert.match(tradingDetail, /listEquivalentReferences\(resolvedData\.reference,\s*resolvedData\.brand\)/);
  assert.match(tradingDetail, /listing\.price_raw\s*=\s*reviewedWorkbookPrice/);
  assert.match(tradingDetail, /listing\.currency\s*=\s*reviewedWorkbookPrice/);
  assert.match(tradingDetail, /priceVerified\s*\?\s*'USD'\s*:\s*normalized\.source_currency/);
});

test('all customer price surfaces use equivalent reference evidence', () => {
  for (const relativePath of [
    'api/featured-listings.js',
    'api/catalog-references.js',
    'api/export-excel.js',
  ]) {
    assert.match(
      fs.readFileSync(path.join(root, relativePath), 'utf8'),
      /listEquivalentReferences\(/,
      relativePath,
    );
  }
});
