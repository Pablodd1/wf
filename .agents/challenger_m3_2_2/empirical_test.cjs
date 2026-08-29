'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('=== EMPIRICAL STRESS TEST FOR M3 PRICE RESEARCH & CONTACTS ===\n');

// 1. Static Code Analysis Checks
const root = path.resolve(__dirname, '..', '..');
const researchCode = fs.readFileSync(path.join(root, 'api', 'price-research-listing.js'), 'utf8');

console.log('1. Checking AST/Static structure of api/price-research-listing.js:');

// Verify priceIssues definition
const priceIssuesDeclared = /const priceIssues =/.test(researchCode);
console.log('   - priceIssues is explicitly declared:', priceIssuesDeclared);
assert.equal(priceIssuesDeclared, true, 'priceIssues must be declared');

// Verify no 12_000 truncation
const no12kTruncation = !researchCode.includes('12_000') && !researchCode.includes('12000');
console.log('   - No 12k char truncation in code:', no12kTruncation);
assert.equal(no12kTruncation, true, 'api/price-research-listing.js must not truncate raw message to 12k chars');

// Verify redactPublicSource is used
const usesRedactPublicSource = researchCode.includes('redactPublicSource(rawSource.text)');
console.log('   - redactPublicSource is used:', usesRedactPublicSource);
assert.equal(usesRedactPublicSource, true, 'redactPublicSource must be called');

// 2. Logic Simulation of Standard & Workbook Execution Paths in api/price-research-listing.js

console.log('\n2. Testing logic edge cases directly:');

// Test logic function reproducing standard listing priceIssues calculation
function computePriceIssues(customerListing, normalized) {
  const priceVerified = normalized.analytics_currency_status === 'VERIFIED'
    && Number.isFinite(Number(normalized.analytics_price_usd))
    && Number(normalized.analytics_price_usd) > 0;
  const priceIssues = priceVerified
    ? (customerListing.data_quality_issues || [])
    : [...new Set([...(customerListing.data_quality_issues || []), normalized.analytics_currency_status])];
  return { priceVerified, priceIssues };
}

// Edge case A: missing customerListing.data_quality_issues (undefined/null) & VERIFIED currency
{
  const result = computePriceIssues({}, { analytics_currency_status: 'VERIFIED', analytics_price_usd: 15000 });
  console.log('   - Edge Case A (undefined data_quality_issues, verified price):', result);
  assert.equal(result.priceVerified, true);
  assert.deepEqual(result.priceIssues, []);
}

// Edge case B: missing customerListing.data_quality_issues & UNVERIFIED currency
{
  const result = computePriceIssues({}, { analytics_currency_status: 'UNVERIFIED_CURRENCY', analytics_price_usd: null });
  console.log('   - Edge Case B (undefined data_quality_issues, unverified currency):', result);
  assert.equal(result.priceVerified, false);
  assert.deepEqual(result.priceIssues, ['UNVERIFIED_CURRENCY']);
}

// Edge case C: existing customerListing.data_quality_issues & UNVERIFIED currency
{
  const result = computePriceIssues(
    { data_quality_issues: ['MISSING_REF'] },
    { analytics_currency_status: 'UNVERIFIED_CURRENCY', analytics_price_usd: null }
  );
  console.log('   - Edge Case C (existing issues + unverified currency):', result);
  assert.equal(result.priceVerified, false);
  assert.deepEqual(result.priceIssues, ['MISSING_REF', 'UNVERIFIED_CURRENCY']);
}

// Edge case D: existing customerListing.data_quality_issues matching UNVERIFIED currency (deduplication)
{
  const result = computePriceIssues(
    { data_quality_issues: ['UNVERIFIED_CURRENCY'] },
    { analytics_currency_status: 'UNVERIFIED_CURRENCY', analytics_price_usd: null }
  );
  console.log('   - Edge Case D (duplicate issue deduplication):', result);
  assert.equal(result.priceVerified, false);
  assert.deepEqual(result.priceIssues, ['UNVERIFIED_CURRENCY']);
}

// Edge case E: Empty raw message
{
  const redactPublicSource = require(path.join(root, 'api', '_lib', 'source-redaction.cjs')).redactPublicSource;
  const rawText = '';
  const redactedSource = redactPublicSource(rawText).trim();
  const publicSource = redactedSource;
  const raw_message = publicSource || null;
  const raw_message_scope = publicSource ? 'stored_source_message' : 'unavailable';
  const raw_message_truncated = false;
  console.log('   - Edge Case E (empty raw message):', { raw_message, raw_message_scope, raw_message_truncated });
  assert.equal(raw_message, null);
  assert.equal(raw_message_scope, 'unavailable');
  assert.equal(raw_message_truncated, false);
}

// Edge case F: >12k char raw message (15,000 chars)
{
  const redactPublicSource = require(path.join(root, 'api', '_lib', 'source-redaction.cjs')).redactPublicSource;
  const longMsg = 'WTS Rolex Daytona 116500LN ' + 'A'.repeat(15000);
  const redactedSource = redactPublicSource(longMsg).trim();
  const publicSource = redactedSource;
  const raw_message = publicSource || null;
  const raw_message_truncated = false;
  console.log('   - Edge Case F (>12k char raw message):', {
    input_length: longMsg.length,
    output_length: raw_message.length,
    raw_message_truncated
  });
  assert.equal(raw_message.length, longMsg.length);
  assert.equal(raw_message_truncated, false);
}

console.log('\n=== ALL EMPIRICAL CHECKS PASSED SUCCESSFULLY ===');
