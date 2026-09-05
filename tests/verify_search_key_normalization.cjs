'use strict';

const assert = require('assert');
const path = require('path');

// Import normalization functions from Trading Floor and Price Research modules
const { referenceComparisonKey } = require('../api/reviewed-market-inventory.js');
const { normRef, normSlash, inferBrand } = require('../api/_lib/resolve.js');
const { lookupCatalog, listEquivalentReferences } = require('../api/_lib/catalog.js');

console.log('=== ADVERSARIAL TEST: Search Key Normalization Verification ===\n');

const testCases = [
  // Rolex standard & variant references
  { input: '116500LN', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '116500ln', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '116500 LN', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '116500-LN', expectedKey: '116500LN', brand: 'Rolex' },
  { input: ' 116500LN ', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '126710BLRO', expectedKey: '126710BLRO', brand: 'Rolex' },
  { input: '126710 BLRO', expectedKey: '126710BLRO', brand: 'Rolex' },
  { input: '126710-BLRO', expectedKey: '126710BLRO', brand: 'Rolex' },
  { input: '126610LN', expectedKey: '126610LN', brand: 'Rolex' },
  { input: '126610 LV', expectedKey: '126610LV', brand: 'Rolex' },
  { input: '124060', expectedKey: '124060', brand: 'Rolex' },

  // Patek Philippe references with slashes and dashes
  { input: '5711/1A-010', expectedKey: '57111A010', brand: 'Patek Philippe' },
  { input: '5711/1A', expectedKey: '57111A', brand: 'Patek Philippe' },
  { input: '5711-1A', expectedKey: '57111A', brand: 'Patek Philippe' },
  { input: '5712/1A-001', expectedKey: '57121A001', brand: 'Patek Philippe' },
  { input: '5167A-001', expectedKey: '5167A001', brand: 'Patek Philippe' },
  { input: '5711 / 1A - 010', expectedKey: '57111A010', brand: 'Patek Philippe' },

  // Audemars Piguet
  { input: '15500ST.OO.1220ST.01', expectedKey: '15500STOO1220ST01', brand: 'Audemars Piguet' },
  { input: '15500ST', expectedKey: '15500ST', brand: 'Audemars Piguet' },
  { input: '26240OR.OO.D002CR.01', expectedKey: '26240OROOD002CR01', brand: 'Audemars Piguet' },

  // Omega
  { input: '311.30.42.30.01.005', expectedKey: '31130423001005', brand: 'Omega' },
  { input: '210.30.42.20.01.001', expectedKey: '21030422001001', brand: 'Omega' },

  // Panerai
  { input: 'PAM 00111', expectedKey: 'PAM00111', brand: 'Panerai' },
  { input: 'PAM00111', expectedKey: 'PAM00111', brand: 'Panerai' },
  { input: 'PAM 111', expectedKey: 'PAM111', brand: 'Panerai' },
  { input: 'PAM-111', expectedKey: 'PAM111', brand: 'Panerai' },

  // Cartier & Vacheron Constantin & IWC
  { input: 'WSSA0018', expectedKey: 'WSSA0018', brand: 'Cartier' },
  { input: '4500V/110A-B128', expectedKey: '4500V110AB128', brand: 'Vacheron Constantin' },
  { input: 'IW371605', expectedKey: 'IW371605', brand: 'IWC' },

  // Edge cases: lowercase, spaces, punctuation, special chars
  { input: '  116500ln--  ', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '116500_LN', expectedKey: '116500LN', brand: 'Rolex' },
  { input: '116500.LN', expectedKey: '116500LN', brand: 'Rolex' },

  // Empty / Nullish checks
  { input: '', expectedKey: '', brand: null },
  { input: null, expectedKey: '', brand: null },
  { input: undefined, expectedKey: '', brand: null },
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

console.log('--- Test 1: Direct comparison between referenceComparisonKey and normRef ---');
for (const tc of testCases) {
  totalTests++;
  const tfKey = referenceComparisonKey(tc.input);
  const prKey = normRef(tc.input);

  if (tfKey === prKey && tfKey === tc.expectedKey) {
    passedTests++;
    console.log(`[PASS] Input: "${tc.input}" => TF: "${tfKey}" | PR: "${prKey}" (matches expected "${tc.expectedKey}")`);
  } else {
    failedTests++;
    console.error(`[FAIL] Input: "${tc.input}" => TF: "${tfKey}" | PR: "${prKey}" (expected "${tc.expectedKey}")`);
  }
}

console.log('\n--- Test 2: Equivalent References Expansion and normRef Mapping ---');
const equivalenceCases = [
  { ref: '116500LN', brand: 'Rolex' },
  { ref: '116500ln', brand: 'Rolex' },
  { ref: '5711/1A-010', brand: 'Patek Philippe' },
  { ref: '5711/1A', brand: 'Patek Philippe' },
  { ref: 'PAM00111', brand: 'Panerai' },
];

for (const eq of equivalenceCases) {
  totalTests++;
  const baseKey = referenceComparisonKey(eq.ref);
  const equivList = listEquivalentReferences(eq.ref, eq.brand);
  const normalizedEquivKeys = equivList.map(r => normRef(r));
  
  const containsBaseKey = normalizedEquivKeys.includes(baseKey);
  if (containsBaseKey) {
    passedTests++;
    console.log(`[PASS] Equiv references for ${eq.brand} "${eq.ref}": [${equivList.join(', ')}] -> normRef keys: [${normalizedEquivKeys.join(', ')}] (contains TF base key "${baseKey}")`);
  } else {
    failedTests++;
    console.error(`[FAIL] Equiv references for ${eq.brand} "${eq.ref}": [${equivList.join(', ')}] -> normRef keys: [${normalizedEquivKeys.join(', ')}] (MISSING TF base key "${baseKey}")`);
  }
}

console.log('\n--- Test 3: Trading Floor query vs Price Research query key compatibility ---');
// Verification: TF queries `reference_search_key = referenceComparisonKey(requestedRef)`
// PR queries `reference_search_key IN (listEquivalentReferences(rawRef, brand).map(normRef))`
// Verify that for any user search string, the TF key is ALWAYS included in the PR keys array!
const queryTestInputs = [
  { query: '116500LN', brand: 'Rolex' },
  { query: '116500ln', brand: 'Rolex' },
  { query: '116500-LN', brand: 'Rolex' },
  { query: '5711/1A', brand: 'Patek Philippe' },
  { query: '5711/1A-010', brand: 'Patek Philippe' },
  { query: 'PAM00111', brand: 'Panerai' },
  { query: '15500ST', brand: 'Audemars Piguet' },
  { query: '311.30.42.30.01.005', brand: 'Omega' },
];

for (const qt of queryTestInputs) {
  totalTests++;
  const tfQueryKey = referenceComparisonKey(qt.query);
  const prQueryKeys = listEquivalentReferences(qt.query, qt.brand).map(r => normRef(r));
  
  if (prQueryKeys.includes(tfQueryKey)) {
    passedTests++;
    console.log(`[PASS] Query "${qt.query}" (${qt.brand}): TF query key "${tfQueryKey}" is present in PR query keys: [${prQueryKeys.join(', ')}]`);
  } else {
    failedTests++;
    console.error(`[FAIL] Query "${qt.query}" (${qt.brand}): TF query key "${tfQueryKey}" NOT found in PR query keys: [${prQueryKeys.join(', ')}]`);
  }
}

console.log(`\nSummary: ${passedTests}/${totalTests} tests passed.`);
if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('ALL NORMALIZATION VERIFICATION TESTS PASSED SUCCESSFULLY!');
}
