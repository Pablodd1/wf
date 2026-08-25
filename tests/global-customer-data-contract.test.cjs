'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { postingIdentityStatus, resolvePostingIdentity } = require('../api/_lib/global-customer-data-contract.cjs');

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

test('posting identity uses evidence priority and has no customer-facing role fallback', () => {
  assert.deepEqual(contract.dealer_identity.priority.slice(0, 7), [
    'canonical_dealer_name', 'linked_dealer_name', 'dealer_name', 'source_dealer_name',
    'source_identity_name', 'seller_name', 'posted_by',
  ]);
  assert.equal(contract.dealer_identity.review_status, 'DEALER_IDENTITY_REVIEW_REQUIRED');
  assert.equal(contract.dealer_identity.generic_roles_are_identities, false);
  assert.equal('missing_identity_display' in contract.dealer_identity, false);
  const resolver = fs.readFileSync(path.join(root, 'src', 'lib', 'customerEvidence.ts'), 'utf8');
  assert.match(resolver, /generic_placeholders/);
  assert.doesNotMatch(resolver, /missingPostingIdentityDisplay/);
});

test('generic role labels, telephone and source accounts cannot resolve dealer identity', () => {
  for (const placeholder of [
    ...contract.dealer_identity.generic_placeholders,
    'Unknown Dealer', 'Anonymous User', 'Dealer name unavailable', 'Seller not available',
  ]) {
    assert.equal(resolvePostingIdentity({ seller_name: placeholder, posted_by: placeholder }), null);
    assert.equal(postingIdentityStatus({ source_poster_name: placeholder }), 'DEALER_IDENTITY_REVIEW_REQUIRED');
  }
  assert.equal(resolvePostingIdentity({ seller_phone: '+1 212 555 0100', source_account: 'acct-9' }), null);
  assert.deepEqual(resolvePostingIdentity({
    canonical_dealer_name: 'Canonical Dealer',
    linked_dealer_name: 'Linked Dealer',
    seller_name: 'Seller Name',
  }), { name: 'Canonical Dealer', source: 'canonical_dealer_name' });
  assert.deepEqual(resolvePostingIdentity({ source_poster_name: 'Pierre Duchateau Stg4' }), {
    name: 'Pierre Duchateau Stg4', source: 'source_poster_name',
  });
});

test('Trading Floor never rates or labels owner-assumed evidence as verified USD', () => {
  const trading = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
  assert.match(trading, /function displayUsdPrice[\s\S]*?return verifiedUsdPrice\(listing\)/);
  assert.match(trading, /function ratingUsdPrice[\s\S]*?return verifiedUsdPrice\(listing\)/);
  assert.doesNotMatch(trading, /function displayUsdPrice[\s\S]*?OWNER_ASSUMED_USD/);
});
