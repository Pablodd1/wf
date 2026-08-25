'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const contract = JSON.parse(fs.readFileSync(
  path.join(root, 'config', 'watchfacts-global-customer-data-contract.json'),
  'utf8',
));

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

test('one global evidence contract owns exactly the six requested brands', () => {
  assert.deepEqual(contract.brands, [
    'Rolex', 'Patek Philippe', 'Tudor', 'Zenith', 'Cartier', 'TAG Heuer',
  ]);
  assert.equal(contract.canonical_project_ref, 'qnsafosakvonzgfcsphh');
  assert.equal(contract.reference_identity.match, 'exact_brand_and_canonical_reference');
  assert.equal(contract.price_research.intent, 'WTS');
  assert.equal(contract.price_research.wtb_affects_price_analytics, false);
  assert.equal(contract.listing_counts.independent_of_price_research, true);
  assert.equal(contract.customer_publication.preserve_raw_message, true);
  assert.equal(contract.customer_publication.preserve_existing_historical_normalized_data, true);
});

test('ambiguous price/currency evidence remains review-only', () => {
  for (const classification of [
    'BARE_DOLLAR_AMBIGUOUS',
    'CURRENCYLESS_AMOUNT',
    'FX_PROVENANCE_MISSING',
    'MULTIPLE_PRICE_AMBIGUOUS',
    'BUNDLE_PRICE_AMBIGUOUS',
    'SOURCE_PRICE_CONFLICT',
  ]) {
    assert.ok(contract.price_currency_evidence.review_only_classes.includes(classification));
    assert.ok(!contract.price_currency_evidence.qualified_classes.includes(classification));
  }
  assert.equal(contract.dealer_identity.fabrication_allowed, false);
  assert.equal(contract.dealer_identity.rating_requires_source_evidence, true);
});

test('forbidden customer literals cannot appear in customer-facing source', () => {
  const customerSource = sourceFiles(path.join(root, 'src'))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  for (const literal of contract.customer_publication.forbidden_literals) {
    assert.doesNotMatch(customerSource, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('posting identity uses evidence priority and a non-identity role fallback', () => {
  assert.deepEqual(contract.dealer_identity.priority.slice(0, 5), [
    'canonical_dealer_name', 'linked_dealer_name', 'dealer_name', 'seller_name', 'posted_by',
  ]);
  assert.equal(contract.dealer_identity.missing_identity_display, 'Source poster');
  const resolver = fs.readFileSync(path.join(root, 'src', 'lib', 'customerEvidence.ts'), 'utf8');
  assert.match(resolver, /source dealer\|source poster\|dealer profile/);
});

test('Trading Floor never rates or labels owner-assumed evidence as verified USD', () => {
  const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(trading, /function displayUsdPrice[\s\S]*?return verifiedUsdPrice\(listing\)/);
  assert.match(trading, /function ratingUsdPrice[\s\S]*?return verifiedUsdPrice\(listing\)/);
  assert.doesNotMatch(trading, /function displayUsdPrice[\s\S]*?OWNER_ASSUMED_USD/);
});
