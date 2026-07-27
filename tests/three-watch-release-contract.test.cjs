'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('all customer listing surfaces enforce the reference release gate', () => {
  for (const relativePath of [
    'api/price-research.js',
    'api/price-research-listing.js',
    'api/trading-listing.js',
    'api/listing-contact.js',
    'api/featured-listings.js',
    'api/catalog-models.js',
    'api/catalog-references.js',
  ]) {
    assert.match(read(relativePath), /isPublicationReferenceAllowed/);
  }
  const ingest = read('api/ingest.js');
  assert.match(ingest, /publicationReferencePostgrestFilter/);
  assert.match(ingest, /canonical_reference/);
  assert.match(ingest, /isPublicationReferenceAllowed\(record\.brand, record\.reference\)/);
});

test('market analytics ignore condition while retaining it on listing evidence', () => {
  const api = read('api/price-research.js');
  const research = read('src/pages/PriceResearch.tsx');
  const floor = read('src/pages/TradingFloor.tsx');

  assert.doesNotMatch(api, /req\.query\.condition/);
  assert.match(api, /condition: 'All conditions'/);
  assert.match(api, /analytics_dimensions: \['brand', 'reference', 'dial_color'\]/);
  assert.match(api, /listing_description_retained: true/);
  assert.doesNotMatch(research, /params\.set\('condition'/);
  assert.doesNotMatch(floor, /if \(listing\.condition\) params\.set\('condition'/);
  assert.match(research, /<DetailField label="Condition" value=\{detail\.condition\}/);
  assert.match(floor, /cleanValue\(detailListing\.condition\)/);
});

test('the release image lane is exact, authenticated, and human-signed', () => {
  const queue = read('api/image-review-queue.js');
  const decision = read('api/image-review-decision.js');
  const ui = read('src/pages/ReviewQueue.tsx');

  assert.match(queue, /releaseOnly/);
  assert.match(queue, /publicationReferences\(\)/);
  assert.match(ui, /image-review-queue\?release=true/);
  assert.match(decision, /auth\.user\.email \|\| auth\.user\.id/);
  assert.match(decision, /MATCH: 'VISUALLY_VERIFIED'/);
  assert.match(decision, /\.rpc\('apply_listing_image_review'/);
});

test('the CTO control center points to the three-watch decision record', () => {
  const control = read('docs/CTO_CONTROL_CENTER.md');
  const release = read('docs/THREE_WATCH_CLIENT_RELEASE_2026-07-27.md');
  assert.match(control, /THREE_WATCH_CLIENT_RELEASE_2026-07-27\.md/);
  assert.match(release, /Rolex 116610LN/);
  assert.match(release, /Patek Philippe 5712\/1A-001/);
  assert.match(release, /Rolex 126710BLNR/);
  assert.match(release, /zero production record writes/i);
});
