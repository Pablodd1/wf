#!/usr/bin/env node
/**
 * catalog-audit.js v1
 * Audits reference-catalog.json for cross-brand contamination.
 */

const fs = require('fs');
const path = require('path');

const CATALOG = JSON.parse(fs.readFileSync('/home/jasme/wf/api/_lib/reference-catalog.json', 'utf8'));
const BRANDS = Object.keys(CATALOG.catalog);

console.log(`=== CATALOG AUDIT ===`);
console.log(`Total brands: ${BRANDS.length}`);

const report = {};
let totalEntries = 0;
let totalContaminated = 0;

// Patterns that indicate wrong brand
const BRAND_PATTERNS = {
  'Patek Philippe': /\b(51|52|54|58|59|60|61|63|71)\d{3}\b/,  // Patek refs start with 51/52/54/etc.
  'Richard Mille': /\bRM\d{2}\b/,
  'Rolex': /\b(1|2|3|4|5|6|7|8|9)\d{5}\b/,
  'Omega': /\b(21|23|22|25)\d{4}\b/,
  'Cartier': /\b(W|W2|W3|W4|CR|DG|PG|RG|TB)\d{4}\b/,
};

for (const brand of BRANDS) {
  const brandData = CATALOG.catalog[brand];
  let brandEntries = 0;
  let brandContaminated = 0;
  const contaminatedExamples = [];
  
  for (const [model, refs] of Object.entries(brandData)) {
    for (const ref of refs) {
      brandEntries++;
      totalEntries++;
      
      // Check 1: Non-reference string (has spaces, words, etc.)
      if (/[a-zA-Z]{3,}/.test(ref.replace(/^[A-Z0-9\-_.]+$/, ''))) {
        brandContaminated++;
        totalContaminated++;
        if (contaminatedExamples.length < 3) {
          contaminatedExamples.push({ model, ref, reason: 'NON_REF_STRING' });
        }
        continue;
      }
      
      // Check 2: Cross-brand pattern
      for (const [otherBrand, pattern] of Object.entries(BRAND_PATTERNS)) {
        if (otherBrand === brand) continue;
        if (pattern.test(ref)) {
          brandContaminated++;
          totalContaminated++;
          if (contaminatedExamples.length < 3) {
            contaminatedExamples.push({ model, ref, reason: `POSSIBLE_${otherBrand.toUpperCase()}_REF` });
          }
          break;
        }
      }
    }
  }
  
  const contaminationRate = brandEntries > 0 ? (brandContaminated / brandEntries * 100).toFixed(1) : 0;
  report[brand] = {
    entries: brandEntries,
    contaminated: brandContaminated,
    rate: parseFloat(contaminationRate),
    examples: contaminatedExamples,
  };
  
  if (brandContaminated > 0) {
    console.log(`  ${brand}: ${brandContaminated}/${brandEntries} (${(contaminationRate)}%) contaminated`);
    contaminatedExamples.forEach(ex => {
      console.log(`    - ${ex.model}: "${ex.ref}" (${ex.reason})`);
    });
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Total entries: ${totalEntries}`);
console.log(`Total contaminated: ${totalContaminated} (${(totalContaminated/totalEntries*100).toFixed(1)}%)`);

// Sort by contamination rate
const sorted = Object.entries(report).sort((a, b) => b[1].rate - a[1].rate);
console.log(`\n=== WORST CONTAMINATION (top 10) ===`);
sorted.slice(0, 10).forEach(([brand, data]) => {
  if (data.contaminated > 0) {
    console.log(`  ${brand}: ${data.rate}% (${data.contaminated}/${data.entries})`);
  }
});

// Save detailed report
const reportPath = '/home/jasme/wf/CATALOG_AUDIT_v1.json';
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report saved to: ${reportPath}`);
