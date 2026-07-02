#!/usr/bin/env node
/**
 * Build brand/reference index from CATALOG ONLY.
 * No Supabase dependency — uses the 6,958-entry catalog.json as source of truth.
 * Every brand+ref in this index = verified real watch.
 * 
 * v5: Catalog-only. No API calls, no key needed.
 */

const fs = require('fs');
const path = require('path');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'catalog.json'), 'utf8'));

console.log(`Building brand/reference index — v5 (catalog-only)...`);
console.log(`Catalog: ${catalog.length} entries`);
console.log('');

// Build brand→[refs] index
const brandIndex = {};
const refCount = {};

for (const e of catalog) {
  const brand = (e.brand || '').trim();
  const ref = (e.reference || '').trim();
  if (!brand || !ref) continue;

  if (!brandIndex[brand]) brandIndex[brand] = new Set();
  brandIndex[brand].add(ref);
  refCount[ref] = (refCount[ref] || 0) + 1;
}

const brandIndexObj = {};
for (const [b, refs] of Object.entries(brandIndex)) {
  brandIndexObj[b] = [...refs].sort();
}

fs.writeFileSync('public/watchfacts-brand-index.json', JSON.stringify(brandIndexObj));
const brandSize = fs.statSync('public/watchfacts-brand-index.json').size;
console.log(`Brand index: ${Object.keys(brandIndexObj).length} brands, ${(brandSize/1024).toFixed(0)} KB`);

const brands = Object.keys(brandIndexObj).sort();
fs.writeFileSync('public/watchfacts-catalog-brands.json', JSON.stringify(brands));
console.log(`Catalog brands: ${brands.length} brands`);

// Print per-brand counts
for (const b of brands.sort((a,b) => brandIndexObj[b].length - brandIndexObj[a].length)) {
  console.log(`  ${b}: ${brandIndexObj[b].length} refs`);
}

console.log('');
console.log('✅ Index build complete.');
