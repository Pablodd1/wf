const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'featuredListings.ts'), 'utf8')
  .replace(/type FeaturedListing = \{[\s\S]*?\};\r?\n/, '')
  .replace(/: string \| null \| undefined/g, '')
  .replace(/: FeaturedListing/g, '')
  .replace('export function', 'function');

const load = new Function(`${source}\nreturn { isCustomerSafeFeaturedListing };`);
const { isCustomerSafeFeaturedListing } = load();

const valid = {
  brand: 'Rolex', reference: '126334', dial_color: 'Blue', price_usd: 13_500,
  verdict: 'APPROVED', listing_type: 'WTS', confidence: 90, has_images: true,
  thumbnail_url: 'https://example.com/watch.jpg',
};

test('accepts a complete approved image-backed WTS listing', () => {
  assert.equal(isCustomerSafeFeaturedListing(valid), true);
});

test('rejects implausible prices, incomplete identity, and review records', () => {
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, price_usd: 244 }), false);
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, price_usd: 2025 }), false);
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, dial_color: 'Unknown' }), false);
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, brand: 'N/A' }), false);
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, verdict: 'HUMAN' }), false);
});

test('rejects confidence values outside the 0-100 contract', () => {
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, confidence: 1000 }), false);
  assert.equal(isCustomerSafeFeaturedListing({ ...valid, confidence: 84 }), false);
});
