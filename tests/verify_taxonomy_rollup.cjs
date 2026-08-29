const { normalizeCanonicalModel } = require('../api/_lib/catalog-taxonomy');
const assert = require('assert');

console.log('Testing Canonical Catalog Taxonomy Rollup Engine...');

// Patek Philippe Nautilus Rollups
assert.strictEqual(normalizeCanonicalModel('Nautilus Jumbo', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus 50th Anniversary', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Mid Size', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Time & Date', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Chronograph', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Moon Phase', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Perpetual Calendar', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Power Reserve', 'Patek Philippe'), 'Nautilus');
assert.strictEqual(normalizeCanonicalModel('Nautilus Tiffany', 'Patek Philippe'), 'Nautilus');

// Patek Philippe Complications Rollups
assert.strictEqual(normalizeCanonicalModel('Annual Calendar', 'Patek Philippe'), 'Complications');
assert.strictEqual(normalizeCanonicalModel('Annual Calendar Moon Phases', 'Patek Philippe'), 'Complications');
assert.strictEqual(normalizeCanonicalModel('Chronograph Perpetual Calendar', 'Patek Philippe'), 'Complications');
assert.strictEqual(normalizeCanonicalModel('Minute Repeater', 'Patek Philippe'), 'Complications');
assert.strictEqual(normalizeCanonicalModel('Split-Seconds Chronograph Perpetual Calendar', 'Patek Philippe'), 'Complications');

// Collection Sub-sets Rollups
assert.strictEqual(normalizeCanonicalModel('Cubitus Date', 'Patek Philippe'), 'Cubitus');
assert.strictEqual(normalizeCanonicalModel('Cubitus Perpetual Calendar Skeleton', 'Patek Philippe'), 'Cubitus');
assert.strictEqual(normalizeCanonicalModel('Gondolo Serata', 'Patek Philippe'), 'Gondolo');
assert.strictEqual(normalizeCanonicalModel('Twenty~4 Manchette', 'Patek Philippe'), 'Twenty~4');

// General Brand Rollups
assert.strictEqual(normalizeCanonicalModel('Royal Oak Offshore Chronograph', 'Audemars Piguet'), 'Royal Oak Offshore');
assert.strictEqual(normalizeCanonicalModel('Submariner Date', 'Rolex'), 'Submariner');

console.log('✅ ALL TAXONOMY ROLLUP TESTS PASSED SUCCESSFULLY!');
