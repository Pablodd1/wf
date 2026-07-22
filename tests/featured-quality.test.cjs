const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogReferenceIsExact, comparableStats, hasPriceToken, verifyFeaturedRecord } = require('../api/_lib/featured-quality.cjs');

test('requires an exact catalog identity, not a partial reference match', () => {
  assert.equal(catalogReferenceIsExact({ reference: '5712/1A' }, { found: true, matchType: 'exact', matchedRef: '5712/1A' }), true);
  assert.equal(catalogReferenceIsExact({ reference: '5712' }, { found: true, matchType: 'partial', matchedRef: '5712/1A' }), false);
});

test('requires price evidence beyond the reference and year', () => {
  assert.equal(hasPriceToken('5712/1A 2024 New', '5712/1A'), false);
  assert.equal(hasPriceToken('5712/1A 2024 New HKD 1.2m', '5712/1A'), true);
});

test('builds an outlier-clean comparable range only with five or more points', () => {
  assert.equal(comparableStats([{ price_usd: 10000 }, { price_usd: 11000 }, { price_usd: 12000 }, { price_usd: 13000 }]), null);
  const stats = comparableStats([10000, 11000, 12000, 13000, 14000, 1000000].map(price_usd => ({ price_usd })));
  assert.equal(stats.count, 5);
  assert.equal(stats.min, 10000);
  assert.equal(stats.max, 14000);
});

test('does not trust a stored HKD conversion without currency evidence on the source line', () => {
  const result = verifyFeaturedRecord(
    { reference: '5712/1A', currency: 'HKD', price_usd: 12820, dial_color: 'Blue' },
    { raw_message: '5712/1A Blue 2025 100,000' },
    { found: true, matchType: 'exact', matchedRef: '5712/1A', reference: '5712/1A', dialColors: ['Blue'] },
    [10000, 11000, 12000, 13000, 14000].map(price_usd => ({ price_usd })),
  );
  assert.equal(result.reason, 'RAW_CURRENCY_EVIDENCE_MISSING');
});
