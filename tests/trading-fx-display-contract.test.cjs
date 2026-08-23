'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { listEquivalentReferences } = require('../api/_lib/catalog');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');

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

test('Trading Floor publishes exact source HKD without converting it to USD', () => {
  const ingest = fs.readFileSync(path.join(root, 'api', 'ingest.js'), 'utf8');
  const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

  assert.match(ingest, /listEquivalentReferences\(resolved\.reference,\s*resolved\.brand\)/);
  assert.match(ingest, /price_raw:\s*normalized\.source_price_amount/);
  assert.match(ingest, /currency:\s*priceVerified\s*\?\s*'USD'\s*:\s*normalized\.source_currency/);
  assert.match(trading, /function formatSourcePrice/);
  assert.match(trading, /listing\.source_currency[\s\S]*listing\.currency/);
  assert.match(trading, /listing\.source_price_text/);
  assert.match(trading, /sourcePrice \? 'Source price'/);
  assert.match(trading, /listing\.price_evidence_status === 'EXPLICIT_SOURCE_FX_CONVERTED'/);
  assert.doesNotMatch(trading, /USD conversion unavailable/);
  assert.doesNotMatch(trading, /Exact source currency is being verified/);
});

test('Price Research labels excluded HKD evidence in its source currency', () => {
  const api = fs.readFileSync(path.join(root, 'api', 'price-research.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');

  assert.match(api, /source_price_amount:\s*r\.source_price_amount/);
  assert.match(api, /source_currency:\s*r\.source_currency/);
  assert.match(ui, /row\.source_price_amount\s*&&\s*row\.source_currency/);
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
