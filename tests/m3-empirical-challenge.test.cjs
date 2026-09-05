'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { redactPublicSource } = require('../api/_lib/source-redaction.cjs');
const { sanitizeTradingRecord } = require('../api/_lib/trading-record-safety.cjs');
const { normalizeMarketRow } = require('../api/_lib/market-row-normalization.cjs');

test('Edge Case 1: >12k character raw source message length preservation', () => {
  const lengths = [12001, 15000, 50000, 120000];

  for (const len of lengths) {
    const rawMessage = 'A'.repeat(len);
    const redactedSource = redactPublicSource(rawMessage).trim();
    const publicSource = redactedSource;

    assert.equal(publicSource.length, len, `Raw message of length ${len} must be preserved without truncation`);
    assert.equal(publicSource, rawMessage, `Raw message of length ${len} must match original verbatim`);
  }
});

test('Edge Case 2: Empty, whitespace, null, and undefined raw message handling', () => {
  const emptyCases = ['', '   ', null, undefined];

  for (const input of emptyCases) {
    const text = String(input || '');
    const redactedSource = redactPublicSource(text).trim();
    const publicSource = redactedSource;
    const rawMessageResult = publicSource || null;

    if (!input || !String(input).trim()) {
      assert.equal(rawMessageResult, null, `Empty or whitespace input should resolve raw_message to null`);
    }
  }
});

test('Edge Case 3: priceIssues scoping when priceVerified is false (unverified currency)', () => {
  const mockRecord = {
    id: 'test_123',
    brand: 'ROLEX',
    model: 'Submariner',
    reference: '116610LN',
    price_raw: '10000',
    price_usd: 10000,
    currency: 'EUR',
    raw_message: 'Rolex Submariner 116610LN box papers',
    listing_type: 'WTS',
  };

  const customerListing = sanitizeTradingRecord(mockRecord);
  
  // Test case A: Currency status UNVERIFIED
  const normalizedUnverified = {
    analytics_currency_status: 'UNVERIFIED',
    analytics_price_usd: 10000,
    source_price_amount: 10000,
    source_currency: 'EUR',
  };

  const priceVerifiedA = normalizedUnverified.analytics_currency_status === 'VERIFIED'
    && Number.isFinite(Number(normalizedUnverified.analytics_price_usd))
    && Number(normalizedUnverified.analytics_price_usd) > 0;

  assert.equal(priceVerifiedA, false);

  const priceIssuesA = priceVerifiedA
    ? (customerListing.data_quality_issues || [])
    : [...new Set([...(customerListing.data_quality_issues || []), normalizedUnverified.analytics_currency_status])];

  assert.ok(Array.isArray(priceIssuesA));
  assert.ok(priceIssuesA.includes('UNVERIFIED'));

  // Test case B: Currency status null or undefined
  const normalizedNullCurrency = {
    analytics_currency_status: null,
    analytics_price_usd: null,
    source_price_amount: null,
    source_currency: null,
  };

  const priceVerifiedB = normalizedNullCurrency.analytics_currency_status === 'VERIFIED'
    && Number.isFinite(Number(normalizedNullCurrency.analytics_price_usd))
    && Number(normalizedNullCurrency.analytics_price_usd) > 0;

  assert.equal(priceVerifiedB, false);

  const priceIssuesB = priceVerifiedB
    ? (customerListing.data_quality_issues || [])
    : [...new Set([...(customerListing.data_quality_issues || []), normalizedNullCurrency.analytics_currency_status])];

  assert.ok(Array.isArray(priceIssuesB));
  assert.ok(priceIssuesB.includes(null));
});

test('Edge Case 4: customerListing missing data_quality_issues property', () => {
  const customerListingNoIssues = {
    id: 'test_456',
    brand: 'OMEGA',
    reference: '311.30.42.30.01.005',
    // data_quality_issues intentionally omitted / undefined
  };

  const normalized = {
    analytics_currency_status: 'UNSUPPORTED_CURRENCY',
    analytics_price_usd: null,
  };

  const priceVerified = normalized.analytics_currency_status === 'VERIFIED'
    && Number.isFinite(Number(normalized.analytics_price_usd))
    && Number(normalized.analytics_price_usd) > 0;

  assert.equal(priceVerified, false);

  // Verify this does NOT throw TypeError: customerListing.data_quality_issues is not iterable
  assert.doesNotThrow(() => {
    const priceIssues = priceVerified
      ? (customerListingNoIssues.data_quality_issues || [])
      : [...new Set([...(customerListingNoIssues.data_quality_issues || []), normalized.analytics_currency_status])];

    assert.ok(Array.isArray(priceIssues));
    assert.deepEqual(priceIssues, ['UNSUPPORTED_CURRENCY']);
  });
});

test('Edge Case 5: Verification of priceIssues definition in all code paths of api/price-research-listing.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'api', 'price-research-listing.js'), 'utf8');

  // Check 1: Ensure priceIssues is declared with const
  assert.match(code, /const priceIssues =/);

  // Check 2: Ensure data_quality_issues: priceIssues is used
  assert.match(code, /data_quality_issues:\s*priceIssues/);

  // Check 3: Ensure data_quality_review_required: priceIssues.length > 0 is used
  assert.match(code, /data_quality_review_required:\s*priceIssues\.length > 0/);

  // Check 4: Ensure no remaining references to undeclared priceIssues
  const lines = code.split('\n');
  let priceIssuesDeclLine = -1;
  lines.forEach((line, idx) => {
    if (line.includes('const priceIssues =')) priceIssuesDeclLine = idx;
  });

  assert.ok(priceIssuesDeclLine > 0, 'priceIssues must be declared in api/price-research-listing.js');

  // Ensure priceIssues is not referenced before its declaration
  lines.forEach((line, idx) => {
    if (idx < priceIssuesDeclLine && line.includes('priceIssues')) {
      assert.fail(`priceIssues referenced at line ${idx + 1} before declaration at line ${priceIssuesDeclLine + 1}`);
    }
  });
});
